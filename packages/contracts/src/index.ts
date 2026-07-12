import { z } from 'zod';

export enum IncidentSeverity {
  SEV1 = 'SEV-1',
  SEV2 = 'SEV-2',
  SEV3 = 'SEV-3',
  SEV4 = 'SEV-4',
}

export enum IncidentStatus {
  ADMITTED = 'ADMITTED',
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

export const CreateIncidentSchema = z.object({
  repositoryId: z.string().min(1),
  title: z.string().min(3).max(160),
  description: z.string().min(3).max(5000),
  source: z.nativeEnum(IncidentSource).default(IncidentSource.MANUAL),
  severity: z.nativeEnum(IncidentSeverity).optional(),
});
export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;

export const IncidentSchema = CreateIncidentSchema.extend({
  id: z.string().uuid(),
  severity: z.nativeEnum(IncidentSeverity),
  status: z.nativeEnum(IncidentStatus),
  stage: z.nativeEnum(RecoveryStage),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Incident = z.infer<typeof IncidentSchema>;

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
      {
        message: 'Use the canonical https://github.com/owner/repository URL',
      },
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
  intakeId: z.string().uuid(),
  requestedAt: z.string().datetime(),
});
export type RepositoryIntakeJob = z.infer<typeof RepositoryIntakeJobSchema>;

export const RepositoryIntakeResultSchema = z.object({
  intakeId: z.string().uuid(),
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
    id: z.string().uuid(),
    branchName: z.string().min(1),
    relativePath: z.string().min(1),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  completedAt: z.string().datetime(),
});
export type RepositoryIntakeResult = z.infer<typeof RepositoryIntakeResultSchema>;

export const RepositoryIntakeViewSchema = z.object({
  intakeId: z.string().uuid(),
  status: z.nativeEnum(RepositoryIntakeStatus),
  progress: z.number().int().min(0).max(100),
  result: RepositoryIntakeResultSchema.optional(),
  error: z.string().optional(),
});
export type RepositoryIntakeView = z.infer<typeof RepositoryIntakeViewSchema>;

export const RECOVERY_QUEUE = 'codeer-recovery';
export const REPOSITORY_INTAKE_QUEUE = 'codeer-repository-intake';
export const REPOSITORY_INTAKE_JOB = 'repository.intake';

export const RecoveryJobSchema = z.object({
  incidentId: z.string().uuid(),
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
