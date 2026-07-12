import { randomUUID } from 'node:crypto';
import {
  SandboxCleanupProofSchema,
  SandboxCommandResultSchema,
  SandboxCommandStatus,
  SandboxExecutionStatus,
  SandboxResult,
  type FailureSignatureComparison,
  type SandboxArtifact,
  type SandboxCleanupProof,
  type SandboxCommandRequest,
  type SandboxCommandResult,
  type SandboxPolicyDecision,
  type StartReproductionInput,
} from '@codeer/contracts';
import { sha256Hex } from '@codeer/security';
import { SandboxLogAccumulator } from './logs.js';
import { compareFailureSignatures } from './signatures.js';
import {
  SandboxPolicyViolationError,
  type PreparedSandbox,
  type SandboxOutputEvent,
  type SandboxProvider,
} from './provider.js';

export interface SandboxExecutionHooks {
  statusChanged(status: SandboxExecutionStatus, metadata?: Record<string, unknown>): Promise<void>;
  commandStarted(
    commandId: string,
    sequence: number,
    command: SandboxCommandRequest,
  ): Promise<void>;
  commandCompleted(result: SandboxCommandResult): Promise<void>;
  logChunks(chunks: ReturnType<SandboxLogAccumulator['append']>): Promise<void>;
  artifactsCollected(artifacts: SandboxArtifact[]): Promise<void>;
  cleanupCompleted(cleanup: SandboxCleanupProof): Promise<void>;
  cancellationRequested(): Promise<boolean>;
  heartbeat(): Promise<void>;
}

export interface SandboxExecutionRequest {
  executionId: string;
  reproductionId: string;
  organizationId: string;
  incidentId: string;
  worktreePath: string;
  input: StartReproductionInput;
  policy: SandboxPolicyDecision;
}

export interface SandboxExecutionResult {
  status: SandboxExecutionStatus;
  result: SandboxResult;
  commands: SandboxCommandResult[];
  artifacts: SandboxArtifact[];
  cleanup: SandboxCleanupProof;
  comparison: FailureSignatureComparison | null;
  environmentFingerprint: string;
  confidence: number;
  completedAt: string;
}

function commandResult(
  id: string,
  sequence: number,
  command: SandboxCommandRequest,
  outcome: Awaited<ReturnType<SandboxProvider['execute']>>,
): SandboxCommandResult {
  return SandboxCommandResultSchema.parse({
    id,
    sequence,
    phase: command.phase,
    executable: command.executable,
    arguments: command.arguments,
    workingDirectory: command.workingDirectory,
    status: outcome.status,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
    oomKilled: outcome.oomKilled,
    outputDigest: outcome.outputDigest,
    startedAt: outcome.startedAt.toISOString(),
    completedAt: outcome.completedAt.toISOString(),
  });
}

export class SandboxOrchestrator {
  constructor(private readonly provider: SandboxProvider) {}

  async execute(
    request: SandboxExecutionRequest,
    hooks: SandboxExecutionHooks,
    abortSignal?: AbortSignal,
  ): Promise<SandboxExecutionResult> {
    const logs = new SandboxLogAccumulator({
      executionId: request.executionId,
      maximumBytes: request.policy.resourceLimits.maximumLogBytes,
    });
    const commands: SandboxCommandResult[] = [];
    const reproductionOutputs: string[] = [];
    let prepared: PreparedSandbox | undefined;
    let comparison: FailureSignatureComparison | null = null;
    let artifacts: SandboxArtifact[] = [];
    let result = SandboxResult.INCONCLUSIVE;
    let status = SandboxExecutionStatus.INFRASTRUCTURE_FAILED;
    let cleanup: SandboxCleanupProof | undefined;
    let sequence = 0;
    let resourceLimitTerminated = false;

    const emit = async (event: SandboxOutputEvent, commandId: string | null) => {
      const chunks = logs.append(event.stream, event.content, commandId, event.occurredAt);
      if (chunks.length > 0) await hooks.logChunks(chunks);
    };

    try {
      await hooks.statusChanged(SandboxExecutionStatus.PREPARING);
      prepared = await this.provider.prepare({
        executionId: request.executionId,
        organizationId: request.organizationId,
        incidentId: request.incidentId,
        worktreePath: request.worktreePath,
        policy: request.policy,
      });
      await hooks.heartbeat();

      const executeCommand = async (command: SandboxCommandRequest) => {
        if (abortSignal?.aborted || (await hooks.cancellationRequested())) {
          throw new DOMException('Sandbox execution was cancelled.', 'AbortError');
        }
        sequence += 1;
        const commandId = randomUUID();
        await hooks.commandStarted(commandId, sequence, command);
        const outcome = await this.provider.execute(
          prepared as PreparedSandbox,
          command,
          request.policy,
          (event) => emit(event, commandId),
          abortSignal,
        );
        const mapped = commandResult(commandId, sequence, command, outcome);
        commands.push(mapped);
        await hooks.commandCompleted(mapped);
        await hooks.heartbeat();
        return outcome;
      };

      if (request.input.installCommands.length > 0) {
        await hooks.statusChanged(SandboxExecutionStatus.INSTALLING);
        for (const command of request.input.installCommands) {
          const outcome = await executeCommand(command);
          if (outcome.timedOut) {
            status = SandboxExecutionStatus.TIMED_OUT;
            result = SandboxResult.INFRASTRUCTURE_FAILED;
            throw new Error('Installation command timed out.');
          }
          if (outcome.oomKilled) resourceLimitTerminated = true;
          if (outcome.status !== SandboxCommandStatus.SUCCEEDED) {
            status = SandboxExecutionStatus.COMPLETED;
            result = SandboxResult.INCONCLUSIVE;
            throw new Error('Dependency installation failed before reproduction could begin.');
          }
        }
      }

      await hooks.statusChanged(SandboxExecutionStatus.REPRODUCING);
      const comparisons: FailureSignatureComparison[] = [];
      for (let repeat = 0; repeat < request.input.repeatCount; repeat += 1) {
        let runOutput = '';
        let observedNonZeroExit = false;
        for (const command of request.input.reproductionCommands) {
          const outcome = await executeCommand(command);
          runOutput += `${outcome.stdout}\n${outcome.stderr}\n`;
          observedNonZeroExit ||= (outcome.exitCode ?? 1) !== 0;
          if (outcome.oomKilled) resourceLimitTerminated = true;
          if (outcome.timedOut) {
            status = SandboxExecutionStatus.TIMED_OUT;
            result = SandboxResult.INFRASTRUCTURE_FAILED;
            throw new Error('Reproduction command timed out.');
          }
        }
        reproductionOutputs.push(runOutput);
        const candidate = compareFailureSignatures(
          request.input.failureSignature.expectedText,
          runOutput,
          request.input.failureSignature.minimumSimilarity,
        );
        const exitRequirementMet =
          !request.input.failureSignature.requireNonZeroExit || observedNonZeroExit;
        comparisons.push({ ...candidate, matched: candidate.matched && exitRequirementMet });
      }
      comparison = comparisons.sort((left, right) => right.similarity - left.similarity)[0] ?? null;
      const allMatched = comparisons.length > 0 && comparisons.every((entry) => entry.matched);
      const noneMatched = comparisons.every((entry) => !entry.matched);
      const consistent = comparisons.every(
        (entry) => entry.observed.digest === comparisons[0]?.observed.digest,
      );
      result =
        resourceLimitTerminated || logs.summary().truncated
          ? SandboxResult.INCONCLUSIVE
          : allMatched && consistent
            ? SandboxResult.REPRODUCED
            : noneMatched && consistent
              ? SandboxResult.NOT_REPRODUCED
              : SandboxResult.INCONCLUSIVE;

      await hooks.statusChanged(SandboxExecutionStatus.COLLECTING, { result });
      artifacts = await this.provider.collectArtifacts(
        prepared,
        request.input.artifactPaths,
        request.policy.resourceLimits.maximumArtifactBytes,
      );
      await hooks.artifactsCollected(artifacts);
      status = SandboxExecutionStatus.COMPLETED;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const reason: unknown = abortSignal?.reason;
        status =
          reason === 'timeout'
            ? SandboxExecutionStatus.TIMED_OUT
            : reason === 'cancelled'
              ? SandboxExecutionStatus.CANCELLED
              : SandboxExecutionStatus.INFRASTRUCTURE_FAILED;
        result =
          reason === 'cancelled' ? SandboxResult.INCONCLUSIVE : SandboxResult.INFRASTRUCTURE_FAILED;
      } else if (error instanceof SandboxPolicyViolationError) {
        status = SandboxExecutionStatus.POLICY_BLOCKED;
        result = SandboxResult.POLICY_BLOCKED;
      } else if (
        status !== SandboxExecutionStatus.TIMED_OUT &&
        status !== SandboxExecutionStatus.COMPLETED
      ) {
        status = SandboxExecutionStatus.INFRASTRUCTURE_FAILED;
        result = SandboxResult.INFRASTRUCTURE_FAILED;
      }
      await emit(
        {
          stream: 'system',
          content: error instanceof Error ? error.message : 'Sandbox execution failed.',
          occurredAt: new Date(),
        },
        null,
      );
    } finally {
      await hooks.statusChanged(SandboxExecutionStatus.CLEANING).catch(() => undefined);
      let cleanupOutcome;
      try {
        cleanupOutcome = prepared
          ? await this.provider.cleanup(prepared)
          : await this.provider.cleanupExecution(request.executionId);
      } catch (cleanupError) {
        cleanupOutcome = {
          containerIds: [],
          volumeIds: [],
          networkIds: [],
          verifiedAbsent: false,
          attempts: 1,
          error:
            cleanupError instanceof Error
              ? cleanupError.message.slice(0, 2_000)
              : 'Sandbox cleanup failed.',
          completedAt: new Date(),
        };
      }
      cleanup = SandboxCleanupProofSchema.parse({
        executionId: request.executionId,
        containerIds: cleanupOutcome.containerIds,
        volumeIds: cleanupOutcome.volumeIds,
        networkIds: cleanupOutcome.networkIds,
        verifiedAbsent: cleanupOutcome.verifiedAbsent,
        attempts: cleanupOutcome.attempts,
        digest: sha256Hex(JSON.stringify(cleanupOutcome)),
        error: cleanupOutcome.error,
        completedAt: cleanupOutcome.completedAt.toISOString(),
      });
      if (!cleanup.verifiedAbsent) status = SandboxExecutionStatus.CLEANUP_FAILED;
      await hooks.cleanupCompleted(cleanup).catch(() => undefined);
      await hooks
        .statusChanged(status, { result, logSummary: logs.summary() })
        .catch(() => undefined);
    }

    const averageSimilarity = comparison?.similarity ?? 0;
    const confidence = Number(
      (averageSimilarity * (result === SandboxResult.REPRODUCED ? 1 : 0.8)).toFixed(4),
    );
    return {
      status,
      result,
      commands,
      artifacts,
      cleanup,
      comparison,
      environmentFingerprint: sha256Hex(
        JSON.stringify({
          image: request.policy.image,
          imageIdentity: prepared?.imageIdentity ?? null,
          helperImageIdentity: prepared?.helperImageIdentity ?? null,
          policy: request.policy.policyVersion,
          commands: request.policy.normalizedCommands,
        }),
      ),
      confidence,
      completedAt: new Date().toISOString(),
    };
  }
}
