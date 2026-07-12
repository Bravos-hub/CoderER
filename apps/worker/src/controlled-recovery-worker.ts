import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  AgentRunStatus,
  AiProvider,
  CONTROLLED_RECOVERY_JOB,
  CONTROLLED_RECOVERY_QUEUE,
  ControlledRecoveryJobSchema,
  InvestigationAgentKind,
  InvestigationCitationSchema,
  PatchVersionSchema,
  PatchVersionStatus,
  RecoveryRunStatus,
  RecoverySecurityDecision,
  RecoverySecurityReviewSchema,
  RecoveryVerificationCheckStatus,
  RecoveryVerificationReportSchema,
  RecoveryVerificationStatus,
  SandboxCommandPhase,
  SandboxCommandRequestSchema,
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxResult,
  StartReproductionSchema,
  type ControlledRecoveryJob,
  type InvestigationCitation,
  type PatchFile,
  type RecoveryVerificationCheck,
  type SandboxCommandRequest,
} from '@codeer/contracts';
import type { loadWorkerConfig } from '@codeer/config';
import { RecoveryStore } from '@codeer/database';
import { OpenAIResponsesGateway, type ModelGateway, type StructuredModelResult } from '@codeer/ai';
import { canonicalJson } from '@codeer/incidents';
import { logger } from '@codeer/logger';
import { RepositoryReadOnlyInspector } from '@codeer/repository';
import {
  RECOVERY_REPAIR_INSTRUCTIONS,
  RECOVERY_SECURITY_REVIEW_INSTRUCTIONS,
  RecoveryPatchDraftSchema,
  RecoverySecurityReviewDraftSchema,
  RecoveryWorktreeManager,
  buildPullRequestPackage,
  evaluatePatchPolicy,
  isGeneratedPath,
  isSecuritySensitivePath,
  parseUnifiedDiff,
  recoveryPatchDraftJsonSchema,
  recoverySecurityReviewJsonSchema,
  type RecoveryPatchDraft,
  type RecoverySecurityReviewDraft,
} from '@codeer/recovery';
import { redactSecretsFromValue, sha256Hex } from '@codeer/security';
import { DockerSandboxProvider, SandboxOrchestrator, evaluateSandboxPolicy } from '@codeer/sandbox';

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;

interface RuntimeOptions {
  config: WorkerConfig;
  connection: ConnectionOptions;
  workerId: string;
  store?: RecoveryStore;
  modelGateway?: ModelGateway;
}

interface RecoveryContextRow {
  sourceRelativePath: string;
  currentPatchVersion: number | null;
  defaultBranch: string;
  goal: string;
  risk: string;
  verificationMatrix: unknown;
  rollbackStrategy: string;
  compatibilityImpact: string;
  migrationImpact: string;
  knownLimitations: unknown;
  diagnosisSummary: string;
  diagnosisHash: string;
  originalFailureSignature: unknown;
  reproductionInput: unknown;
  steps: Array<Record<string, unknown>>;
}

const PROMPT_VERSION = 'codeer-recovery/2026-07-13.1';
const REPAIR_SCHEMA = 'codeer_recovery_patch_v1';
const SECURITY_SCHEMA = 'codeer_recovery_security_review_v1';

function modelGateway(config: WorkerConfig): ModelGateway {
  if (!config.OPENAI_API_KEY) {
    return {
      generateStructured() {
        return Promise.reject(
          new Error('OpenAI provider credentials are not configured for the recovery worker.'),
        );
      },
      cancel() {
        return Promise.resolve();
      },
    };
  }
  return new OpenAIResponsesGateway({
    apiKey: config.OPENAI_API_KEY,
    baseUrl: config.OPENAI_BASE_URL,
    ...(config.OPENAI_ORGANIZATION ? { organization: config.OPENAI_ORGANIZATION } : {}),
    ...(config.OPENAI_PROJECT ? { project: config.OPENAI_PROJECT } : {}),
  });
}

function safeError(error: unknown): { code: string; message: string; status: RecoveryRunStatus } {
  const message = error instanceof Error ? error.message : 'Unknown controlled-recovery failure.';
  const bounded = message.slice(0, 2_000);
  if (/cancel/i.test(message))
    return { code: 'RECOVERY_CANCELLED', message: bounded, status: RecoveryRunStatus.CANCELLED };
  if (/timeout|timed out/i.test(message))
    return { code: 'RECOVERY_TIMED_OUT', message: bounded, status: RecoveryRunStatus.TIMED_OUT };
  if (/budget|token|cost/i.test(message))
    return {
      code: 'RECOVERY_BUDGET_EXCEEDED',
      message: bounded,
      status: RecoveryRunStatus.BUDGET_EXCEEDED,
    };
  if (/security review|security-sensitive|credential|secret|injection|privilege/i.test(message))
    return {
      code: 'RECOVERY_SECURITY_REJECTED',
      message: bounded,
      status: RecoveryRunStatus.SECURITY_REJECTED,
    };
  if (/patch|diff|hunk|scope|path|binary|generated|lockfile|workflow|migration/i.test(message))
    return {
      code: 'RECOVERY_PATCH_REJECTED',
      message: bounded,
      status: RecoveryRunStatus.PATCH_REJECTED,
    };
  if (/verification|sandbox|original failure|quality gate/i.test(message))
    return {
      code: 'RECOVERY_VERIFICATION_FAILED',
      message: bounded,
      status: RecoveryRunStatus.VERIFICATION_FAILED,
    };
  if (/worktree|base commit|recovery branch|git /i.test(message))
    return {
      code: 'RECOVERY_WORKTREE_FAILED',
      message: bounded,
      status: RecoveryRunStatus.WORKTREE_FAILED,
    };
  if (/OpenAI|model|structured output/i.test(message))
    return {
      code: 'RECOVERY_MODEL_FAILED',
      message: bounded,
      status: RecoveryRunStatus.MODEL_FAILED,
    };
  return { code: 'RECOVERY_TOOL_FAILED', message: bounded, status: RecoveryRunStatus.TOOL_FAILED };
}

function asContext(value: unknown): RecoveryContextRow {
  if (!value || typeof value !== 'object') throw new Error('Recovery context is missing.');
  const row = value as Record<string, unknown>;
  const steps = Array.isArray(row.steps)
    ? row.steps.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : [];
  if (
    typeof row.sourceRelativePath !== 'string' ||
    typeof row.defaultBranch !== 'string' ||
    typeof row.goal !== 'string' ||
    typeof row.risk !== 'string' ||
    typeof row.rollbackStrategy !== 'string' ||
    typeof row.diagnosisSummary !== 'string' ||
    typeof row.diagnosisHash !== 'string' ||
    steps.length === 0
  ) {
    throw new Error('Recovery context is incomplete or malformed.');
  }
  return {
    sourceRelativePath: row.sourceRelativePath,
    currentPatchVersion:
      typeof row.currentPatchVersion === 'number' && Number.isInteger(row.currentPatchVersion)
        ? row.currentPatchVersion
        : null,
    defaultBranch: row.defaultBranch,
    goal: row.goal,
    risk: row.risk,
    verificationMatrix: row.verificationMatrix,
    rollbackStrategy: row.rollbackStrategy,
    compatibilityImpact:
      typeof row.compatibilityImpact === 'string' ? row.compatibilityImpact : 'Not recorded.',
    migrationImpact:
      typeof row.migrationImpact === 'string' ? row.migrationImpact : 'Not recorded.',
    knownLimitations: row.knownLimitations,
    diagnosisSummary: row.diagnosisSummary,
    diagnosisHash: row.diagnosisHash,
    originalFailureSignature: row.originalFailureSignature,
    reproductionInput: row.reproductionInput,
    steps,
  };
}

function citationsFromStep(step: Record<string, unknown>): InvestigationCitation[] {
  if (!Array.isArray(step.citations)) return [];
  return step.citations.flatMap((entry) => {
    const parsed = InvestigationCitationSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function affectedComponents(step: Record<string, unknown>): string[] {
  if (!Array.isArray(step.affectedComponents)) return [];
  return step.affectedComponents
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replaceAll('\\', '/').replace(/^\.\//, '').trim())
    .filter(Boolean);
}

function recoveryModel(config: WorkerConfig, requested?: string): string {
  const model = requested ?? config.AI_DEFAULT_MODEL;
  if (!config.AI_ALLOWED_MODELS.includes(model)) throw new Error(`Model policy rejected ${model}.`);
  return model;
}

function calculateCost(config: WorkerConfig, result: StructuredModelResult<unknown>): number {
  const pricing = config.AI_MODEL_PRICING_JSON[result.model];
  if (config.NODE_ENV === 'production' && !pricing) {
    throw new Error(`AI budget pricing is not configured for ${result.model}.`);
  }
  if (!pricing) return 0;
  return (
    ((result.usage.inputTokens - result.usage.cachedInputTokens) * pricing.inputUsdPerMillion +
      result.usage.cachedInputTokens * pricing.cachedInputUsdPerMillion +
      result.usage.outputTokens * pricing.outputUsdPerMillion) /
    1_000_000
  );
}

function buildProvenance(
  draft: RecoveryPatchDraft,
  steps: Array<Record<string, unknown>>,
  allowedCitationKeys: ReadonlySet<string>,
): Record<string, { treatmentPlanStep: number; citations: InvestigationCitation[] }> {
  const stepNumbers = new Set(steps.map((step) => Number(step.sequence)).filter(Number.isInteger));
  const result: Record<string, { treatmentPlanStep: number; citations: InvestigationCitation[] }> =
    {};
  for (const entry of draft.provenance) {
    const pathValue = entry.path.replaceAll('\\', '/').replace(/^\.\//, '');
    if (result[pathValue]) throw new Error(`Duplicate patch provenance for ${pathValue}.`);
    if (!stepNumbers.has(entry.treatmentPlanStep)) {
      throw new Error(
        `Patch provenance references an unknown treatment-plan step: ${entry.treatmentPlanStep}.`,
      );
    }
    for (const citation of entry.citations) {
      const key = `${citation.sourceId}:${citation.digest}`;
      if (!allowedCitationKeys.has(key))
        throw new Error(`Patch provenance contains an untrusted citation: ${citation.sourceId}.`);
    }
    result[pathValue] = {
      treatmentPlanStep: entry.treatmentPlanStep,
      citations: entry.citations,
    };
  }
  return result;
}

async function digestFile(root: string, relativePath: string | null): Promise<string | null> {
  if (!relativePath) return null;
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Patch digest path escaped the worktree.');
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      throw new Error('Patch target is not a regular file.');
    return sha256Hex(await readFile(candidate));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function enrichFileDigests(
  files: PatchFile[],
  sourceRoot: string,
  recoveryRoot: string,
  patchId: string,
): Promise<PatchFile[]> {
  return await Promise.all(
    files.map(async (file) => {
      const effective = file.newPath ?? file.oldPath ?? '';
      return {
        ...file,
        patchId,
        oldDigest: await digestFile(sourceRoot, file.oldPath),
        newDigest: await digestFile(recoveryRoot, file.newPath),
        generated: isGeneratedPath(effective),
        sensitive: isSecuritySensitivePath(effective),
        hunks: file.hunks.map((hunk) => ({ ...hunk, fileId: file.id })),
      };
    }),
  );
}

function originalFailureText(context: RecoveryContextRow): string {
  const signature = context.originalFailureSignature as Record<string, unknown> | null;
  if (signature && typeof signature.normalized === 'string' && signature.normalized.length >= 3) {
    return signature.normalized;
  }
  const reproduction = context.reproductionInput as Record<string, unknown> | null;
  const failureSignature = reproduction?.failureSignature as Record<string, unknown> | undefined;
  if (
    typeof failureSignature?.expectedText === 'string' &&
    failureSignature.expectedText.length >= 3
  ) {
    return failureSignature.expectedText;
  }
  throw new Error('Original failure signature is unavailable for independent verification.');
}

function verificationCommands(context: RecoveryContextRow): SandboxCommandRequest[] {
  const commands: SandboxCommandRequest[] = [];
  for (const step of context.steps) {
    const values = Array.isArray(step.verificationCommands) ? step.verificationCommands : [];
    for (const candidate of values) {
      const parsed = SandboxCommandRequestSchema.safeParse(candidate);
      if (parsed.success) commands.push(parsed.data);
    }
  }
  return commands;
}

function verificationCheck(
  verificationId: string,
  sequence: number,
  command: SandboxCommandRequest,
  result: {
    status: string;
    exitCode: number | null;
    id: string;
    startedAt: string;
    completedAt: string;
  },
): RecoveryVerificationCheck {
  const passed = result.status === 'SUCCEEDED';
  return {
    id: randomUUID(),
    verificationId,
    sequence,
    name: `${command.executable} ${command.arguments.join(' ')}`.slice(0, 240),
    command,
    mandatory: true,
    status: passed
      ? RecoveryVerificationCheckStatus.PASSED
      : RecoveryVerificationCheckStatus.FAILED,
    exitCode: result.exitCode,
    evidenceIds: [result.id],
    summary: passed ? 'Sandbox command passed.' : 'Sandbox command failed.',
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  };
}

export function createControlledRecoveryWorker(options: RuntimeOptions): {
  worker: Worker;
  reconcile(): Promise<void>;
  close(): Promise<void>;
} {
  const { config, connection, workerId } = options;
  const store = options.store ?? new RecoveryStore();
  const gateway = options.modelGateway ?? modelGateway(config);
  const worktrees = new RecoveryWorktreeManager(
    config.REPOSITORY_WORKSPACE_ROOT,
    config.RECOVERY_WORKTREE_ROOT,
  );
  const inspector = new RepositoryReadOnlyInspector(config.REPOSITORY_WORKSPACE_ROOT);
  const provider = new DockerSandboxProvider({
    dockerHost: config.SANDBOX_DOCKER_HOST,
    dockerTlsVerify: config.SANDBOX_DOCKER_TLS_VERIFY,
    dockerCertPath: config.SANDBOX_DOCKER_CERT_PATH,
    helperImage: config.SANDBOX_HELPER_IMAGE,
    trustedWorkspaceRoot: config.RECOVERY_WORKTREE_ROOT,
    commandOutputLimitBytes: config.SANDBOX_COMMAND_OUTPUT_LIMIT_BYTES,
    workspaceVolumeDriver: config.SANDBOX_WORKSPACE_VOLUME_DRIVER,
    workspaceVolumeSizeOption: config.SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION,
  });
  const sandbox = new SandboxOrchestrator(provider);

  async function processRecovery(
    payload: ControlledRecoveryJob,
    progress: (value: Record<string, unknown>) => Promise<void>,
  ): Promise<unknown> {
    const leaseSeconds = Math.ceil(config.RECOVERY_LEASE_MS / 1_000);
    const envelope = await store.acquireLease(payload.recoveryId, workerId, leaseSeconds);
    if (!envelope) return { skipped: true, reason: 'lease-not-acquired' };
    if (
      envelope.status === RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL ||
      envelope.status === RecoveryRunStatus.READY_TO_PUBLISH ||
      envelope.status === RecoveryRunStatus.PUBLISHED
    ) {
      return { skipped: true, reason: `recovery-is-${envelope.status.toLowerCase()}` };
    }

    let heartbeatFailure: Error | null = null;
    const heartbeat = setInterval(
      () => {
        void store
          .heartbeat(envelope.organizationId, envelope.id, workerId, leaseSeconds)
          .then(({ cancellationRequested }) => {
            if (cancellationRequested)
              heartbeatFailure = new Error('Recovery cancellation was requested.');
          })
          .catch((error: unknown) => {
            heartbeatFailure =
              error instanceof Error ? error : new Error('Recovery heartbeat failed.');
          });
      },
      Math.max(5_000, Math.floor(config.RECOVERY_LEASE_MS / 3)),
    );
    heartbeat.unref();

    let descriptor: Awaited<ReturnType<RecoveryWorktreeManager['create']>> | null = null;
    let success = false;
    let cleanupError: Error | null = null;
    let primaryFailure: ReturnType<typeof safeError> | null = null;
    const checkControl = async (): Promise<void> => {
      if (heartbeatFailure) throw heartbeatFailure;
      const state = await store.heartbeat(
        envelope.organizationId,
        envelope.id,
        workerId,
        leaseSeconds,
      );
      if (state.cancellationRequested) throw new Error('Recovery cancellation was requested.');
    };

    try {
      const context = asContext(
        await store.loadRecoveryContext(envelope.organizationId, envelope.id),
      );
      if (envelope.status !== RecoveryRunStatus.REQUESTED) {
        await store.restartForRetry(
          envelope.organizationId,
          envelope.id,
          workerId,
          envelope.status,
        );
      }
      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.POLICY_CHECK,
        {
          policyVersion: envelope.policy.policyVersion,
          planVersion: envelope.treatmentPlanVersion,
          baseCommitSha: envelope.baseCommitSha,
        },
        'RECOVERY_POLICY_CHECKED',
      );
      await progress({ stage: RecoveryRunStatus.POLICY_CHECK, percent: 5 });
      await checkControl();

      const declaredPaths = [...new Set(context.steps.flatMap(affectedComponents))];
      if (declaredPaths.length === 0)
        throw new Error('Approved treatment plan declares no affected components.');
      const outside = declaredPaths.filter(
        (candidate) =>
          !envelope.policy.allowedPaths.some(
            (allowed) =>
              candidate === allowed || candidate.startsWith(`${allowed.replace(/\/$/, '')}/`),
          ),
      );
      if (outside.length > 0)
        throw new Error(`Treatment-plan scope exceeds recovery policy: ${outside.join(', ')}`);

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.WORKTREE_PREPARING,
        { declaredPaths },
        'RECOVERY_WORKTREE_PREPARING',
      );
      descriptor = await worktrees.create(
        context.sourceRelativePath,
        envelope.baseCommitSha,
        envelope.branchName,
        envelope.id,
      );
      const relativeRecoveryPath = path.relative(
        config.RECOVERY_WORKTREE_ROOT,
        descriptor.worktreePath,
      );
      await store.recordWorktree({
        organizationId: envelope.organizationId,
        recoveryId: envelope.id,
        workerId,
        relativePath: relativeRecoveryPath,
        repositoryPathRef: context.sourceRelativePath,
        branchName: descriptor.branchName,
        baseCommitSha: descriptor.baseCommitSha,
      });
      await progress({ stage: RecoveryRunStatus.WORKTREE_PREPARING, percent: 15 });
      await checkControl();

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.PATCH_PLANNING,
        { declaredPaths, diagnosisHash: context.diagnosisHash },
        'RECOVERY_PATCH_PLANNING',
      );
      const sourceWorktree = await inspector.resolveWorktree(context.sourceRelativePath);
      const contextFiles = [];
      const allowedCitationKeys = new Set<string>();
      for (const step of context.steps) {
        for (const citation of citationsFromStep(step)) {
          allowedCitationKeys.add(`${citation.sourceId}:${citation.digest}`);
        }
        for (const component of affectedComponents(step).slice(0, 50)) {
          try {
            const file = await inspector.readFileRange(
              sourceWorktree,
              component,
              1,
              500,
              512 * 1024,
            );
            contextFiles.push(file);
            allowedCitationKeys.add(`${file.sourceId}:${file.digest}`);
          } catch {
            // Components may be logical modules. Missing exact paths remain explicit in the prompt.
          }
        }
      }
      const manifest = await inspector.getManifest(sourceWorktree);
      const configSummary = await inspector.getConfigSummary(sourceWorktree);
      const safeEvidence = redactSecretsFromValue({
        diagnosis: { summary: context.diagnosisSummary, hash: context.diagnosisHash },
        treatmentPlan: {
          goal: context.goal,
          risk: context.risk,
          steps: context.steps,
          verificationMatrix: context.verificationMatrix,
          compatibilityImpact: context.compatibilityImpact,
          migrationImpact: context.migrationImpact,
          additionalConstraints: envelope.input.additionalConstraints,
        },
        repositoryFiles: contextFiles,
        manifest,
        configuration: configSummary,
        recoveryPolicy: envelope.policy,
      }).value;
      const model = recoveryModel(config, envelope.input.requestedModel);
      const repairInput = [
        'Generate the smallest safe unified diff for the approved treatment plan.',
        'Only use evidence citations supplied in this context.',
        'BEGIN_UNTRUSTED_RECOVERY_EVIDENCE',
        canonicalJson(safeEvidence),
        'END_UNTRUSTED_RECOVERY_EVIDENCE',
      ].join('\n');

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.PATCH_GENERATING,
        { model, promptVersion: PROMPT_VERSION },
        'RECOVERY_PATCH_GENERATING',
      );
      const repair = await gateway.generateStructured<RecoveryPatchDraft>({
        provider: AiProvider.OPENAI,
        model,
        agent: InvestigationAgentKind.PLAN_COMPOSER,
        instructions: RECOVERY_REPAIR_INSTRUCTIONS,
        input: repairInput,
        schemaName: REPAIR_SCHEMA,
        schema: recoveryPatchDraftJsonSchema,
        validator: RecoveryPatchDraftSchema,
        maximumOutputTokens: Math.min(config.AI_MAX_OUTPUT_TOKENS, 20_000),
        timeoutMs: config.AI_TIMEOUT_MS,
        metadata: {
          recovery_id: envelope.id,
          incident_id: envelope.incidentId,
          stage: 'repair',
          policy_version: envelope.policy.policyVersion,
        },
        safetyIdentifier: sha256Hex(`${envelope.organizationId}:${envelope.requestedBy}`).slice(
          0,
          64,
        ),
        store: config.AI_STORE_PROVIDER_RESPONSES,
      });
      const repairCost = calculateCost(config, repair);
      if (repairCost > config.AI_MAX_COST_USD)
        throw new Error('Recovery model cost budget exceeded.');
      await store.recordAgentRun({
        organizationId: envelope.organizationId,
        recoveryId: envelope.id,
        workerId,
        kind: 'REPAIR',
        status: AgentRunStatus.COMPLETED,
        model: repair.model,
        promptVersion: PROMPT_VERSION,
        schemaName: REPAIR_SCHEMA,
        inputHash: sha256Hex(repairInput),
        outputHash: repair.outputHash,
        providerRequestId: repair.providerRequestId,
        providerResponseId: repair.providerResponseId,
        usage: repair.usage,
        estimatedCostUsd: repairCost,
        durationMs: repair.durationMs,
      });
      await progress({ stage: RecoveryRunStatus.PATCH_GENERATING, percent: 35 });
      await checkControl();

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.PATCH_VALIDATING,
        { modelOutputHash: repair.outputHash },
        'RECOVERY_PATCH_VALIDATING',
      );
      const provenance = buildProvenance(repair.output, context.steps, allowedCitationKeys);
      const parsed = parseUnifiedDiff(repair.output.unifiedDiff, provenance);
      const policyDecision = evaluatePatchPolicy(
        envelope.policy,
        parsed.files,
        Buffer.byteLength(repair.output.unifiedDiff, 'utf8'),
      );
      if (!policyDecision.allowed)
        throw new Error(`Patch policy rejected the change: ${policyDecision.reasons.join(' ')}`);
      await worktrees.applyPatchAtomically(descriptor.worktreePath, repair.output.unifiedDiff);
      const appliedDiff = await worktrees.diff(descriptor.worktreePath, envelope.baseCommitSha);
      const applied = parseUnifiedDiff(appliedDiff, provenance);
      const proposedPaths = parsed.files.map((file) => file.newPath ?? file.oldPath).sort();
      const appliedPaths = applied.files.map((file) => file.newPath ?? file.oldPath).sort();
      if (canonicalJson(proposedPaths) !== canonicalJson(appliedPaths)) {
        throw new Error('Applied patch changed a different file set than the approved proposal.');
      }
      const patchId = randomUUID();
      const files = await enrichFileDigests(
        applied.files,
        sourceWorktree,
        descriptor.worktreePath,
        patchId,
      );
      const patch = PatchVersionSchema.parse({
        id: patchId,
        recoveryId: envelope.id,
        version: (context.currentPatchVersion ?? 0) + 1,
        status: PatchVersionStatus.ACCEPTED,
        baseCommitSha: envelope.baseCommitSha,
        unifiedDiff: appliedDiff,
        patchDigest: sha256Hex(appliedDiff),
        changedFiles: files.length,
        addedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
        deletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
        files,
        policyDecision,
        createdAt: new Date().toISOString(),
      });
      await store.recordPatch(envelope.organizationId, envelope.id, workerId, patch);
      await progress({ stage: RecoveryRunStatus.PATCH_VALIDATING, percent: 50 });
      await checkControl();

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.SECURITY_REVIEW,
        { patchId, patchDigest: patch.patchDigest },
        'RECOVERY_SECURITY_REVIEW_STARTED',
      );
      const securityInput = [
        'Independently review this patch. Do not rely on the repair agent conclusion.',
        'BEGIN_UNTRUSTED_PATCH',
        appliedDiff,
        'END_UNTRUSTED_PATCH',
        'BEGIN_TRUSTED_POLICY_SUMMARY',
        canonicalJson({
          policy: envelope.policy,
          treatmentPlan: context.steps,
          diagnosis: context.diagnosisSummary,
        }),
        'END_TRUSTED_POLICY_SUMMARY',
      ].join('\n');
      const security = await gateway.generateStructured<RecoverySecurityReviewDraft>({
        provider: AiProvider.OPENAI,
        model,
        agent: InvestigationAgentKind.SECURITY_REVIEWER,
        instructions: RECOVERY_SECURITY_REVIEW_INSTRUCTIONS,
        input: securityInput,
        schemaName: SECURITY_SCHEMA,
        schema: recoverySecurityReviewJsonSchema,
        validator: RecoverySecurityReviewDraftSchema,
        maximumOutputTokens: Math.min(config.AI_MAX_OUTPUT_TOKENS, 8_000),
        timeoutMs: config.AI_TIMEOUT_MS,
        metadata: {
          recovery_id: envelope.id,
          incident_id: envelope.incidentId,
          stage: 'security_review',
          patch_digest: patch.patchDigest,
        },
        safetyIdentifier: sha256Hex(
          `${envelope.organizationId}:${envelope.requestedBy}:security`,
        ).slice(0, 64),
        store: config.AI_STORE_PROVIDER_RESPONSES,
      });
      const securityCost = calculateCost(config, security);
      if (repairCost + securityCost > config.AI_MAX_COST_USD)
        throw new Error('Recovery model cost budget exceeded.');
      for (const finding of security.output.findings) {
        if (
          finding.citation &&
          !allowedCitationKeys.has(`${finding.citation.sourceId}:${finding.citation.digest}`)
        ) {
          throw new Error('Security review referenced an untrusted citation.');
        }
      }
      await store.recordAgentRun({
        organizationId: envelope.organizationId,
        recoveryId: envelope.id,
        workerId,
        kind: 'SECURITY_REVIEWER',
        status: AgentRunStatus.COMPLETED,
        model: security.model,
        promptVersion: PROMPT_VERSION,
        schemaName: SECURITY_SCHEMA,
        inputHash: sha256Hex(securityInput),
        outputHash: security.outputHash,
        providerRequestId: security.providerRequestId,
        providerResponseId: security.providerResponseId,
        usage: security.usage,
        estimatedCostUsd: securityCost,
        durationMs: security.durationMs,
      });
      const securityReview = RecoverySecurityReviewSchema.parse({
        id: randomUUID(),
        recoveryId: envelope.id,
        patchId,
        decision: security.output.decision,
        summary: security.output.summary,
        findings: security.output.findings,
        reviewerModel: security.model,
        contentHash: security.outputHash,
        createdAt: new Date().toISOString(),
      });
      await store.recordSecurityReview(
        envelope.organizationId,
        envelope.id,
        workerId,
        securityReview,
      );
      if (securityReview.decision !== RecoverySecurityDecision.ALLOW) {
        throw new Error(`Security review blocked publication: ${securityReview.summary}`);
      }
      await progress({ stage: RecoveryRunStatus.SECURITY_REVIEW, percent: 65 });
      await checkControl();

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.VERIFYING,
        { patchId, independentContext: true },
        'RECOVERY_VERIFICATION_STARTED',
      );
      const commands = verificationCommands(context);
      const installCommands = commands.filter(
        (command) => command.phase === SandboxCommandPhase.INSTALL,
      );
      const reproductionCommands = commands.filter(
        (command) => command.phase !== SandboxCommandPhase.INSTALL,
      );
      if (reproductionCommands.length === 0) {
        throw new Error('Independent verification has no approved reproduction commands.');
      }
      const previousInput = context.reproductionInput as Record<string, unknown> | null;
      const requestedImage =
        typeof previousInput?.image === 'string'
          ? previousInput.image
          : config.SANDBOX_DEFAULT_IMAGE;
      const sandboxInput = StartReproductionSchema.parse({
        image: requestedImage,
        installCommands,
        reproductionCommands: reproductionCommands.map((command) => ({
          ...command,
          phase: SandboxCommandPhase.REPRODUCE,
          networkMode: SandboxNetworkMode.NONE,
        })),
        failureSignature: {
          expectedText: originalFailureText(context),
          minimumSimilarity: 0.85,
          requireNonZeroExit: true,
        },
        repeatCount: 2,
        resourceLimits: {
          cpuCores: config.SANDBOX_CPU_CORES,
          memoryBytes: config.SANDBOX_MEMORY_BYTES,
          pids: config.SANDBOX_PIDS_LIMIT,
          workspaceBytes: config.SANDBOX_WORKSPACE_BYTES,
          tempBytes: config.SANDBOX_TEMP_BYTES,
          commandTimeoutMs: config.SANDBOX_COMMAND_TIMEOUT_MS,
          executionTimeoutMs: config.SANDBOX_EXECUTION_TIMEOUT_MS,
          maximumCommands: config.SANDBOX_MAX_COMMANDS,
          maximumLogBytes: config.SANDBOX_MAX_LOG_BYTES,
          maximumArtifactBytes: config.SANDBOX_MAX_ARTIFACT_BYTES,
        },
        networkPolicy: installCommands.length
          ? {
              mode: SandboxNetworkMode.RESTRICTED_INSTALL,
              allowedRegistries: config.SANDBOX_INSTALL_ALLOWED_REGISTRIES,
              allowedDomains: config.SANDBOX_INSTALL_ALLOWED_DOMAINS,
              denyPrivateNetworks: true,
              denyMetadataServices: true,
            }
          : { mode: SandboxNetworkMode.NONE },
        artifactPaths: [],
      });
      const sandboxPolicy = evaluateSandboxPolicy(sandboxInput, {
        production: config.NODE_ENV === 'production',
        approvedImageRegistries: config.SANDBOX_APPROVED_REGISTRIES,
        defaultImage: config.SANDBOX_DEFAULT_IMAGE,
        defaultResourceLimits: {
          cpuCores: config.SANDBOX_CPU_CORES,
          memoryBytes: config.SANDBOX_MEMORY_BYTES,
          pids: config.SANDBOX_PIDS_LIMIT,
          workspaceBytes: config.SANDBOX_WORKSPACE_BYTES,
          tempBytes: config.SANDBOX_TEMP_BYTES,
          commandTimeoutMs: config.SANDBOX_COMMAND_TIMEOUT_MS,
          executionTimeoutMs: config.SANDBOX_EXECUTION_TIMEOUT_MS,
          maximumCommands: config.SANDBOX_MAX_COMMANDS,
          maximumLogBytes: config.SANDBOX_MAX_LOG_BYTES,
          maximumArtifactBytes: config.SANDBOX_MAX_ARTIFACT_BYTES,
        },
        installationNetwork: config.SANDBOX_INSTALL_NETWORK,
        installationAllowedRegistries: config.SANDBOX_INSTALL_ALLOWED_REGISTRIES,
        installationAllowedDomains: config.SANDBOX_INSTALL_ALLOWED_DOMAINS,
        allowInstallScriptsOverride: config.SANDBOX_ALLOW_INSTALL_SCRIPTS_OVERRIDE,
      });
      if (!sandboxPolicy.allowed)
        throw new Error(
          `Verification sandbox policy blocked execution: ${sandboxPolicy.reasons.join(' ')}`,
        );
      const executionId = randomUUID();
      const reproductionId = randomUUID();
      const evidenceIds: string[] = [];
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort('timeout'),
        config.SANDBOX_EXECUTION_TIMEOUT_MS,
      );
      timeout.unref();
      const result = await sandbox
        .execute(
          {
            executionId,
            reproductionId,
            organizationId: envelope.organizationId,
            incidentId: envelope.incidentId,
            worktreePath: descriptor.worktreePath,
            input: sandboxInput,
            policy: sandboxPolicy,
          },
          {
            statusChanged: async (status) => {
              await progress({
                stage: RecoveryRunStatus.VERIFYING,
                sandboxStatus: status,
                percent: 75,
              });
            },
            commandStarted: () => Promise.resolve(),
            commandCompleted: () => Promise.resolve(),
            logChunks: (chunks) => {
              evidenceIds.push(...chunks.map((chunk) => chunk.id));
              return Promise.resolve();
            },
            artifactsCollected: (artifacts) => {
              evidenceIds.push(...artifacts.map((artifact) => artifact.id));
              return Promise.resolve();
            },
            cleanupCompleted: () => Promise.resolve(),
            cancellationRequested: async () => {
              await checkControl();
              return false;
            },
            heartbeat: checkControl,
          },
          abortController.signal,
        )
        .finally(() => clearTimeout(timeout));
      const afterVerificationDiff = await worktrees.diff(
        descriptor.worktreePath,
        envelope.baseCommitSha,
      );
      const unexpectedChanges =
        sha256Hex(afterVerificationDiff) === sha256Hex(appliedDiff)
          ? []
          : ['Verification changed the recovery worktree after patch acceptance.'];
      const verificationId = randomUUID();
      const checks = result.commands.map((commandResult, index) =>
        verificationCheck(
          verificationId,
          index + 1,
          [...installCommands, ...sandboxInput.reproductionCommands][commandResult.sequence - 1] ??
            sandboxInput.reproductionCommands[0]!,
          commandResult,
        ),
      );
      checks.push({
        id: randomUUID(),
        verificationId,
        sequence: checks.length + 1,
        name: 'Patch scope and cleanup integrity',
        mandatory: true,
        status:
          unexpectedChanges.length === 0 && result.cleanup.verifiedAbsent
            ? RecoveryVerificationCheckStatus.PASSED
            : RecoveryVerificationCheckStatus.FAILED,
        exitCode: null,
        evidenceIds: [...new Set(evidenceIds)].slice(0, 100),
        summary:
          unexpectedChanges.length === 0 && result.cleanup.verifiedAbsent
            ? 'Patch scope remained stable and sandbox cleanup was verified.'
            : 'Patch scope changed or sandbox cleanup could not be verified.',
        startedAt: null,
        completedAt: result.completedAt,
      });
      const originalFailureResolved =
        result.status === SandboxExecutionStatus.COMPLETED &&
        result.result === SandboxResult.NOT_REPRODUCED;
      const passed =
        originalFailureResolved &&
        unexpectedChanges.length === 0 &&
        result.cleanup.verifiedAbsent &&
        checks.every(
          (check) => !check.mandatory || check.status === RecoveryVerificationCheckStatus.PASSED,
        );
      const verificationContent = {
        result: result.result,
        status: result.status,
        environmentFingerprint: result.environmentFingerprint,
        originalFailureResolved,
        unexpectedChanges,
        checks,
      };
      const verification = RecoveryVerificationReportSchema.parse({
        id: verificationId,
        recoveryId: envelope.id,
        patchId,
        status: passed ? RecoveryVerificationStatus.PASSED : RecoveryVerificationStatus.FAILED,
        originalFailureResolved,
        unexpectedChanges,
        scopeExpanded: unexpectedChanges.length > 0,
        checks,
        summary: passed
          ? 'The original failure was not reproduced after the patch, all mandatory checks passed, and cleanup was verified.'
          : `Independent verification failed with sandbox result ${result.result}.`,
        confidence: passed ? Math.max(0.8, 1 - (result.comparison?.similarity ?? 0)) : 0,
        contentHash: sha256Hex(canonicalJson(verificationContent)),
        createdAt: new Date().toISOString(),
      });
      await store.recordVerification(envelope.organizationId, envelope.id, workerId, verification);
      if (!passed) throw new Error(verification.summary);
      await progress({ stage: RecoveryRunStatus.VERIFYING, percent: 85 });
      await checkControl();

      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.PACKAGE_BUILDING,
        { patchId, verificationId },
        'RECOVERY_PACKAGE_BUILDING',
      );
      const pullRequestPackage = buildPullRequestPackage({
        recoveryId: envelope.id,
        patch,
        diagnosis: { summary: context.diagnosisSummary },
        treatmentPlan: {
          goal: context.goal,
          risk: context.risk,
          steps: context.steps.map((step) => ({
            title: typeof step.title === 'string' ? step.title : 'Apply approved recovery step',
          })),
          knownLimitations: Array.isArray(context.knownLimitations)
            ? context.knownLimitations.filter((item): item is string => typeof item === 'string')
            : [],
          rollbackStrategy: context.rollbackStrategy,
        },
        securityReview,
        verification,
        headBranch: descriptor.branchName,
        baseBranch: context.defaultBranch,
      });
      await store.recordPullRequestPackage(
        envelope.organizationId,
        envelope.id,
        workerId,
        pullRequestPackage,
      );
      await store.checkpoint(
        envelope.organizationId,
        envelope.id,
        workerId,
        RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
        {
          packageId: pullRequestPackage.id,
          packageHash: pullRequestPackage.packageHash,
          requiredApprovals: envelope.policy.requiredPublicationApprovals,
        },
        'RECOVERY_AWAITING_PUBLICATION_APPROVAL',
      );
      await progress({ stage: RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL, percent: 100 });
      success = true;
      return {
        recoveryId: envelope.id,
        status: RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
        patchId,
        packageId: pullRequestPackage.id,
      };
    } catch (error) {
      primaryFailure = safeError(error);
      logger.error(
        {
          error,
          recoveryId: envelope.id,
          organizationId: envelope.organizationId,
          code: primaryFailure.code,
        },
        'Controlled recovery failed',
      );
      throw error;
    } finally {
      clearInterval(heartbeat);
      if (descriptor) {
        try {
          await worktrees.remove(
            descriptor.repositoryPath,
            descriptor.worktreePath,
            descriptor.branchName,
          );
          await store.markCleanup({
            organizationId: envelope.organizationId,
            recoveryId: envelope.id,
            workerId,
            worktreeAbsent: true,
            branchDeleted: true,
          });
        } catch (error) {
          cleanupError =
            error instanceof Error ? error : new Error('Recovery worktree cleanup failed.');
          await store
            .markCleanup({
              organizationId: envelope.organizationId,
              recoveryId: envelope.id,
              workerId,
              worktreeAbsent: false,
              branchDeleted: false,
              errorCode: 'RECOVERY_CLEANUP_FAILED',
              errorMessage: cleanupError.message,
            })
            .catch(() => undefined);
        }
      } else {
        await store
          .markCleanup({
            organizationId: envelope.organizationId,
            recoveryId: envelope.id,
            workerId,
            worktreeAbsent: true,
            branchDeleted: true,
          })
          .catch(() => undefined);
      }

      if (cleanupError) {
        await store
          .complete(
            envelope.organizationId,
            envelope.id,
            workerId,
            RecoveryRunStatus.CLEANUP_FAILED,
            'RECOVERY_CLEANUP_FAILED',
            primaryFailure
              ? `${primaryFailure.message} Cleanup also failed: ${cleanupError.message}`.slice(
                  0,
                  2_000,
                )
              : cleanupError.message,
          )
          .catch((completionError: unknown) =>
            logger.error(
              { completionError, recoveryId: envelope.id },
              'Unable to persist cleanup failure',
            ),
          );
      } else if (success) {
        await store
          .releaseLease(envelope.organizationId, envelope.id, workerId)
          .catch((releaseError: unknown) =>
            logger.error(
              { releaseError, recoveryId: envelope.id },
              'Unable to release recovery lease',
            ),
          );
      } else if (primaryFailure) {
        await store
          .complete(
            envelope.organizationId,
            envelope.id,
            workerId,
            primaryFailure.status,
            primaryFailure.code,
            primaryFailure.message,
          )
          .catch((completionError: unknown) =>
            logger.error(
              { completionError, recoveryId: envelope.id },
              'Unable to persist recovery failure',
            ),
          );
      }
    }
  }

  const worker = new Worker(
    CONTROLLED_RECOVERY_QUEUE,
    async (job: Job) => {
      if (job.name !== CONTROLLED_RECOVERY_JOB) {
        throw new Error(`Unsupported controlled-recovery job: ${job.name}`);
      }
      const payload = ControlledRecoveryJobSchema.parse(job.data);
      return await processRecovery(payload, async (value) => job.updateProgress(value));
    },
    { connection, concurrency: config.RECOVERY_CONCURRENCY },
  );

  return {
    worker,
    async reconcile() {
      const jobs = await store.listStaleRecoveryJobs(
        Math.ceil(config.RECOVERY_STALE_AFTER_MS / 1_000),
        config.RECOVERY_CONCURRENCY * 5,
      );
      for (const payload of jobs) {
        await processRecovery(payload, () => Promise.resolve()).catch((error: unknown) =>
          logger.error({ error, recoveryId: payload.recoveryId }, 'Recovery reconciliation failed'),
        );
      }
    },
    async close() {
      await worker.close();
    },
  };
}
