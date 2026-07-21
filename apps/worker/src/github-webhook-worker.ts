import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  GITHUB_WEBHOOK_PROCESS_JOB,
  GithubWebhookProcessJobSchema,
  type GithubWebhookProcessJob as WebhookProcessPayload,
} from '@codeer/contracts';
import { GithubWebhookStore, MergeClosureStore } from '@codeer/database';
import { logger } from '@codeer/logger';

/**
 * Applies normalized GitHub webhook events to publication state. Ingress has
 * already verified the signature, reserved the delivery durably and resolved
 * the tenant; this worker only maps bounded metadata onto checks, reviews and
 * pull-request records. Unknown publications are ignored, never errors — a
 * delivery must never be retried just because the run it references is gone.
 */
export function createGithubWebhookWorker(options: {
  connection: ConnectionOptions;
  concurrency?: number;
  store?: GithubWebhookStore;
  closureStore?: MergeClosureStore;
}): Worker {
  const store = options.store ?? new GithubWebhookStore();
  const closureStore = options.closureStore ?? new MergeClosureStore();
  return new Worker(
    'github-webhook-process',
    async (job: Job) => {
      if (job.name !== GITHUB_WEBHOOK_PROCESS_JOB) {
        throw new Error(`Unsupported webhook job: ${job.name}`);
      }
      const payload = GithubWebhookProcessJobSchema.parse(job.data);
      const applied = await applyWebhookEvent(store, closureStore, payload);
      await store.markWebhookDeliveryStatus(
        payload.organizationId,
        payload.deliveryId,
        applied ? 'PROCESSED' : 'IGNORED',
        applied ? undefined : 'NO_MATCHING_PUBLICATION',
      );
      return { applied };
    },
    { connection: options.connection, concurrency: options.concurrency ?? 2 },
  );
}

async function applyWebhookEvent(
  store: GithubWebhookStore,
  closureStore: MergeClosureStore,
  payload: WebhookProcessPayload,
): Promise<boolean> {
  const normalized = payload.normalized;
  if (payload.eventName === 'pull_request_review') {
    const publicationId = await resolvePublication(store, payload, normalized);
    if (!publicationId) return false;
    await store.upsertPublicationReview(payload.organizationId, {
      publicationId,
      externalId: String(normalized.externalId),
      reviewerLogin: String(normalized.reviewerLogin),
      state: String(normalized.state),
      submittedAt: (normalized.submittedAt as string | null) ?? null,
      bodyDigest: (normalized.bodyDigest as string | null) ?? null,
      correlationId: payload.correlationId,
    });
    await closureStore.evaluateAndPersistMergeReadiness(
      payload.organizationId,
      publicationId,
      payload.correlationId,
    );
    return true;
  }
  if (payload.eventName === 'check_run' || payload.eventName === 'check_suite') {
    const headSha = (normalized.headSha as string | null) ?? null;
    if (!headSha) return false;
    const publicationId = await store.findPublicationIdByHeadSha(payload.organizationId, headSha);
    if (!publicationId) return false;
    await store.upsertPublicationCheck(payload.organizationId, {
      publicationId,
      externalId: String(normalized.externalId),
      name: String(normalized.name),
      status: String(normalized.status),
      headSha,
      detailsUrl: (normalized.detailsUrl as string | null) ?? null,
      startedAt: (normalized.startedAt as string | null) ?? null,
      completedAt: (normalized.completedAt as string | null) ?? null,
      rawConclusion: (normalized.rawConclusion as string | null) ?? null,
      correlationId: payload.correlationId,
    });
    await closureStore.evaluateAndPersistMergeReadiness(
      payload.organizationId,
      publicationId,
      payload.correlationId,
    );
    return true;
  }
  if (payload.eventName === 'pull_request') {
    const result = await store.applyPullRequestUpdate(payload.organizationId, {
      number: Number(normalized.number),
      state: normalized.state as 'open' | 'closed' | 'merged',
      draft: normalized.draft === true,
      headSha: String(normalized.headSha),
      baseSha: String(normalized.baseSha),
      merged: normalized.merged === true,
      mergedBy: (normalized.mergedBy as string | null) ?? null,
      mergedAt: (normalized.mergedAt as string | null) ?? null,
      mergeCommitSha: (normalized.mergeCommitSha as string | null) ?? null,
      correlationId: payload.correlationId,
    });
    if (!result) return false;
    if (result.merged) {
      logger.info(
        { publicationId: result.publicationId, deliveryId: payload.deliveryId },
        'Human merge observed via signed webhook',
      );
      const verification = await closureStore.applyPostMergeVerification(
        payload.organizationId,
        result.publicationId,
        payload.correlationId,
      );
      logger.info(
        { publicationId: result.publicationId, ...verification },
        'Post-merge verification applied',
      );
    }
    return true;
  }
  return false;
}

async function resolvePublication(
  store: GithubWebhookStore,
  payload: WebhookProcessPayload,
  normalized: Record<string, unknown>,
): Promise<string | undefined> {
  const number = normalized.pullRequestNumber;
  if (typeof number === 'number' && Number.isFinite(number)) {
    const byNumber = await store.findPublicationIdByPullRequestNumber(
      payload.organizationId,
      number,
    );
    if (byNumber) return byNumber;
  }
  const headSha = normalized.headSha;
  if (typeof headSha === 'string' && headSha.length === 40) {
    return store.findPublicationIdByHeadSha(payload.organizationId, headSha);
  }
  return undefined;
}
