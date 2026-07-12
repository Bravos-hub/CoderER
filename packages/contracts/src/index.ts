import { z } from 'zod';

export enum IncidentSeverity {
  SEV1 = 'SEV-1',
  SEV2 = 'SEV-2',
  SEV3 = 'SEV-3',
  SEV4 = 'SEV-4',
}

export enum IncidentStatus {
  ADMITTED = 'ADMITTED',
  TRIAGING = 'TRIAGING',
  INVESTIGATING = 'INVESTIGATING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  RECOVERING = 'RECOVERING',
  VERIFYING = 'VERIFYING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum RecoveryStage {
  ADMIT = 'ADMIT',
  TRIAGE = 'TRIAGE',
  DIAGNOSE = 'DIAGNOSE',
  RECOVER = 'RECOVER',
  VERIFY = 'VERIFY',
}

export enum IncidentSource {
  MANUAL = 'MANUAL',
  GITHUB_ACTIONS = 'GITHUB_ACTIONS',
  WEBHOOK = 'WEBHOOK',
  API = 'API',
  MONITORING = 'MONITORING',
}

export enum ActorType {
  USER = 'USER',
  SERVICE = 'SERVICE',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
}

export enum ActorRole {
  ORGANIZATION_OWNER = 'ORGANIZATION_OWNER',
  ORGANIZATION_ADMIN = 'ORGANIZATION_ADMIN',
  INCIDENT_COMMANDER = 'INCIDENT_COMMANDER',
  RESPONDER = 'RESPONDER',
  VIEWER = 'VIEWER',
  SERVICE = 'SERVICE',
}

export enum IncidentPermission {
  READ = 'incident:read',
  CREATE = 'incident:create',
  ADD_EVIDENCE = 'incident:evidence:add',
  REQUEST_TRIAGE = 'incident:triage:request',
  TRANSITION = 'incident:transition',
  READ_AUDIT = 'incident:audit:read',
  OVERRIDE_SEVERITY = 'incident:severity:override',
  MANAGE_RESTRICTED_EVIDENCE = 'incident:evidence:restricted',
  REQUEST_REPRODUCTION = 'incident:reproduction:request',
  READ_REPRODUCTION = 'incident:reproduction:read',
  CANCEL_REPRODUCTION = 'incident:reproduction:cancel',
  OVERRIDE_SANDBOX_POLICY = 'incident:sandbox:override',
  START_INVESTIGATION = 'incident:investigation:start',
  READ_INVESTIGATION = 'incident:investigation:read',
  CANCEL_INVESTIGATION = 'incident:investigation:cancel',
  RESUME_INVESTIGATION = 'incident:investigation:resume',
  REQUEST_PLAN_REVISION = 'incident:treatment-plan:revision',
  APPROVE_TREATMENT_PLAN = 'incident:treatment-plan:approve',
  REJECT_TREATMENT_PLAN = 'incident:treatment-plan:reject',
  ADMINISTER_AI_POLICY = 'organization:ai-policy:manage',
  START_RECOVERY = 'incident:recovery:start',
  READ_RECOVERY = 'incident:recovery:read',
  CANCEL_RECOVERY = 'incident:recovery:cancel',
  RESUME_RECOVERY = 'incident:recovery:resume',
  REQUEST_RECOVERY_REVISION = 'incident:recovery:revision',
  APPROVE_RECOVERY_PUBLICATION = 'incident:recovery:publication:approve',
  REJECT_RECOVERY_PUBLICATION = 'incident:recovery:publication:reject',
  ADMINISTER_RECOVERY_POLICY = 'organization:recovery-policy:manage',
}

export enum RepositoryPermission {
  READ = 'repository:read',
  ADMIT = 'repository:admit',
}

export enum IncidentEventType {
  INCIDENT_ADMITTED = 'INCIDENT_ADMITTED',
  TRIAGE_REQUESTED = 'TRIAGE_REQUESTED',
  TRIAGE_STARTED = 'TRIAGE_STARTED',
  EVIDENCE_RECORDED = 'EVIDENCE_RECORDED',
  SEVERITY_ASSESSED = 'SEVERITY_ASSESSED',
  HEALTH_SNAPSHOT_RECORDED = 'HEALTH_SNAPSHOT_RECORDED',
  TRIAGE_COMPLETED = 'TRIAGE_COMPLETED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  RECOVERY_APPROVAL_REQUESTED = 'RECOVERY_APPROVAL_REQUESTED',
  RECOVERY_APPROVED = 'RECOVERY_APPROVED',
  INCIDENT_FAILED = 'INCIDENT_FAILED',
  INCIDENT_CANCELLED = 'INCIDENT_CANCELLED',
  REPRODUCTION_REQUESTED = 'REPRODUCTION_REQUESTED',
  SANDBOX_POLICY_APPROVED = 'SANDBOX_POLICY_APPROVED',
  SANDBOX_POLICY_BLOCKED = 'SANDBOX_POLICY_BLOCKED',
  SANDBOX_PREPARING = 'SANDBOX_PREPARING',
  REPRODUCTION_STARTED = 'REPRODUCTION_STARTED',
  FAILURE_REPRODUCED = 'FAILURE_REPRODUCED',
  FAILURE_NOT_REPRODUCED = 'FAILURE_NOT_REPRODUCED',
  REPRODUCTION_TIMED_OUT = 'REPRODUCTION_TIMED_OUT',
  REPRODUCTION_CANCELLATION_REQUESTED = 'REPRODUCTION_CANCELLATION_REQUESTED',
  REPRODUCTION_CANCELLED = 'REPRODUCTION_CANCELLED',
  REPRODUCTION_INCONCLUSIVE = 'REPRODUCTION_INCONCLUSIVE',
  SANDBOX_INFRASTRUCTURE_FAILED = 'SANDBOX_INFRASTRUCTURE_FAILED',
  SANDBOX_CLEANUP_COMPLETED = 'SANDBOX_CLEANUP_COMPLETED',
  SANDBOX_CLEANUP_FAILED = 'SANDBOX_CLEANUP_FAILED',
  INVESTIGATION_REQUESTED = 'INVESTIGATION_REQUESTED',
  INVESTIGATION_STARTED = 'INVESTIGATION_STARTED',
  INVESTIGATION_CHECKPOINTED = 'INVESTIGATION_CHECKPOINTED',
  INVESTIGATION_INSUFFICIENT_EVIDENCE = 'INVESTIGATION_INSUFFICIENT_EVIDENCE',
  INVESTIGATION_COMPLETED = 'INVESTIGATION_COMPLETED',
  INVESTIGATION_CANCELLED = 'INVESTIGATION_CANCELLED',
  INVESTIGATION_FAILED = 'INVESTIGATION_FAILED',
  DIAGNOSIS_PUBLISHED = 'DIAGNOSIS_PUBLISHED',
  TREATMENT_PLAN_PROPOSED = 'TREATMENT_PLAN_PROPOSED',
  TREATMENT_PLAN_APPROVAL_RECORDED = 'TREATMENT_PLAN_APPROVAL_RECORDED',
  TREATMENT_PLAN_REVISION_REQUESTED = 'TREATMENT_PLAN_REVISION_REQUESTED',
  TREATMENT_PLAN_APPROVED = 'TREATMENT_PLAN_APPROVED',
  TREATMENT_PLAN_REJECTED = 'TREATMENT_PLAN_REJECTED',
  AI_GUARDRAIL_BLOCKED = 'AI_GUARDRAIL_BLOCKED',
  AI_BUDGET_EXCEEDED = 'AI_BUDGET_EXCEEDED',
  RECOVERY_REQUESTED = 'RECOVERY_REQUESTED',
  RECOVERY_STARTED = 'RECOVERY_STARTED',
  RECOVERY_CHECKPOINTED = 'RECOVERY_CHECKPOINTED',
  RECOVERY_POLICY_BLOCKED = 'RECOVERY_POLICY_BLOCKED',
  RECOVERY_WORKTREE_READY = 'RECOVERY_WORKTREE_READY',
  RECOVERY_PATCH_PROPOSED = 'RECOVERY_PATCH_PROPOSED',
  RECOVERY_PATCH_REJECTED = 'RECOVERY_PATCH_REJECTED',
  RECOVERY_SECURITY_REVIEWED = 'RECOVERY_SECURITY_REVIEWED',
  RECOVERY_VERIFICATION_COMPLETED = 'RECOVERY_VERIFICATION_COMPLETED',
  RECOVERY_PACKAGE_READY = 'RECOVERY_PACKAGE_READY',
  RECOVERY_PUBLICATION_APPROVED = 'RECOVERY_PUBLICATION_APPROVED',
  RECOVERY_PUBLICATION_REJECTED = 'RECOVERY_PUBLICATION_REJECTED',
  RECOVERY_CANCELLED = 'RECOVERY_CANCELLED',
  RECOVERY_FAILED = 'RECOVERY_FAILED',
  RECOVERY_CLEANUP_COMPLETED = 'RECOVERY_CLEANUP_COMPLETED',
  RECOVERY_CLEANUP_FAILED = 'RECOVERY_CLEANUP_FAILED',
}

export enum EvidenceKind {
  ERROR = 'ERROR',
  LOG = 'LOG',
  COMMAND_OUTPUT = 'COMMAND_OUTPUT',
  CI_RUN = 'CI_RUN',
  REPOSITORY_METADATA = 'REPOSITORY_METADATA',
  CONFIGURATION = 'CONFIGURATION',
  TEST_RESULT = 'TEST_RESULT',
  BUILD_RESULT = 'BUILD_RESULT',
  USER_OBSERVATION = 'USER_OBSERVATION',
  HEALTH_SIGNAL = 'HEALTH_SIGNAL',
  SANDBOX_POLICY = 'SANDBOX_POLICY',
  SANDBOX_LOG = 'SANDBOX_LOG',
  SANDBOX_ARTIFACT = 'SANDBOX_ARTIFACT',
  FAILURE_REPRODUCTION = 'FAILURE_REPRODUCTION',
  SANDBOX_CLEANUP = 'SANDBOX_CLEANUP',
  INVESTIGATION_CONTEXT = 'INVESTIGATION_CONTEXT',
  ROOT_CAUSE_HYPOTHESIS = 'ROOT_CAUSE_HYPOTHESIS',
  DIAGNOSIS = 'DIAGNOSIS',
  TREATMENT_PLAN = 'TREATMENT_PLAN',
  AI_GUARDRAIL = 'AI_GUARDRAIL',
  RECOVERY_POLICY = 'RECOVERY_POLICY',
  RECOVERY_PATCH = 'RECOVERY_PATCH',
  RECOVERY_SECURITY_REVIEW = 'RECOVERY_SECURITY_REVIEW',
  RECOVERY_VERIFICATION = 'RECOVERY_VERIFICATION',
  PULL_REQUEST_PACKAGE = 'PULL_REQUEST_PACKAGE',
  RECOVERY_CLEANUP = 'RECOVERY_CLEANUP',
}

export enum EvidenceSource {
  USER = 'USER',
  GITHUB = 'GITHUB',
  SANDBOX = 'SANDBOX',
  CI = 'CI',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
}

export enum EvidenceSensitivity {
  PUBLIC = 'PUBLIC',
  INTERNAL = 'INTERNAL',
  CONFIDENTIAL = 'CONFIDENTIAL',
  RESTRICTED = 'RESTRICTED',
}

export enum HealthStatus {
  HEALTHY = 'HEALTHY',
  AT_RISK = 'AT_RISK',
  DEGRADED = 'DEGRADED',
  CRITICAL = 'CRITICAL',
}

export enum RepositoryProvider {
  GITHUB = 'GITHUB',
}

export enum RepositoryVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  INTERNAL = 'INTERNAL',
}

export enum RepositoryIntakeStatus {
  QUEUED = 'QUEUED',
  AUTHENTICATING = 'AUTHENTICATING',
  READING_METADATA = 'READING_METADATA',
  CLONING = 'CLONING',
  INSPECTING = 'INSPECTING',
  CREATING_WORKTREE = 'CREATING_WORKTREE',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

const UuidSchema = z.string().uuid();
const SafeLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:/-]+$/);

export const IncidentImpactSchema = z.object({
  availability: z.number().int().min(0).max(5).default(0),
  affectedUsers: z.number().int().min(0).max(1_000_000_000).default(0),
  revenueImpact: z.number().int().min(0).max(5).default(0),
  dataIntegrity: z.number().int().min(0).max(5).default(0),
  securityImpact: z.number().int().min(0).max(5).default(0),
  environment: z.enum(['development', 'test', 'staging', 'production']).default('development'),
});
export type IncidentImpact = z.infer<typeof IncidentImpactSchema>;

export const IncidentSignalsSchema = z.object({
  errorMessage: z.string().trim().min(1).max(20_000).optional(),
  failingCommand: z.string().trim().min(1).max(2_000).optional(),
  logExcerpt: z.string().max(100_000).optional(),
  ciRunUrl: z.string().url().max(2_048).optional(),
  affectedEnvironment: z.enum(['development', 'test', 'staging', 'production']).optional(),
  securityExposure: z.boolean().default(false),
  dataIntegrityRisk: z.boolean().default(false),
  productionUnavailable: z.boolean().default(false),
  deploymentBlocked: z.boolean().default(false),
  authenticationBroken: z.boolean().default(false),
  failingTests: z.boolean().default(false),
  dependencyIssue: z.boolean().default(false),
  apiContractMismatch: z.boolean().default(false),
  frontendFunctionalityFailure: z.boolean().default(false),
  workaroundAvailable: z.boolean().default(false),
  recurrenceCount: z.number().int().min(0).max(10_000).default(0),
});
export type IncidentSignals = z.infer<typeof IncidentSignalsSchema>;

export const CreateIncidentSchema = z
  .object({
    repositoryId: UuidSchema,
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(3).max(10_000),
    source: z.nativeEnum(IncidentSource).default(IncidentSource.MANUAL),
    severity: z.nativeEnum(IncidentSeverity).optional(),
    severityOverrideReason: z.string().trim().min(10).max(1_000).optional(),
    externalReference: z.string().trim().min(1).max(255).optional(),
    labels: z.array(SafeLabelSchema).max(20).default([]),
    reportedAt: z.string().datetime().optional(),
    impact: IncidentImpactSchema.optional(),
    signals: IncidentSignalsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.severity && !value.severityOverrideReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severityOverrideReason'],
        message: 'A documented reason is required when overriding calculated severity',
      });
    }
    if (!value.severity && value.severityOverrideReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severity'],
        message: 'severity must be supplied with severityOverrideReason',
      });
    }
  });
export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;

export const IncidentSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  repositoryId: UuidSchema,
  shortCode: z.string().regex(/^ER-[0-9]{8}-[A-Z0-9]{6}$/),
  title: z.string().min(3).max(160),
  description: z.string().min(3).max(10_000),
  source: z.nativeEnum(IncidentSource),
  severity: z.nativeEnum(IncidentSeverity),
  severityScore: z.number().int().min(0).max(100),
  severityReason: z.string().min(1).max(2_000),
  status: z.nativeEnum(IncidentStatus),
  stage: z.nativeEnum(RecoveryStage),
  externalReference: z.string().max(255).nullable(),
  labels: z.array(z.string()),
  version: z.number().int().positive(),
  reportedAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  repositoryId: UuidSchema.optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  source: z.nativeEnum(IncidentSource).optional(),
});
export type IncidentListQuery = z.infer<typeof IncidentListQuerySchema>;

export const IncidentListSchema = z.object({
  items: z.array(IncidentSchema),
  nextCursor: z.string().max(512).nullable(),
});
export type IncidentList = z.infer<typeof IncidentListSchema>;

export const IncidentEventSchema = z.object({
  id: UuidSchema,
  incidentId: UuidSchema,
  sequence: z.number().int().positive(),
  type: z.nativeEnum(IncidentEventType),
  payload: z.unknown(),
  actorType: z.nativeEnum(ActorType),
  actorId: z.string().max(255).nullable(),
  requestId: z.string().max(128).nullable(),
  correlationId: z.string().max(128).nullable(),
  causationId: z.string().max(128).nullable(),
  previousHash: z.string().length(64).nullable(),
  eventHash: z.string().length(64),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;

export const IncidentEventIntegritySchema = z.object({
  valid: z.boolean(),
  checkedEvents: z.number().int().nonnegative(),
  brokenSequence: z.number().int().positive().nullable(),
  reason: z.string().max(500).nullable(),
});
export type IncidentEventIntegrity = z.infer<typeof IncidentEventIntegritySchema>;

export const CreateEvidenceSchema = z
  .object({
    kind: z.nativeEnum(EvidenceKind),
    source: z.nativeEnum(EvidenceSource),
    sensitivity: z.nativeEnum(EvidenceSensitivity).default(EvidenceSensitivity.INTERNAL),
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().min(3).max(5_000),
    payload: z.unknown(),
    origin: z.string().trim().min(1).max(2_048).optional(),
    observedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    const serialized = JSON.stringify(value.payload);
    if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: 'Inline evidence payload must not exceed 256 KiB',
      });
    }
  });
export type CreateEvidenceInput = z.infer<typeof CreateEvidenceSchema>;

export const EvidenceSchema = CreateEvidenceSchema.safeExtend({
  id: UuidSchema,
  organizationId: UuidSchema,
  incidentId: UuidSchema,
  sessionId: UuidSchema.nullable(),
  digest: z.string().length(64),
  byteSize: z.number().int().nonnegative(),
  redacted: z.boolean(),
  redactionCount: z.number().int().nonnegative(),
  observedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SeverityAssessmentSchema = z.object({
  score: z.number().int().min(0).max(100),
  severity: z.nativeEnum(IncidentSeverity),
  calculatedSeverity: z.nativeEnum(IncidentSeverity),
  overrideApplied: z.boolean(),
  rationale: z.string().min(1).max(2_000),
  factors: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
  policyVersion: z.string().min(1).max(100),
});
export type SeverityAssessment = z.infer<typeof SeverityAssessmentSchema>;

export const RepositoryHealthDimensionsSchema = z.object({
  build: z.number().int().min(0).max(100),
  tests: z.number().int().min(0).max(100),
  deploymentReadiness: z.number().int().min(0).max(100),
  dependencies: z.number().int().min(0).max(100),
  security: z.number().int().min(0).max(100),
  apiConsistency: z.number().int().min(0).max(100),
  frontendFunctionality: z.number().int().min(0).max(100),
});
export type RepositoryHealthDimensions = z.infer<typeof RepositoryHealthDimensionsSchema>;

export const RepositoryHealthSnapshotSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  repositoryId: UuidSchema,
  incidentId: UuidSchema.nullable(),
  overallScore: z.number().int().min(0).max(100),
  status: z.nativeEnum(HealthStatus),
  dimensions: RepositoryHealthDimensionsSchema,
  evidenceCount: z.number().int().nonnegative(),
  calculationVersion: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
});
export type RepositoryHealthSnapshot = z.infer<typeof RepositoryHealthSnapshotSchema>;

export const IncidentDetailSchema = z.object({
  incident: IncidentSchema,
  latestSeverityAssessment: SeverityAssessmentSchema.nullable(),
  latestHealthSnapshot: RepositoryHealthSnapshotSchema.nullable(),
  evidence: z.array(EvidenceSchema),
  timeline: z.array(IncidentEventSchema),
  timelineIntegrity: IncidentEventIntegritySchema,
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

export const RequestTriageSchema = z.object({
  signals: IncidentSignalsSchema.optional(),
  force: z.boolean().default(false),
});
export type RequestTriageInput = z.infer<typeof RequestTriageSchema>;

export const TransitionIncidentSchema = z.object({
  toStatus: z.nativeEnum(IncidentStatus),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(5).max(2_000),
});
export type TransitionIncidentInput = z.infer<typeof TransitionIncidentSchema>;

export const IncidentTriageJobSchema = z.object({
  incidentId: UuidSchema,
  organizationId: UuidSchema,
  requestedAt: z.string().datetime(),
  requestedBy: z.string().min(1).max(255),
  requestId: z.string().max(128),
  correlationId: z.string().max(128),
  signals: IncidentSignalsSchema.optional(),
  attempt: z.number().int().positive().default(1),
});
export type IncidentTriageJob = z.infer<typeof IncidentTriageJobSchema>;

export const IncidentTriageResultSchema = z.object({
  incidentId: UuidSchema,
  status: z.nativeEnum(IncidentStatus),
  stage: z.nativeEnum(RecoveryStage),
  severityAssessment: SeverityAssessmentSchema,
  healthSnapshot: RepositoryHealthSnapshotSchema,
  evidenceIds: z.array(UuidSchema),
  completedAt: z.string().datetime(),
});
export type IncidentTriageResult = z.infer<typeof IncidentTriageResultSchema>;

export const GitHubRepositoryLocatorSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
});
export type GitHubRepositoryLocator = z.infer<typeof GitHubRepositoryLocatorSchema>;

const SAFE_GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

export const AdmitRepositorySchema = z.object({
  repositoryUrl: z
    .string()
    .url()
    .refine(
      (value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          url.hostname.toLowerCase() === 'github.com' &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.search &&
          !url.hash &&
          url.pathname.replace(/^\/+|\/+$/g, '').split('/').length === 2
        );
      },
      { message: 'Use the canonical https://github.com/owner/repository URL' },
    ),
  installationId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  baseBranch: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(SAFE_GIT_REF)
    .refine(
      (value) =>
        !value.includes('..') &&
        !value.endsWith('/') &&
        !value.startsWith('-') &&
        !value.includes('@{') &&
        !value.includes('\\'),
      { message: 'Base branch contains unsupported Git reference characters' },
    )
    .optional(),
});
export type AdmitRepositoryInput = z.infer<typeof AdmitRepositorySchema>;

export const RepositoryBranchSchema = z.object({
  name: z.string().min(1),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  protected: z.boolean(),
});
export type RepositoryBranch = z.infer<typeof RepositoryBranchSchema>;

export const RepositoryIntakeJobSchema = AdmitRepositorySchema.extend({
  intakeId: UuidSchema,
  organizationId: UuidSchema,
  requestedBy: z.string().min(1).max(255),
  requestId: z.string().min(1).max(128),
  requestedAt: z.string().datetime(),
});
export type RepositoryIntakeJob = z.infer<typeof RepositoryIntakeJobSchema>;

export const RepositoryIntakeResultSchema = z.object({
  intakeId: UuidSchema,
  repositoryId: UuidSchema.optional(),
  status: z.literal(RepositoryIntakeStatus.READY),
  repository: z.object({
    provider: z.literal(RepositoryProvider.GITHUB),
    providerRepositoryId: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    fullName: z.string().min(3),
    htmlUrl: z.string().url(),
    defaultBranch: z.string().min(1),
    selectedBaseBranch: z.string().min(1),
    visibility: z.nativeEnum(RepositoryVisibility),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
    branches: z.array(RepositoryBranchSchema),
  }),
  clone: z.object({
    relativePath: z.string().min(1),
    refreshed: z.boolean(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  worktree: z.object({
    id: UuidSchema,
    branchName: z.string().min(1),
    relativePath: z.string().min(1),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  completedAt: z.string().datetime(),
});
export type RepositoryIntakeResult = z.infer<typeof RepositoryIntakeResultSchema>;

export const RepositoryIntakeViewSchema = z.object({
  intakeId: UuidSchema,
  status: z.nativeEnum(RepositoryIntakeStatus),
  progress: z.number().int().min(0).max(100),
  result: RepositoryIntakeResultSchema.optional(),
  error: z.string().optional(),
});
export type RepositoryIntakeView = z.infer<typeof RepositoryIntakeViewSchema>;

export const RECOVERY_QUEUE = 'codeer-recovery';
export const REPOSITORY_INTAKE_QUEUE = 'codeer-repository-intake';
export const REPOSITORY_INTAKE_JOB = 'repository.intake';
export const INCIDENT_TRIAGE_QUEUE = 'codeer-incident-triage';
export const INCIDENT_TRIAGE_JOB = 'incident.triage';
export const INCIDENT_TRIAGE_OUTBOX_TOPIC = 'incident.triage.requested';

export const RecoveryJobSchema = z.object({
  incidentId: UuidSchema,
  stage: z.nativeEnum(RecoveryStage),
  attempt: z.number().int().positive().default(1),
});
export type RecoveryJob = z.infer<typeof RecoveryJobSchema>;

export const VerificationResultSchema = z.object({
  status: z.enum(['verified', 'failed', 'inconclusive']),
  originalFailureResolved: z.boolean(),
  buildPassed: z.boolean(),
  testsPassed: z.boolean(),
  unexpectedChanges: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export enum SandboxExecutionStatus {
  REQUESTED = 'REQUESTED',
  POLICY_CHECK = 'POLICY_CHECK',
  PREPARING = 'PREPARING',
  INSTALLING = 'INSTALLING',
  REPRODUCING = 'REPRODUCING',
  COLLECTING = 'COLLECTING',
  CLEANING = 'CLEANING',
  COMPLETED = 'COMPLETED',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
  INFRASTRUCTURE_FAILED = 'INFRASTRUCTURE_FAILED',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
}

export enum SandboxResult {
  REPRODUCED = 'REPRODUCED',
  NOT_REPRODUCED = 'NOT_REPRODUCED',
  INCONCLUSIVE = 'INCONCLUSIVE',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  INFRASTRUCTURE_FAILED = 'INFRASTRUCTURE_FAILED',
}

export enum SandboxNetworkMode {
  NONE = 'NONE',
  RESTRICTED_INSTALL = 'RESTRICTED_INSTALL',
}

export enum SandboxCommandPhase {
  PREPARE = 'PREPARE',
  INSTALL = 'INSTALL',
  REPRODUCE = 'REPRODUCE',
  COLLECT = 'COLLECT',
}

export enum SandboxCommandStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  TIMED_OUT = 'TIMED_OUT',
  CANCELLED = 'CANCELLED',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
}

export enum SandboxArtifactRetention {
  EPHEMERAL = 'EPHEMERAL',
  INCIDENT = 'INCIDENT',
  LEGAL_HOLD = 'LEGAL_HOLD',
}

export const SandboxResourceLimitsSchema = z.object({
  cpuCores: z.number().positive().max(16).default(1),
  memoryBytes: z
    .number()
    .int()
    .min(128 * 1024 * 1024)
    .max(32 * 1024 * 1024 * 1024)
    .default(1024 * 1024 * 1024),
  pids: z.number().int().min(16).max(4096).default(256),
  workspaceBytes: z
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(50 * 1024 * 1024 * 1024)
    .default(2 * 1024 * 1024 * 1024),
  tempBytes: z
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(8 * 1024 * 1024 * 1024)
    .default(512 * 1024 * 1024),
  commandTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(60 * 60 * 1000)
    .default(15 * 60 * 1000),
  executionTimeoutMs: z
    .number()
    .int()
    .min(5_000)
    .max(6 * 60 * 60 * 1000)
    .default(45 * 60 * 1000),
  maximumCommands: z.number().int().min(1).max(50).default(10),
  maximumLogBytes: z
    .number()
    .int()
    .min(16 * 1024)
    .max(100 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  maximumArtifactBytes: z
    .number()
    .int()
    .min(0)
    .max(1024 * 1024 * 1024)
    .default(64 * 1024 * 1024),
});
export type SandboxResourceLimits = z.infer<typeof SandboxResourceLimitsSchema>;
export const SandboxResourceLimitOverridesSchema = SandboxResourceLimitsSchema.partial();
export type SandboxResourceLimitOverrides = z.infer<typeof SandboxResourceLimitOverridesSchema>;

export const SandboxNetworkPolicySchema = z.object({
  mode: z.nativeEnum(SandboxNetworkMode).default(SandboxNetworkMode.NONE),
  dockerNetwork: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .optional(),
  allowedRegistries: z.array(z.string().trim().min(1).max(253)).max(20).default([]),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).max(100).default([]),
  denyPrivateNetworks: z.boolean().default(true),
  denyMetadataServices: z.boolean().default(true),
});
export type SandboxNetworkPolicy = z.infer<typeof SandboxNetworkPolicySchema>;

const SandboxExecutableSchema = z.enum(['npm', 'pnpm', 'yarn', 'node']);
const SandboxArgumentSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => ![...value].some((character) => ['\0', '\r', '\n'].includes(character)),
    'Arguments must not contain control characters',
  );

export const SandboxCommandRequestSchema = z.object({
  phase: z.nativeEnum(SandboxCommandPhase),
  executable: SandboxExecutableSchema,
  arguments: z.array(SandboxArgumentSchema).max(64),
  workingDirectory: z.string().trim().min(1).max(512).default('.'),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(60 * 60 * 1000)
    .optional(),
  networkMode: z.nativeEnum(SandboxNetworkMode).default(SandboxNetworkMode.NONE),
  expectedExitCodes: z.array(z.number().int().min(0).max(255)).min(1).max(16).default([0]),
  environment: z
    .record(
      z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
      z
        .string()
        .max(4096)
        .refine((value) => !value.includes('\0'), 'Environment values must not contain NUL bytes'),
    )
    .refine(
      (value) => Object.keys(value).length <= 32,
      'At most 32 environment variables are allowed',
    )
    .default({}),
});
export type SandboxCommandRequest = z.infer<typeof SandboxCommandRequestSchema>;

export const FailureSignatureInputSchema = z.object({
  expectedText: z.string().trim().min(3).max(100_000),
  minimumSimilarity: z.number().min(0.5).max(1).default(0.85),
  requireNonZeroExit: z.boolean().default(true),
});
export type FailureSignatureInput = z.infer<typeof FailureSignatureInputSchema>;

export const StartReproductionSchema = z.object({
  worktreeId: UuidSchema.optional(),
  image: z.string().trim().min(1).max(512),
  installCommands: z.array(SandboxCommandRequestSchema).max(5).default([]),
  reproductionCommands: z.array(SandboxCommandRequestSchema).min(1).max(10),
  failureSignature: FailureSignatureInputSchema,
  repeatCount: z.number().int().min(1).max(3).default(2),
  resourceLimits: SandboxResourceLimitOverridesSchema.optional(),
  networkPolicy: SandboxNetworkPolicySchema.optional(),
  artifactPaths: z.array(z.string().trim().min(1).max(512)).max(20).default([]),
  policyOverrideReason: z.string().trim().min(20).max(2_000).optional(),
});
export type StartReproductionInput = z.infer<typeof StartReproductionSchema>;

export const SandboxPolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  policyVersion: z.string().min(1).max(100),
  decisionId: UuidSchema,
  reasons: z.array(z.string().min(1).max(1_000)).max(50),
  normalizedCommands: z.array(SandboxCommandRequestSchema),
  resourceLimits: SandboxResourceLimitsSchema,
  networkPolicy: SandboxNetworkPolicySchema,
  image: z.string().min(1).max(512),
  imageDigestRequired: z.boolean(),
  overrideRequired: z.boolean(),
  evaluatedAt: z.string().datetime(),
});
export type SandboxPolicyDecision = z.infer<typeof SandboxPolicyDecisionSchema>;

export const SandboxLogChunkSchema = z.object({
  id: UuidSchema,
  executionId: UuidSchema,
  commandId: UuidSchema.nullable(),
  sequence: z.number().int().positive(),
  stream: z.enum(['stdout', 'stderr', 'system']),
  content: z.string().max(128 * 1024),
  byteSize: z.number().int().nonnegative(),
  redacted: z.boolean(),
  redactionCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  previousHash: z.string().length(64).nullable(),
  chunkHash: z.string().length(64),
  occurredAt: z.string().datetime(),
});
export type SandboxLogChunk = z.infer<typeof SandboxLogChunkSchema>;

export const SandboxArtifactSchema = z.object({
  id: UuidSchema,
  executionId: UuidSchema,
  path: z.string().min(1).max(512),
  mediaType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative(),
  digest: z.string().length(64),
  retention: z.nativeEnum(SandboxArtifactRetention),
  storageReference: z.string().max(2048).nullable(),
  createdAt: z.string().datetime(),
});
export type SandboxArtifact = z.infer<typeof SandboxArtifactSchema>;

export const SandboxCleanupProofSchema = z.object({
  executionId: UuidSchema,
  containerIds: z.array(z.string().min(1).max(128)).max(100),
  volumeIds: z.array(z.string().min(1).max(128)).max(20),
  networkIds: z.array(z.string().min(1).max(128)).max(20),
  verifiedAbsent: z.boolean(),
  attempts: z.number().int().positive(),
  digest: z.string().length(64),
  error: z.string().max(2_000).nullable(),
  completedAt: z.string().datetime(),
});
export type SandboxCleanupProof = z.infer<typeof SandboxCleanupProofSchema>;

export const FailureSignatureSchema = z.object({
  normalized: z.string().min(1).max(100_000),
  digest: z.string().length(64),
  tokens: z.array(z.string().min(1).max(256)).max(10_000),
});
export type FailureSignature = z.infer<typeof FailureSignatureSchema>;

export const FailureSignatureComparisonSchema = z.object({
  matched: z.boolean(),
  similarity: z.number().min(0).max(1),
  expected: FailureSignatureSchema,
  observed: FailureSignatureSchema,
  rationale: z.string().min(1).max(2_000),
});
export type FailureSignatureComparison = z.infer<typeof FailureSignatureComparisonSchema>;

export const SandboxCommandResultSchema = z.object({
  id: UuidSchema,
  sequence: z.number().int().positive(),
  phase: z.nativeEnum(SandboxCommandPhase),
  executable: z.string().min(1).max(128),
  arguments: z.array(z.string().max(512)).max(64),
  workingDirectory: z.string().min(1).max(512),
  status: z.nativeEnum(SandboxCommandStatus),
  exitCode: z.number().int().min(0).max(255).nullable(),
  signal: z.string().max(64).nullable(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  oomKilled: z.boolean().default(false),
  outputDigest: z.string().length(64),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type SandboxCommandResult = z.infer<typeof SandboxCommandResultSchema>;

export const ReproductionSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  incidentId: UuidSchema,
  worktreeId: UuidSchema,
  executionId: UuidSchema,
  status: z.nativeEnum(SandboxExecutionStatus),
  result: z.nativeEnum(SandboxResult).nullable(),
  policyDecision: SandboxPolicyDecisionSchema,
  originalFailureSignature: FailureSignatureSchema,
  observedFailureSignature: FailureSignatureSchema.nullable(),
  signatureComparison: FailureSignatureComparisonSchema.nullable(),
  environmentFingerprint: z.string().length(64).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  commands: z.array(SandboxCommandResultSchema),
  artifacts: z.array(SandboxArtifactSchema),
  cleanup: SandboxCleanupProofSchema.nullable(),
  cancellationRequestedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Reproduction = z.infer<typeof ReproductionSchema>;

export const ReproductionListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(SandboxExecutionStatus).optional(),
  result: z.nativeEnum(SandboxResult).optional(),
});
export type ReproductionListQuery = z.infer<typeof ReproductionListQuerySchema>;

export const SandboxExecutionJobSchema = z.object({
  executionId: UuidSchema,
  reproductionId: UuidSchema,
  incidentId: UuidSchema,
  organizationId: UuidSchema,
  requestedBy: z.string().min(1).max(255),
  requestId: z.string().min(1).max(128),
  correlationId: z.string().min(1).max(128),
  requestedAt: z.string().datetime(),
  attempt: z.number().int().positive().default(1),
});
export type SandboxExecutionJob = z.infer<typeof SandboxExecutionJobSchema>;

export const SANDBOX_EXECUTION_QUEUE = 'codeer-sandbox-execution';
export const SANDBOX_EXECUTION_JOB = 'sandbox.execute';
export const SANDBOX_REPRODUCTION_OUTBOX_TOPIC = 'sandbox.reproduction.requested';

export const SandboxLogQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type SandboxLogQuery = z.infer<typeof SandboxLogQuerySchema>;

export enum AiProvider {
  OPENAI = 'OPENAI',
}

export enum InvestigationStatus {
  REQUESTED = 'REQUESTED',
  POLICY_CHECK = 'POLICY_CHECK',
  CONTEXT_BUILDING = 'CONTEXT_BUILDING',
  TRIAGE = 'TRIAGE',
  MAPPING = 'MAPPING',
  HYPOTHESIS = 'HYPOTHESIS',
  VALIDATION = 'VALIDATION',
  SECURITY_REVIEW = 'SECURITY_REVIEW',
  PLAN_COMPOSITION = 'PLAN_COMPOSITION',
  CRITIC_REVIEW = 'CRITIC_REVIEW',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
  MODEL_FAILED = 'MODEL_FAILED',
  TOOL_FAILED = 'TOOL_FAILED',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  SECURITY_REJECTED = 'SECURITY_REJECTED',
}

export enum InvestigationAgentKind {
  TRIAGE = 'TRIAGE',
  REPOSITORY_MAPPER = 'REPOSITORY_MAPPER',
  ROOT_CAUSE_INVESTIGATOR = 'ROOT_CAUSE_INVESTIGATOR',
  CONTRACT_ANALYST = 'CONTRACT_ANALYST',
  SECURITY_REVIEWER = 'SECURITY_REVIEWER',
  PLAN_COMPOSER = 'PLAN_COMPOSER',
  INDEPENDENT_CRITIC = 'INDEPENDENT_CRITIC',
}

export enum AgentRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  BLOCKED = 'BLOCKED',
}

export enum ModelInvocationStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
}

export enum ToolCallStatus {
  REQUESTED = 'REQUESTED',
  AUTHORIZED = 'AUTHORIZED',
  COMPLETED = 'COMPLETED',
  DENIED = 'DENIED',
  FAILED = 'FAILED',
}

export enum GuardrailOutcome {
  ALLOW = 'ALLOW',
  BLOCK = 'BLOCK',
  REVIEW = 'REVIEW',
}

export enum HypothesisDisposition {
  PRIMARY = 'PRIMARY',
  ALTERNATIVE = 'ALTERNATIVE',
  REJECTED = 'REJECTED',
}

export enum TreatmentPlanStatus {
  DRAFT = 'DRAFT',
  SECURITY_REVIEW = 'SECURITY_REVIEW',
  CRITIC_REVIEW = 'CRITIC_REVIEW',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum PlanApprovalDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_REVISION = 'REQUEST_REVISION',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum CitationSourceType {
  INCIDENT_EVIDENCE = 'INCIDENT_EVIDENCE',
  INCIDENT_EVENT = 'INCIDENT_EVENT',
  REPRODUCTION = 'REPRODUCTION',
  SANDBOX_LOG = 'SANDBOX_LOG',
  SANDBOX_ARTIFACT = 'SANDBOX_ARTIFACT',
  REPOSITORY_FILE = 'REPOSITORY_FILE',
  REPOSITORY_HEALTH = 'REPOSITORY_HEALTH',
}

export const InvestigationCitationSchema = z
  .object({
    sourceType: z.nativeEnum(CitationSourceType),
    sourceId: UuidSchema,
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    path: z.string().trim().min(1).max(1024).optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(240),
    excerpt: z.string().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if ((value.lineStart === undefined) !== (value.lineEnd === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineEnd'],
        message: 'lineStart and lineEnd must be supplied together',
      });
    }
    if (
      value.lineStart !== undefined &&
      value.lineEnd !== undefined &&
      value.lineEnd < value.lineStart
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineEnd'],
        message: 'lineEnd must be greater than or equal to lineStart',
      });
    }
  });
export type InvestigationCitation = z.infer<typeof InvestigationCitationSchema>;

export const RootCauseHypothesisSchema = z.object({
  id: UuidSchema,
  disposition: z.nativeEnum(HypothesisDisposition),
  title: z.string().trim().min(3).max(240),
  mechanism: z.string().trim().min(10).max(6_000),
  confidence: z.number().min(0).max(1),
  supportingEvidence: z.array(InvestigationCitationSchema).min(1).max(100),
  contradictingEvidence: z.array(InvestigationCitationSchema).max(100).default([]),
  missingEvidence: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  assumptions: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
});
export type RootCauseHypothesis = z.infer<typeof RootCauseHypothesisSchema>;

export const DiagnosisSchema = z.object({
  id: UuidSchema,
  investigationId: UuidSchema,
  summary: z.string().trim().min(10).max(10_000),
  failureMechanism: z.string().trim().min(10).max(10_000),
  blastRadius: z.string().trim().min(3).max(5_000),
  securityImpact: z.string().trim().min(3).max(5_000),
  confidence: z.number().min(0).max(1),
  confidenceBand: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  hypotheses: z.array(RootCauseHypothesisSchema).min(1).max(20),
  unknowns: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  citations: z.array(InvestigationCitationSchema).min(1).max(250),
  schemaVersion: z.string().min(1).max(64),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const TreatmentPlanStepSchema = z.object({
  sequence: z.number().int().positive(),
  title: z.string().trim().min(3).max(240),
  objective: z.string().trim().min(10).max(4_000),
  affectedComponents: z.array(z.string().trim().min(1).max(512)).min(1).max(50),
  scopeRestrictions: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  risk: z.nativeEnum(RiskLevel),
  securityConsiderations: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  verificationCommands: z.array(SandboxCommandRequestSchema).max(20).default([]),
  expectedResults: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
  rollbackProcedure: z.string().trim().min(10).max(4_000),
  citations: z.array(InvestigationCitationSchema).min(1).max(100),
});
export type TreatmentPlanStep = z.infer<typeof TreatmentPlanStepSchema>;

export const TreatmentPlanSchema = z.object({
  id: UuidSchema,
  investigationId: UuidSchema,
  diagnosisId: UuidSchema,
  version: z.number().int().positive(),
  status: z.nativeEnum(TreatmentPlanStatus),
  goal: z.string().trim().min(10).max(4_000),
  risk: z.nativeEnum(RiskLevel),
  steps: z.array(TreatmentPlanStepSchema).min(1).max(50),
  verificationMatrix: z
    .array(
      z.object({
        requirement: z.string().trim().min(1).max(1_000),
        evidenceRequired: z.string().trim().min(1).max(1_000),
        mandatory: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  rollbackStrategy: z.string().trim().min(10).max(10_000),
  compatibilityImpact: z.string().trim().min(3).max(5_000),
  migrationImpact: z.string().trim().min(3).max(5_000),
  knownLimitations: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  requiredApprovals: z.number().int().min(1).max(10),
  schemaVersion: z.string().min(1).max(64),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
});
export type TreatmentPlan = z.infer<typeof TreatmentPlanSchema>;

export const AiPolicySchema = z.object({
  provider: z.nativeEnum(AiProvider).default(AiProvider.OPENAI),
  allowedModels: z.array(z.string().trim().min(1).max(128)).min(1).max(20),
  modelByAgent: z.record(z.nativeEnum(InvestigationAgentKind), z.string().trim().min(1).max(128)),
  allowedTools: z.array(z.string().trim().min(1).max(128)).max(100),
  maximumConcurrentInvestigations: z.number().int().min(1).max(100).default(4),
  maximumModelInvocations: z.number().int().min(1).max(100).default(20),
  maximumToolCalls: z.number().int().min(0).max(1_000).default(100),
  maximumInputTokens: z.number().int().min(1_000).max(5_000_000).default(200_000),
  maximumOutputTokens: z.number().int().min(256).max(500_000).default(30_000),
  maximumCostUsd: z.number().min(0.01).max(10_000).default(25),
  timeoutMs: z
    .number()
    .int()
    .min(10_000)
    .max(6 * 60 * 60 * 1000)
    .default(45 * 60 * 1000),
  retentionDays: z.number().int().min(1).max(3_650).default(30),
  requireHumanApproval: z.literal(true).default(true),
  requireIndependentCritic: z.literal(true).default(true),
  requireSecurityReview: z.literal(true).default(true),
  storeProviderResponses: z.boolean().default(false),
  policyVersion: z.string().trim().min(1).max(64),
});
export type AiPolicy = z.infer<typeof AiPolicySchema>;

export const StartInvestigationSchema = z.object({
  reproductionId: UuidSchema,
  requestedModels: z.array(z.string().trim().min(1).max(128)).max(10).optional(),
  focusAreas: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  additionalContext: z.string().trim().max(10_000).optional(),
});
export type StartInvestigationInput = z.infer<typeof StartInvestigationSchema>;

export const InvestigationSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  incidentId: UuidSchema,
  reproductionId: UuidSchema,
  status: z.nativeEnum(InvestigationStatus),
  policyVersion: z.string().min(1).max(64),
  promptTemplateVersion: z.string().min(1).max(64),
  contextHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  leaseOwner: z.string().max(255).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  cancellationRequestedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  errorCode: z.string().max(128).nullable(),
  errorMessage: z.string().max(2_000).nullable(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Investigation = z.infer<typeof InvestigationSchema>;

export const InvestigationListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(InvestigationStatus).optional(),
});
export type InvestigationListQuery = z.infer<typeof InvestigationListQuerySchema>;

export const InvestigationEventSchema = z.object({
  id: UuidSchema,
  investigationId: UuidSchema,
  sequence: z.number().int().positive(),
  type: z.string().trim().min(1).max(128),
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string().length(64).nullable(),
  eventHash: z.string().length(64),
  occurredAt: z.string().datetime(),
});
export type InvestigationEvent = z.infer<typeof InvestigationEventSchema>;

export const InvestigationToolCallSchema = z.object({
  id: UuidSchema,
  investigationId: UuidSchema,
  agentKind: z.nativeEnum(InvestigationAgentKind),
  toolName: z.string().trim().min(1).max(128),
  status: z.nativeEnum(ToolCallStatus),
  inputHash: z.string().length(64),
  outputHash: z.string().length(64).nullable(),
  deniedReason: z.string().max(2_000).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});
export type InvestigationToolCall = z.infer<typeof InvestigationToolCallSchema>;

export const TreatmentPlanDecisionSchema = z.object({
  decision: z.nativeEnum(PlanApprovalDecision),
  comment: z.string().trim().min(10).max(5_000),
  expectedVersion: z.number().int().positive(),
});
export type TreatmentPlanDecisionInput = z.infer<typeof TreatmentPlanDecisionSchema>;

export const InvestigationJobSchema = z.object({
  investigationId: UuidSchema,
  incidentId: UuidSchema,
  organizationId: UuidSchema,
  reproductionId: UuidSchema,
  requestedBy: z.string().min(1).max(255),
  requestId: z.string().min(1).max(128),
  correlationId: z.string().min(1).max(128),
  requestedAt: z.string().datetime(),
  attempt: z.number().int().positive().default(1),
});
export type InvestigationJob = z.infer<typeof InvestigationJobSchema>;

export const INVESTIGATION_QUEUE = 'codeer-investigation';
export const INVESTIGATION_JOB = 'investigation.execute';
export const INVESTIGATION_OUTBOX_TOPIC = 'investigation.requested';

export enum RecoveryRunStatus {
  REQUESTED = 'REQUESTED',
  POLICY_CHECK = 'POLICY_CHECK',
  WORKTREE_PREPARING = 'WORKTREE_PREPARING',
  PATCH_PLANNING = 'PATCH_PLANNING',
  PATCH_GENERATING = 'PATCH_GENERATING',
  PATCH_VALIDATING = 'PATCH_VALIDATING',
  SECURITY_REVIEW = 'SECURITY_REVIEW',
  VERIFYING = 'VERIFYING',
  PACKAGE_BUILDING = 'PACKAGE_BUILDING',
  AWAITING_PUBLICATION_APPROVAL = 'AWAITING_PUBLICATION_APPROVAL',
  READY_TO_PUBLISH = 'READY_TO_PUBLISH',
  PUBLISHED = 'PUBLISHED',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
  PATCH_REJECTED = 'PATCH_REJECTED',
  SECURITY_REJECTED = 'SECURITY_REJECTED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  WORKTREE_FAILED = 'WORKTREE_FAILED',
  MODEL_FAILED = 'MODEL_FAILED',
  TOOL_FAILED = 'TOOL_FAILED',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
}

export enum RecoveryWorktreeStatus {
  REQUESTED = 'REQUESTED',
  CREATING = 'CREATING',
  READY = 'READY',
  DIRTY = 'DIRTY',
  REMOVING = 'REMOVING',
  REMOVED = 'REMOVED',
  FAILED = 'FAILED',
}

export enum PatchVersionStatus {
  PROPOSED = 'PROPOSED',
  VALIDATING = 'VALIDATING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum RecoverySecurityDecision {
  ALLOW = 'ALLOW',
  REQUIRE_REVISION = 'REQUIRE_REVISION',
  BLOCK = 'BLOCK',
}

export enum RecoveryVerificationStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  INCONCLUSIVE = 'INCONCLUSIVE',
  CANCELLED = 'CANCELLED',
}

export enum RecoveryVerificationCheckStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  BLOCKED = 'BLOCKED',
}

export enum PublicationDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export const RecoveryPolicySchema = z.object({
  policyVersion: z.string().trim().min(1).max(64),
  allowedPaths: z.array(z.string().trim().min(1).max(1024)).min(1).max(500),
  deniedPaths: z.array(z.string().trim().min(1).max(1024)).max(500).default([]),
  allowedExtensions: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\.[A-Za-z0-9]+$/),
    )
    .min(1)
    .max(100),
  maximumChangedFiles: z.number().int().min(1).max(1_000).default(25),
  maximumChangedLines: z.number().int().min(1).max(100_000).default(1_000),
  maximumPatchHunks: z.number().int().min(1).max(10_000).default(200),
  maximumPatchBytes: z
    .number()
    .int()
    .min(1_024)
    .max(100 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  allowNewFiles: z.boolean().default(true),
  allowDeletedFiles: z.boolean().default(false),
  allowGeneratedFiles: z.boolean().default(false),
  allowDependencyChanges: z.boolean().default(false),
  allowLockfileChanges: z.boolean().default(false),
  allowWorkflowChanges: z.boolean().default(false),
  allowInfrastructureChanges: z.boolean().default(false),
  allowMigrationChanges: z.boolean().default(false),
  allowSecuritySensitiveChanges: z.boolean().default(false),
  requireSecurityReview: z.literal(true).default(true),
  requireIndependentVerification: z.literal(true).default(true),
  requireHumanPublicationApproval: z.literal(true).default(true),
  requiredPublicationApprovals: z.number().int().min(1).max(10).default(1),
  retentionDays: z.number().int().min(1).max(3_650).default(90),
});
export type RecoveryPolicy = z.infer<typeof RecoveryPolicySchema>;

export const StartRecoverySchema = z.object({
  baseCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  requestedBranchName: z.string().trim().min(1).max(240).optional(),
  requestedModel: z.string().trim().min(1).max(128).optional(),
  additionalConstraints: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
});
export type StartRecoveryInput = z.infer<typeof StartRecoverySchema>;

export const RecoveryRunSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  incidentId: UuidSchema,
  treatmentPlanId: UuidSchema,
  repositoryId: UuidSchema,
  status: z.nativeEnum(RecoveryRunStatus),
  version: z.number().int().positive(),
  policyVersion: z.string().min(1).max(64),
  treatmentPlanVersion: z.number().int().positive(),
  baseCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  branchName: z.string().trim().min(1).max(255),
  patchVersion: z.number().int().positive().nullable(),
  leaseOwner: z.string().max(255).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  cancellationRequestedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  errorCode: z.string().max(128).nullable(),
  errorMessage: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RecoveryRun = z.infer<typeof RecoveryRunSchema>;

export const RecoveryListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(RecoveryRunStatus).optional(),
});
export type RecoveryListQuery = z.infer<typeof RecoveryListQuerySchema>;

export const RecoveryEventSchema = z.object({
  id: UuidSchema,
  recoveryId: UuidSchema,
  sequence: z.number().int().positive(),
  type: z.string().trim().min(1).max(128),
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string().length(64).nullable(),
  eventHash: z.string().length(64),
  occurredAt: z.string().datetime(),
});
export type RecoveryEvent = z.infer<typeof RecoveryEventSchema>;

export const PatchHunkSchema = z.object({
  id: UuidSchema,
  fileId: UuidSchema,
  sequence: z.number().int().positive(),
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  header: z.string().min(1).max(1_000),
  content: z.string().max(512 * 1024),
  addedLines: z.number().int().nonnegative(),
  deletedLines: z.number().int().nonnegative(),
  treatmentPlanStep: z.number().int().positive(),
  evidenceCitations: z.array(InvestigationCitationSchema).min(1).max(100),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PatchHunk = z.infer<typeof PatchHunkSchema>;

export const PatchFileSchema = z.object({
  id: UuidSchema,
  patchId: UuidSchema,
  oldPath: z.string().trim().min(1).max(1024).nullable(),
  newPath: z.string().trim().min(1).max(1024).nullable(),
  changeType: z.enum(['ADD', 'MODIFY', 'DELETE', 'RENAME']),
  oldDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  newDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  addedLines: z.number().int().nonnegative(),
  deletedLines: z.number().int().nonnegative(),
  binary: z.boolean(),
  generated: z.boolean(),
  sensitive: z.boolean(),
  hunks: z.array(PatchHunkSchema).max(5_000),
});
export type PatchFile = z.infer<typeof PatchFileSchema>;

export const PatchVersionSchema = z.object({
  id: UuidSchema,
  recoveryId: UuidSchema,
  version: z.number().int().positive(),
  status: z.nativeEnum(PatchVersionStatus),
  baseCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  unifiedDiff: z.string().max(100 * 1024 * 1024),
  patchDigest: z.string().regex(/^[0-9a-f]{64}$/),
  changedFiles: z.number().int().nonnegative(),
  addedLines: z.number().int().nonnegative(),
  deletedLines: z.number().int().nonnegative(),
  files: z.array(PatchFileSchema).max(1_000),
  policyDecision: z.object({
    allowed: z.boolean(),
    reasons: z.array(z.string().min(1).max(1_000)).max(500),
    policyVersion: z.string().min(1).max(64),
    evaluatedAt: z.string().datetime(),
  }),
  createdAt: z.string().datetime(),
});
export type PatchVersion = z.infer<typeof PatchVersionSchema>;

export const RecoverySecurityReviewSchema = z.object({
  id: UuidSchema,
  recoveryId: UuidSchema,
  patchId: UuidSchema,
  decision: z.nativeEnum(RecoverySecurityDecision),
  summary: z.string().trim().min(10).max(10_000),
  findings: z
    .array(
      z.object({
        severity: z.nativeEnum(RiskLevel),
        category: z.string().trim().min(1).max(128),
        path: z.string().trim().min(1).max(1024).nullable(),
        message: z.string().trim().min(3).max(4_000),
        citation: InvestigationCitationSchema.optional(),
      }),
    )
    .max(500),
  reviewerModel: z.string().trim().min(1).max(128),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
});
export type RecoverySecurityReview = z.infer<typeof RecoverySecurityReviewSchema>;

export const RecoveryVerificationCheckSchema = z.object({
  id: UuidSchema,
  verificationId: UuidSchema,
  sequence: z.number().int().positive(),
  name: z.string().trim().min(1).max(240),
  command: SandboxCommandRequestSchema.optional(),
  mandatory: z.boolean(),
  status: z.nativeEnum(RecoveryVerificationCheckStatus),
  exitCode: z.number().int().nullable(),
  evidenceIds: z.array(UuidSchema).max(100),
  summary: z.string().max(4_000),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type RecoveryVerificationCheck = z.infer<typeof RecoveryVerificationCheckSchema>;

export const RecoveryVerificationReportSchema = z.object({
  id: UuidSchema,
  recoveryId: UuidSchema,
  patchId: UuidSchema,
  status: z.nativeEnum(RecoveryVerificationStatus),
  originalFailureResolved: z.boolean(),
  unexpectedChanges: z.array(z.string().trim().min(1).max(1024)).max(500),
  scopeExpanded: z.boolean(),
  checks: z.array(RecoveryVerificationCheckSchema).max(200),
  summary: z.string().trim().min(3).max(10_000),
  confidence: z.number().min(0).max(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
});
export type RecoveryVerificationReport = z.infer<typeof RecoveryVerificationReportSchema>;

export const PullRequestPackageSchema = z.object({
  id: UuidSchema,
  version: z.number().int().positive(),
  recoveryId: UuidSchema,
  patchId: UuidSchema,
  title: z.string().trim().min(5).max(240),
  body: z.string().trim().min(20).max(100_000),
  headBranch: z.string().trim().min(1).max(255),
  baseBranch: z.string().trim().min(1).max(255),
  rootCauseSummary: z.string().trim().min(10).max(10_000),
  changedFiles: z.array(z.string().trim().min(1).max(1024)).max(1_000),
  riskSummary: z.string().trim().min(3).max(10_000),
  verificationSummary: z.string().trim().min(3).max(10_000),
  knownLimitations: z.array(z.string().trim().min(1).max(1_000)).max(100),
  rollbackInstructions: z.string().trim().min(10).max(10_000),
  packageHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
});
export type PullRequestPackage = z.infer<typeof PullRequestPackageSchema>;

export const PublicationDecisionSchema = z.object({
  decision: z.nativeEnum(PublicationDecision),
  comment: z.string().trim().min(10).max(5_000),
  expectedRecoveryVersion: z.number().int().positive(),
});
export type PublicationDecisionInput = z.infer<typeof PublicationDecisionSchema>;

export const RecoveryRevisionRequestSchema = z.object({
  comment: z.string().trim().min(10).max(5_000),
  expectedRecoveryVersion: z.number().int().positive(),
  additionalConstraints: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
});
export type RecoveryRevisionRequest = z.infer<typeof RecoveryRevisionRequestSchema>;

export const ControlledRecoveryJobSchema = z.object({
  recoveryId: UuidSchema,
  organizationId: UuidSchema,
  incidentId: UuidSchema,
  treatmentPlanId: UuidSchema,
  requestedBy: z.string().min(1).max(255),
  requestId: z.string().min(1).max(128),
  correlationId: z.string().min(1).max(128),
  requestedAt: z.string().datetime(),
  attempt: z.number().int().positive().default(1),
});
export type ControlledRecoveryJob = z.infer<typeof ControlledRecoveryJobSchema>;

export const CONTROLLED_RECOVERY_QUEUE = 'codeer-controlled-recovery';
export const CONTROLLED_RECOVERY_JOB = 'recovery.execute';
export const CONTROLLED_RECOVERY_OUTBOX_TOPIC = 'recovery.requested';
