import { resolve, sep } from 'node:path';
import { Worker, type ConnectionOptions } from 'bullmq';
import type { loadWorkerConfig } from '@codeer/config';
import {
  SANDBOX_EXECUTION_JOB,
  SANDBOX_EXECUTION_QUEUE,
  SandboxExecutionJobSchema,
  SandboxExecutionStatus,
  SandboxResult,
} from '@codeer/contracts';
import { SandboxStore } from '@codeer/database';
import { logger } from '@codeer/logger';
import { redactSecretsFromText, sha256Hex } from '@codeer/security';
import { DockerSandboxProvider, SandboxOrchestrator } from '@codeer/sandbox';

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;

function confinedWorktree(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, relativePath);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Sandbox worktree path escaped the configured repository root.');
  }
  return candidate;
}

export interface SandboxWorkerRuntime {
  worker: Worker;
  reconcile(): Promise<void>;
  close(): Promise<void>;
}

export function createSandboxWorker(
  config: WorkerConfig,
  connection: ConnectionOptions,
  workerId: string,
): SandboxWorkerRuntime {
  const store = new SandboxStore();
  const provider = new DockerSandboxProvider({
    dockerHost: config.SANDBOX_DOCKER_HOST,
    dockerTlsVerify: config.SANDBOX_DOCKER_TLS_VERIFY,
    dockerCertPath: config.SANDBOX_DOCKER_CERT_PATH,
    helperImage: config.SANDBOX_HELPER_IMAGE,
    trustedWorkspaceRoot: config.REPOSITORY_WORKSPACE_ROOT,
    commandOutputLimitBytes: config.SANDBOX_COMMAND_OUTPUT_LIMIT_BYTES,
    workspaceVolumeDriver: config.SANDBOX_WORKSPACE_VOLUME_DRIVER,
    workspaceVolumeSizeOption: config.SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION,
  });
  const orchestrator = new SandboxOrchestrator(provider);

  const worker = new Worker(
    SANDBOX_EXECUTION_QUEUE,
    async (job) => {
      if (job.name !== SANDBOX_EXECUTION_JOB) {
        throw new Error(`Unsupported sandbox job: ${job.name}`);
      }
      const payload = SandboxExecutionJobSchema.parse(job.data);
      const envelope = await store.claimExecution(
        payload,
        workerId,
        config.SANDBOX_EXECUTION_LEASE_MS,
      );
      if (!envelope) {
        logger.warn(
          { jobId: job.id, executionId: payload.executionId },
          'Sandbox job did not acquire its execution lease',
        );
        return { skipped: true, reason: 'lease-not-acquired' };
      }

      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort('timeout'),
        envelope.policy.resourceLimits.executionTimeoutMs,
      );
      timeout.unref();
      let heartbeatInFlight = false;
      const heartbeatIntervalMs = Math.max(
        5_000,
        Math.floor(config.SANDBOX_EXECUTION_LEASE_MS / 3),
      );
      const heartbeatTimer = setInterval(() => {
        if (heartbeatInFlight || abortController.signal.aborted) return;
        heartbeatInFlight = true;
        void store
          .heartbeat(
            envelope.organizationId,
            envelope.executionId,
            workerId,
            config.SANDBOX_EXECUTION_LEASE_MS,
          )
          .catch((error: unknown) => {
            logger.error(
              { error, executionId: envelope.executionId },
              'Sandbox execution heartbeat failed; aborting execution',
            );
            abortController.abort('control-plane-failure');
          })
          .finally(() => {
            heartbeatInFlight = false;
          });
      }, heartbeatIntervalMs);
      heartbeatTimer.unref();

      const cancellationPoll = setInterval(() => {
        void (async () => {
          try {
            if (
              await store.isCancellationRequested(envelope.organizationId, envelope.executionId)
            ) {
              abortController.abort('cancelled');
            }
          } catch (error) {
            logger.error(
              { error, executionId: envelope.executionId },
              'Sandbox cancellation poll failed; aborting execution',
            );
            abortController.abort('control-plane-failure');
          }
        })();
      }, 1_000);
      cancellationPoll.unref();

      logger.info(
        {
          jobId: job.id,
          executionId: envelope.executionId,
          reproductionId: envelope.reproductionId,
          organizationId: envelope.organizationId,
          incidentId: envelope.incidentId,
          policyVersion: envelope.policy.policyVersion,
          image: envelope.policy.image,
        },
        'Sandbox execution started',
      );

      try {
        const result = await orchestrator.execute(
          {
            executionId: envelope.executionId,
            reproductionId: envelope.reproductionId,
            organizationId: envelope.organizationId,
            incidentId: envelope.incidentId,
            worktreePath: confinedWorktree(
              config.REPOSITORY_WORKSPACE_ROOT,
              envelope.worktreeRelativePath,
            ),
            input: envelope.input,
            policy: envelope.policy,
          },
          {
            statusChanged: async (status, metadata) => {
              await store.updateStatus(
                envelope.organizationId,
                envelope.executionId,
                status,
                metadata,
                workerId,
              );
              await job.updateProgress({ status, metadata });
            },
            commandStarted: async (commandId, sequence, command) => {
              await store.commandStarted(
                envelope.organizationId,
                envelope.executionId,
                commandId,
                sequence,
                command,
                workerId,
              );
            },
            commandCompleted: async (commandResult) => {
              await store.commandCompleted(
                envelope.organizationId,
                envelope.executionId,
                commandResult,
                workerId,
              );
            },
            logChunks: async (chunks) => {
              await store.appendLogChunks(
                envelope.organizationId,
                envelope.executionId,
                chunks,
                workerId,
              );
            },
            artifactsCollected: async (artifacts) => {
              await store.recordArtifacts(
                envelope.organizationId,
                envelope.incidentId,
                envelope.executionId,
                artifacts,
                workerId,
              );
            },
            cleanupCompleted: async (cleanup) => {
              await store.recordCleanup(envelope.organizationId, cleanup, workerId);
            },
            cancellationRequested: async () =>
              await store.isCancellationRequested(envelope.organizationId, envelope.executionId),
            heartbeat: async () => {
              await store.heartbeat(
                envelope.organizationId,
                envelope.executionId,
                workerId,
                config.SANDBOX_EXECUTION_LEASE_MS,
              );
            },
          },
          abortController.signal,
        );
        await store.recordCleanup(envelope.organizationId, result.cleanup, workerId);
        await store.completeExecution(
          envelope.organizationId,
          envelope.executionId,
          result,
          workerId,
        );
        logger.info(
          {
            executionId: envelope.executionId,
            result: result.result,
            status: result.status,
            confidence: result.confidence,
            cleanupVerified: result.cleanup.verifiedAbsent,
          },
          'Sandbox execution completed',
        );
        return result;
      } catch (error) {
        logger.error(
          { error, executionId: envelope.executionId },
          'Sandbox worker encountered an unhandled execution failure',
        );
        const safeError = redactSecretsFromText(
          error instanceof Error ? error.message : 'Unknown sandbox failure',
        ).value.slice(0, 2_000);
        const emergencyCleanup = await provider
          .cleanupExecution(envelope.executionId)
          .catch(() => ({
            containerIds: [],
            volumeIds: [],
            networkIds: [],
            verifiedAbsent: false,
            attempts: 1,
            error: 'Emergency cleanup could not prove resource absence.',
            completedAt: new Date(),
          }));
        const cleanupBase = {
          executionId: envelope.executionId,
          containerIds: emergencyCleanup.containerIds,
          volumeIds: emergencyCleanup.volumeIds,
          networkIds: emergencyCleanup.networkIds,
          verifiedAbsent: emergencyCleanup.verifiedAbsent,
          attempts: emergencyCleanup.attempts,
          error: emergencyCleanup.error ?? safeError,
          completedAt: emergencyCleanup.completedAt.toISOString(),
        };
        const cleanup = { ...cleanupBase, digest: sha256Hex(JSON.stringify(cleanupBase)) };
        try {
          await store.recordCleanup(envelope.organizationId, cleanup, workerId);
          await store.completeExecution(
            envelope.organizationId,
            envelope.executionId,
            {
              status: cleanup.verifiedAbsent
                ? SandboxExecutionStatus.INFRASTRUCTURE_FAILED
                : SandboxExecutionStatus.CLEANUP_FAILED,
              result: SandboxResult.INFRASTRUCTURE_FAILED,
              comparison: null,
              environmentFingerprint: sha256Hex(
                JSON.stringify({ executionId: envelope.executionId, state: 'worker-fallback' }),
              ),
              confidence: 0,
              cleanup,
              error: safeError,
            },
            workerId,
          );
        } catch (finalizationError) {
          logger.error(
            { finalizationError, executionId: envelope.executionId },
            'Sandbox failure cleanup ran but terminal persistence was rejected',
          );
          throw new Error(
            'Sandbox execution failed and its terminal state could not be persisted safely.',
            { cause: finalizationError },
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeatTimer);
        clearInterval(cancellationPoll);
      }
    },
    {
      connection,
      concurrency: config.SANDBOX_EXECUTION_CONCURRENCY,
      lockDuration: Math.max(config.SANDBOX_EXECUTION_LEASE_MS, 30_000),
      maxStalledCount: 1,
      stalledInterval: 30_000,
    },
  );

  return {
    worker,
    async reconcile() {
      const staleBefore = new Date(Date.now() - config.SANDBOX_STALE_AFTER_MS);
      const reconcilerId = `${workerId}:reconciler`;
      const reconciliationLeaseMs = Math.max(config.SANDBOX_EXECUTION_LEASE_MS, 5 * 60_000);
      const database = await store.reconcileExpiredLeases(reconcilerId, reconciliationLeaseMs);
      const reconciled = [];
      for (const execution of database) {
        let leaseHealthy = true;
        let heartbeatInFlight = false;
        const heartbeat = setInterval(
          () => {
            if (heartbeatInFlight || !leaseHealthy) return;
            heartbeatInFlight = true;
            void store
              .heartbeat(
                execution.organizationId,
                execution.executionId,
                reconcilerId,
                reconciliationLeaseMs,
              )
              .catch((error: unknown) => {
                leaseHealthy = false;
                logger.error(
                  { error, executionId: execution.executionId },
                  'Sandbox reconciler lost its execution lease',
                );
              })
              .finally(() => {
                heartbeatInFlight = false;
              });
          },
          Math.max(5_000, Math.floor(reconciliationLeaseMs / 3)),
        );
        heartbeat.unref();
        try {
          const outcome = await provider.cleanupExecution(execution.executionId).catch((error) => ({
            containerIds: [],
            volumeIds: [],
            networkIds: [],
            verifiedAbsent: false,
            attempts: 1,
            error: redactSecretsFromText(
              error instanceof Error ? error.message : 'Reconciliation cleanup failed.',
            ).value.slice(0, 2_000),
            completedAt: new Date(),
          }));
          if (!leaseHealthy) {
            throw new Error('Reconciler lease was lost before terminal persistence.');
          }
          const cleanupBase = {
            executionId: execution.executionId,
            containerIds: outcome.containerIds,
            volumeIds: outcome.volumeIds,
            networkIds: outcome.networkIds,
            verifiedAbsent: outcome.verifiedAbsent,
            attempts: outcome.attempts,
            error: outcome.error,
            completedAt: outcome.completedAt.toISOString(),
          };
          const cleanup = { ...cleanupBase, digest: sha256Hex(JSON.stringify(cleanupBase)) };
          await store.recordCleanup(execution.organizationId, cleanup, reconcilerId);
          await store.completeExecution(
            execution.organizationId,
            execution.executionId,
            {
              status: cleanup.verifiedAbsent
                ? SandboxExecutionStatus.INFRASTRUCTURE_FAILED
                : SandboxExecutionStatus.CLEANUP_FAILED,
              result: SandboxResult.INFRASTRUCTURE_FAILED,
              comparison: null,
              environmentFingerprint: sha256Hex(
                JSON.stringify({ executionId: execution.executionId, state: 'lease-reconciled' }),
              ),
              confidence: 0,
              cleanup,
              error: 'Execution lease expired and was finalized by reconciliation.',
            },
            reconcilerId,
          );
          reconciled.push({ ...execution, cleanupVerified: cleanup.verifiedAbsent });
        } catch (error) {
          logger.error(
            { error, executionId: execution.executionId },
            'Sandbox stale execution could not be finalized during reconciliation',
          );
        } finally {
          clearInterval(heartbeat);
        }
      }
      const docker = await provider.reconcile(staleBefore);
      if (
        reconciled.length > 0 ||
        docker.removedContainers.length > 0 ||
        docker.removedVolumes.length > 0
      ) {
        logger.warn(
          {
            reconciledExecutions: reconciled,
            removedContainers: docker.removedContainers,
            removedVolumes: docker.removedVolumes,
          },
          'Sandbox reconciliation finalized stale executions and removed orphaned resources',
        );
      }
    },
    async close() {
      await worker.close();
    },
  };
}
