import { Queue } from 'bullmq';
import { CONTROLLED_RECOVERY_JOB, CONTROLLED_RECOVERY_QUEUE } from '@codeer/contracts';
import { createDatabasePool, RecoveryStore } from '@codeer/database';

const databaseUrl = process.env.DATABASE_WORKER_URL;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const staleAfterMs = Number(process.env.RECOVERY_STALE_AFTER_MS ?? 60 * 60 * 1000);
if (!databaseUrl) throw new Error('DATABASE_WORKER_URL is required.');
if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 60_000) {
  throw new Error('RECOVERY_STALE_AFTER_MS must be an integer of at least 60000.');
}

const pool = createDatabasePool(databaseUrl, { max: 2, application_name: 'recovery-reconciler' });
const store = new RecoveryStore(pool);
const queue = new Queue(CONTROLLED_RECOVERY_QUEUE, { connection: { url: redisUrl } });
try {
  const jobs = await store.listStaleRecoveryJobs(Math.ceil(staleAfterMs / 1_000), 100);
  for (const payload of jobs) {
    await queue.add(CONTROLLED_RECOVERY_JOB, payload, {
      jobId: `recovery:${payload.recoveryId}:reconcile`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }
  console.log(JSON.stringify({ status: 'queued', recoveries: jobs.map((job) => job.recoveryId) }));
} finally {
  await queue.close();
  await pool.end();
}
