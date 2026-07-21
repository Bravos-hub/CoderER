import { createHash } from 'node:crypto';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  PUBLICATION_EXECUTION_JOB,
  PUBLICATION_EXECUTION_QUEUE,
  PublicationExecutionJobSchema,
  PublicationExecutionResultSchema,
  type PublicationExecutionJob,
} from '@codeer/contracts';
import type { loadWorkerConfig } from '@codeer/config';
import { PublicationStore } from '@codeer/database';
import { logger } from '@codeer/logger';
import {
  GithubAppClient,
  GithubAppTokenError,
  GithubPublicationClient,
  PublicationFailure,
  PublicationStatus,
  classifyPublicationFailure,
  createGithubAppJwt,
  ensureDraftPullRequest,
  ensurePublicationBranch,
  materializePublicationCommit,
  publicationExecutionStage,
  verifyExistingPublicationCommit,
  verifyPublicationBundle,
  type PublicationExecutionBundle,
} from '@codeer/publication';

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;

interface RuntimeOptions {
  config: WorkerConfig;
  connection: ConnectionOptions;
  workerId: string;
  store?: PublicationStore;
  githubPrivateKey?: () => Promise<string | undefined>;
}

export function createPublicationExecutionWorker(options: RuntimeOptions): {
  worker: Worker;
  reconcile(): Promise<void>;
  close(): Promise<void>;
} {
  const { config, connection, workerId } = options;
  const store = options.store ?? new PublicationStore();

  async function acquireInstallationToken(bundle: PublicationExecutionBundle): Promise<string> {
    const privateKey = (await options.githubPrivateKey?.()) ?? config.GITHUB_APP_PRIVATE_KEY;
    if (!config.GITHUB_APP_ID || !privateKey)
      throw new PublicationFailure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_AUTH_MISSING',
        'GitHub App credentials are not configured for the publication worker.',
      );
    const providerRepositoryId = Number(bundle.repository.providerRepoId);
    if (!Number.isInteger(providerRepositoryId) || providerRepositoryId <= 0)
      throw new PublicationFailure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_REPOSITORY_INVALID',
        'The repository has no valid provider repository id.',
      );
    const appJwt = createGithubAppJwt(config.GITHUB_APP_ID, privateKey.replace(/\\n/g, '\n'));
    const appClient = new GithubAppClient(config.GITHUB_API_URL);
    try {
      const { token } = await appClient.createInstallationToken(
        appJwt,
        bundle.installation.installationId,
        [providerRepositoryId],
      );
      return token;
    } catch (error) {
      if (error instanceof GithubAppTokenError)
        throw new PublicationFailure(
          PublicationStatus.PUBLICATION_BLOCKED,
          error.status === 401 || error.status === 403
            ? 'PUBLICATION_FORBIDDEN'
            : 'PUBLICATION_AUTH_FAILED',
          error.message,
        );
      throw error;
    }
  }

  async function processPublication(
    payload: PublicationExecutionJob,
    progress: (value: Record<string, unknown>) => Promise<void>,
  ): Promise<unknown> {
    const leaseSeconds = Math.ceil(config.PUBLICATION_EXECUTION_LEASE_MS / 1_000);
    const envelope = await store.claimPublication(
      payload.organizationId,
      payload.publicationId,
      workerId,
      leaseSeconds,
    );
    if (!envelope) return { skipped: true, reason: 'lease-not-acquired' };

    let heartbeatFailure: Error | null = null;
    const heartbeat = setInterval(
      () => {
        void store
          .heartbeat(envelope.organizationId, envelope.id, workerId, leaseSeconds)
          .then(({ cancellationRequested }) => {
            if (cancellationRequested)
              heartbeatFailure = new Error('Publication cancellation was requested.');
          })
          .catch((error: unknown) => {
            heartbeatFailure =
              error instanceof Error ? error : new Error('Publication lease heartbeat failed.');
          });
      },
      Math.max(5_000, Math.floor(config.PUBLICATION_EXECUTION_LEASE_MS / 3)),
    );
    heartbeat.unref();

    let stage = PublicationStatus.POLICY_CHECK;
    const checkControl = async (): Promise<void> => {
      if (heartbeatFailure) throw heartbeatFailure;
      const state = await store.heartbeat(
        envelope.organizationId,
        envelope.id,
        workerId,
        leaseSeconds,
      );
      if (state.cancellationRequested) throw new Error('Publication cancellation was requested.');
    };

    try {
      if (envelope.status === PublicationStatus.PUBLICATION_REQUESTED) {
        await store.advancePublication({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          to: PublicationStatus.POLICY_CHECK,
          eventType: 'PUBLICATION_POLICY_CHECK_STARTED',
          eventPayload: { attempt: envelope.attemptCount },
          correlationId: payload.correlationId,
        });
      }
      stage = PublicationStatus.POLICY_CHECK;
      const bundle = await store.loadExecutionBundle(envelope.organizationId, envelope.id);
      verifyPublicationBundle(bundle);
      await checkControl();
      if (publicationExecutionStage(envelope.status) < 2) {
        await store.advancePublication({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          to: PublicationStatus.COMMIT_MATERIALIZING,
          eventType: 'PUBLICATION_POLICY_CHECKED',
          eventPayload: {
            policyVersion: bundle.policy.version,
            approvedCount: bundle.approvals.approvedCount,
            patchDigest: bundle.publication.patchDigest,
          },
          correlationId: payload.correlationId,
        });
      }
      await progress({ stage: PublicationStatus.COMMIT_MATERIALIZING, percent: 20 });

      stage = PublicationStatus.COMMIT_MATERIALIZING;
      const token = await acquireInstallationToken(bundle);
      const github = new GithubPublicationClient({
        baseUrl: config.GITHUB_API_URL,
        owner: bundle.repository.owner,
        repo: bundle.repository.name,
        token,
      });
      let treeSha: string;
      let commitSha: string;
      if (publicationExecutionStage(envelope.status) < 3) {
        const materialized = await materializePublicationCommit(bundle, github);
        await store.recordMaterialization({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          treeSha: materialized.treeSha,
          commitSha: materialized.commitSha,
          treeDigest: materialized.treeDigest,
          messageDigest: materialized.messageDigest,
          correlationId: payload.correlationId,
        });
        treeSha = materialized.treeSha;
        commitSha = materialized.commitSha;
      } else {
        const existing = await verifyExistingPublicationCommit(bundle, github);
        treeSha = existing.treeSha;
        commitSha = existing.commitSha;
      }
      await checkControl();
      await progress({ stage: PublicationStatus.BRANCH_PUBLISHING, percent: 55 });

      stage = PublicationStatus.BRANCH_PUBLISHING;
      if (envelope.status === PublicationStatus.PUSH_FAILED) {
        await store.advancePublication({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          to: PublicationStatus.BRANCH_PUBLISHING,
          eventType: 'PUBLICATION_BRANCH_RETRY',
          eventPayload: { attempt: envelope.attemptCount },
          correlationId: payload.correlationId,
        });
      }
      const branch = await ensurePublicationBranch(github, {
        headBranch: bundle.publication.headBranch,
        commitSha,
      });
      if (publicationExecutionStage(envelope.status) < 4) {
        await store.advancePublication({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          to: PublicationStatus.DRAFT_PR_CREATING,
          eventType: 'PUBLICATION_BRANCH_PUBLISHED',
          eventPayload: {
            headBranch: bundle.publication.headBranch,
            commitSha,
            reused: branch.reused,
          },
          correlationId: payload.correlationId,
        });
      }
      await checkControl();
      await progress({ stage: PublicationStatus.DRAFT_PR_CREATING, percent: 80 });

      stage = PublicationStatus.DRAFT_PR_CREATING;
      if (envelope.status === PublicationStatus.PR_CREATION_FAILED) {
        await store.advancePublication({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          to: PublicationStatus.DRAFT_PR_CREATING,
          eventType: 'PUBLICATION_PR_RETRY',
          eventPayload: { attempt: envelope.attemptCount },
          correlationId: payload.correlationId,
        });
      }
      const pullRequest = await ensureDraftPullRequest(github, {
        title: bundle.pullRequestPackage.title,
        body: bundle.pullRequestPackage.body,
        headBranch: bundle.publication.headBranch,
        baseBranch: bundle.publication.baseBranch,
        baseCommitSha: bundle.publication.baseCommitSha,
        commitSha,
      });
      await store.recordPullRequest({
        organizationId: envelope.organizationId,
        publicationId: envelope.id,
        workerId,
        pullRequest: {
          number: pullRequest.pullRequest.number,
          nodeId: pullRequest.pullRequest.nodeId,
          url: pullRequest.pullRequest.url,
          title: pullRequest.pullRequest.title,
          bodyDigest: createHash('sha256').update(pullRequest.pullRequest.body).digest('hex'),
          baseBranch: pullRequest.pullRequest.baseRef,
          headBranch: pullRequest.pullRequest.headRef,
          headSha: pullRequest.pullRequest.headSha,
          baseSha: pullRequest.pullRequest.baseSha,
          draft: pullRequest.pullRequest.draft,
          state: pullRequest.pullRequest.state,
        },
        reused: pullRequest.reused,
        correlationId: payload.correlationId,
      });
      await progress({ stage: PublicationStatus.CI_MONITORING, percent: 100 });
      logger.info(
        {
          publicationId: envelope.id,
          organizationId: envelope.organizationId,
          commitSha,
          pullRequestNumber: pullRequest.pullRequest.number,
          branchReused: branch.reused,
          pullRequestReused: pullRequest.reused,
        },
        'Publication execution completed with a draft pull request',
      );
      return PublicationExecutionResultSchema.parse({
        publicationId: envelope.id,
        organizationId: envelope.organizationId,
        status: PublicationStatus.CI_MONITORING,
        baseBranch: bundle.publication.baseBranch,
        headBranch: bundle.publication.headBranch,
        baseCommitSha: bundle.publication.baseCommitSha,
        treeSha,
        commitSha,
        pullRequestNumber: pullRequest.pullRequest.number,
        pullRequestUrl: pullRequest.pullRequest.url,
        branchReused: branch.reused,
        pullRequestReused: pullRequest.reused,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const failure = classifyPublicationFailure(error, stage);
      logger.error(
        {
          error,
          publicationId: envelope.id,
          organizationId: envelope.organizationId,
          code: failure.code,
          status: failure.status,
        },
        'Publication execution failed',
      );
      await store
        .failPublication({
          organizationId: envelope.organizationId,
          publicationId: envelope.id,
          workerId,
          status: failure.status,
          errorCode: failure.code,
          errorMessage: failure.message,
          correlationId: payload.correlationId,
        })
        .catch((completionError: unknown) =>
          logger.error(
            { completionError, publicationId: envelope.id },
            'Unable to persist publication failure',
          ),
        );
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  const worker = new Worker(
    PUBLICATION_EXECUTION_QUEUE,
    async (job: Job) => {
      if (job.name !== PUBLICATION_EXECUTION_JOB)
        throw new Error(`Unsupported publication execution job: ${job.name}`);
      const payload = PublicationExecutionJobSchema.parse(job.data);
      return await processPublication(payload, async (value) => job.updateProgress(value));
    },
    { connection, concurrency: config.PUBLICATION_EXECUTION_CONCURRENCY },
  );

  return {
    worker,
    async reconcile() {
      const jobs = await store.listStalePublicationJobs(
        Math.ceil(config.PUBLICATION_STALE_AFTER_MS / 1_000),
        config.PUBLICATION_EXECUTION_CONCURRENCY * 5,
      );
      for (const payload of jobs) {
        await processPublication(payload, () => Promise.resolve()).catch((error: unknown) =>
          logger.error(
            { error, publicationId: payload.publicationId },
            'Publication reconciliation failed',
          ),
        );
      }
    },
    async close() {
      await worker.close();
    },
  };
}
