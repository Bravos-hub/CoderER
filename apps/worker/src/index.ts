import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Queue, Worker } from 'bullmq';
import { loadWorkerConfig } from '@codeer/config';
import {
  INCIDENT_TRIAGE_JOB,
  INCIDENT_TRIAGE_OUTBOX_TOPIC,
  INCIDENT_TRIAGE_QUEUE,
  IncidentTriageJobSchema,
  RECOVERY_QUEUE,
  REPOSITORY_INTAKE_JOB,
  REPOSITORY_INTAKE_QUEUE,
  RecoveryJobSchema,
  RepositoryIntakeJobSchema,
  RepositoryIntakeResultSchema,
  RepositoryIntakeStatus,
} from '@codeer/contracts';
import { closeDatabase, IncidentStore } from '@codeer/database';
import { parseGitHubRepositoryUrl, readGitHubRepository } from '@codeer/github';
import { logger } from '@codeer/logger';
import { RepositoryWorkspace } from '@codeer/repository';

const config = loadWorkerConfig(process.env);
const redisUrl = new URL(config.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: null,
};

const workerId = `worker-${randomUUID()}`;
const repositoryWorkspace = new RepositoryWorkspace(config.REPOSITORY_WORKSPACE_ROOT);
const incidentStore = new IncidentStore();
const incidentTriageQueue = new Queue(INCIDENT_TRIAGE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  },
});

async function githubPrivateKey(): Promise<string | undefined> {
  if (config.GITHUB_APP_PRIVATE_KEY_FILE) {
    return await readFile(config.GITHUB_APP_PRIVATE_KEY_FILE, { encoding: 'utf8' });
  }
  return config.GITHUB_APP_PRIVATE_KEY;
}

const recoveryWorker = new Worker(
  RECOVERY_QUEUE,
  (job) => {
    const payload = RecoveryJobSchema.parse(job.data);
    logger.info(
      { jobId: job.id, incidentId: payload.incidentId, stage: payload.stage },
      'Processing recovery stage',
    );
    return Promise.resolve({ accepted: true, processedAt: new Date().toISOString() });
  },
  { connection, concurrency: config.WORKER_CONCURRENCY },
);

const repositoryIntakeWorker = new Worker(
  REPOSITORY_INTAKE_QUEUE,
  async (job) => {
    if (job.name !== REPOSITORY_INTAKE_JOB)
      throw new Error(`Unsupported repository job: ${job.name}`);
    const payload = RepositoryIntakeJobSchema.parse(job.data);
    if (payload.organizationId !== config.DEFAULT_ORGANIZATION_ID) {
      throw new Error('Organization must be provisioned before repository intake.');
    }
    const context = {
      jobId: job.id,
      intakeId: payload.intakeId,
      repositoryUrl: payload.repositoryUrl,
      organizationId: payload.organizationId,
    };

    await job.updateProgress({ percent: 10, status: RepositoryIntakeStatus.AUTHENTICATING });
    const locator = parseGitHubRepositoryUrl(payload.repositoryUrl);

    await job.updateProgress({ percent: 25, status: RepositoryIntakeStatus.READING_METADATA });
    const metadata = await readGitHubRepository(locator, {
      appId: config.GITHUB_APP_ID,
      privateKey: await githubPrivateKey(),
      installationId: payload.installationId,
      token: config.GITHUB_TOKEN,
      apiUrl: config.GITHUB_API_URL,
      maxBranches: config.MAX_GITHUB_BRANCHES,
    });
    const selectedBaseBranch = payload.baseBranch ?? metadata.defaultBranch;
    const branch = metadata.branches.find((candidate) => candidate.name === selectedBaseBranch);
    if (!branch)
      throw new Error(`Base branch ${selectedBaseBranch} does not exist in ${metadata.fullName}`);

    await job.updateProgress({ percent: 45, status: RepositoryIntakeStatus.CLONING });
    const clone = await repositoryWorkspace.cloneOrRefresh({
      owner: metadata.owner,
      name: metadata.name,
      cloneUrl: metadata.cloneUrl,
      defaultBranch: selectedBaseBranch,
      accessToken: metadata.accessToken,
      cloneDepth: config.REPOSITORY_CLONE_DEPTH,
      maximumFiles: config.MAX_REPOSITORY_FILES,
      maximumBytes: config.MAX_REPOSITORY_BYTES,
    });

    await job.updateProgress({ percent: 70, status: RepositoryIntakeStatus.INSPECTING });
    logger.info(
      {
        ...context,
        owner: metadata.owner,
        name: metadata.name,
        branchCount: metadata.branches.length,
      },
      'Repository metadata and clone verified',
    );

    await job.updateProgress({ percent: 85, status: RepositoryIntakeStatus.CREATING_WORKTREE });
    const worktree = await repositoryWorkspace.createWorktree({
      repositoryPath: clone.absolutePath,
      baseBranch: selectedBaseBranch,
      intakeId: payload.intakeId,
    });

    const result = RepositoryIntakeResultSchema.parse({
      intakeId: payload.intakeId,
      status: RepositoryIntakeStatus.READY,
      repository: {
        provider: metadata.provider,
        providerRepositoryId: metadata.providerRepositoryId,
        owner: metadata.owner,
        name: metadata.name,
        fullName: metadata.fullName,
        htmlUrl: metadata.htmlUrl,
        defaultBranch: metadata.defaultBranch,
        selectedBaseBranch,
        visibility: metadata.visibility,
        headSha: branch.sha,
        branches: metadata.branches,
      },
      clone: {
        relativePath: clone.relativePath,
        refreshed: clone.refreshed,
        fileCount: clone.fileCount,
        totalBytes: clone.totalBytes,
      },
      worktree: {
        id: worktree.id,
        branchName: worktree.branchName,
        relativePath: worktree.relativePath,
        baseSha: worktree.baseSha,
      },
      completedAt: new Date().toISOString(),
    });

    const repositoryId = await incidentStore.persistRepositoryIntake(payload, result, {
      id: config.DEFAULT_ORGANIZATION_ID,
      slug: config.DEFAULT_ORGANIZATION_SLUG,
      name: config.DEFAULT_ORGANIZATION_NAME,
    });
    await job.updateProgress({ percent: 100, status: RepositoryIntakeStatus.READY });
    logger.info(
      { ...context, repositoryId, worktreeId: worktree.id, branchName: worktree.branchName },
      'Repository intake completed and persisted',
    );
    return { ...result, repositoryId };
  },
  { connection, concurrency: config.REPOSITORY_INTAKE_CONCURRENCY },
);

const incidentTriageWorker = new Worker(
  INCIDENT_TRIAGE_QUEUE,
  async (job) => {
    if (job.name !== INCIDENT_TRIAGE_JOB)
      throw new Error(`Unsupported incident triage job: ${job.name}`);
    const payload = IncidentTriageJobSchema.parse(job.data);
    logger.info(
      {
        jobId: job.id,
        incidentId: payload.incidentId,
        organizationId: payload.organizationId,
        correlationId: payload.correlationId,
      },
      'Incident triage started',
    );
    const result = await incidentStore.processTriage(payload);
    logger.info(
      {
        jobId: job.id,
        incidentId: payload.incidentId,
        severity: result.severityAssessment.severity,
        healthScore: result.healthSnapshot.overallScore,
      },
      'Incident triage completed',
    );
    return result;
  },
  { connection, concurrency: config.INCIDENT_TRIAGE_CONCURRENCY },
);

let publishing = false;
async function publishOutbox(): Promise<void> {
  if (publishing) return;
  publishing = true;
  try {
    const messages = await incidentStore.claimOutboxBatch(
      workerId,
      config.OUTBOX_BATCH_SIZE,
      config.OUTBOX_LOCK_TIMEOUT_MS,
    );
    for (const message of messages) {
      try {
        if (message.topic !== INCIDENT_TRIAGE_OUTBOX_TOPIC) {
          throw new Error(`Unsupported outbox topic: ${message.topic}`);
        }
        const payload = IncidentTriageJobSchema.parse(message.payload);
        await incidentTriageQueue.add(INCIDENT_TRIAGE_JOB, payload, {
          jobId: message.deduplicationKey,
        });
        await incidentStore.markOutboxPublished(message.id);
      } catch (error) {
        await incidentStore.markOutboxFailed(
          message.id,
          error,
          message.attempts,
          config.OUTBOX_MAX_ATTEMPTS,
        );
        logger.error(
          {
            outboxId: message.id,
            topic: message.topic,
            attempts: message.attempts,
            error,
          },
          'Outbox publish failed',
        );
      }
    }
  } finally {
    publishing = false;
  }
}

const outboxTimer = setInterval(() => void publishOutbox(), config.OUTBOX_POLL_INTERVAL_MS);
outboxTimer.unref();
void publishOutbox();

for (const worker of [recoveryWorker, repositoryIntakeWorker, incidentTriageWorker]) {
  worker.on('completed', (job) =>
    logger.info({ jobId: job.id, queue: worker.name }, 'Job completed'),
  );
  worker.on('failed', (job, error) =>
    logger.error({ jobId: job?.id, queue: worker.name, error }, 'Job failed'),
  );
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping CodeER workers');
  clearInterval(outboxTimer);
  await Promise.all([
    recoveryWorker.close(),
    repositoryIntakeWorker.close(),
    incidentTriageWorker.close(),
    incidentTriageQueue.close(),
  ]);
  await closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
logger.info(
  {
    workerId,
    recoveryConcurrency: config.WORKER_CONCURRENCY,
    repositoryIntakeConcurrency: config.REPOSITORY_INTAKE_CONCURRENCY,
    incidentTriageConcurrency: config.INCIDENT_TRIAGE_CONCURRENCY,
    outboxPollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
    workspaceRoot: config.REPOSITORY_WORKSPACE_ROOT,
  },
  'CodeER workers ready',
);
