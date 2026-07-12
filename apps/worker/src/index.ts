import { readFile } from 'node:fs/promises';
import { Worker } from 'bullmq';
import { loadWorkerConfig } from '@codeer/config';
import {
  RECOVERY_QUEUE,
  REPOSITORY_INTAKE_QUEUE,
  REPOSITORY_INTAKE_JOB,
  RecoveryJobSchema,
  RepositoryIntakeJobSchema,
  RepositoryIntakeResultSchema,
  RepositoryIntakeStatus,
} from '@codeer/contracts';
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

const repositoryWorkspace = new RepositoryWorkspace(config.REPOSITORY_WORKSPACE_ROOT);

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
    const context = {
      jobId: job.id,
      intakeId: payload.intakeId,
      repositoryUrl: payload.repositoryUrl,
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

    await job.updateProgress({ percent: 100, status: RepositoryIntakeStatus.READY });
    logger.info(
      { ...context, worktreeId: worktree.id, branchName: worktree.branchName },
      'Repository intake completed',
    );
    return result;
  },
  { connection, concurrency: config.REPOSITORY_INTAKE_CONCURRENCY },
);

recoveryWorker.on('completed', (job) => logger.info({ jobId: job.id }, 'Recovery job completed'));
recoveryWorker.on('failed', (job, error) =>
  logger.error({ jobId: job?.id, error }, 'Recovery job failed'),
);
repositoryIntakeWorker.on('completed', (job) =>
  logger.info({ jobId: job.id }, 'Repository intake job completed'),
);
repositoryIntakeWorker.on('failed', (job, error) =>
  logger.error({ jobId: job?.id, error }, 'Repository intake job failed'),
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping CodeER workers');
  await Promise.all([recoveryWorker.close(), repositoryIntakeWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
logger.info(
  {
    recoveryConcurrency: config.WORKER_CONCURRENCY,
    repositoryIntakeConcurrency: config.REPOSITORY_INTAKE_CONCURRENCY,
    workspaceRoot: config.REPOSITORY_WORKSPACE_ROOT,
  },
  'CodeER workers ready',
);
