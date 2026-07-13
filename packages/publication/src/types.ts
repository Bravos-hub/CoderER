import { z } from 'zod';

export enum PublicationStatus {
  PUBLICATION_REQUESTED = 'PUBLICATION_REQUESTED',
  POLICY_CHECK = 'POLICY_CHECK',
  COMMIT_MATERIALIZING = 'COMMIT_MATERIALIZING',
  BRANCH_PUBLISHING = 'BRANCH_PUBLISHING',
  DRAFT_PR_CREATING = 'DRAFT_PR_CREATING',
  CI_MONITORING = 'CI_MONITORING',
  REVIEW_MONITORING = 'REVIEW_MONITORING',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  READY_FOR_HUMAN_MERGE = 'READY_FOR_HUMAN_MERGE',
  MERGED = 'MERGED',
  POST_MERGE_VERIFYING = 'POST_MERGE_VERIFYING',
  RECOVERY_CONFIRMED = 'RECOVERY_CONFIRMED',
  CLOSED = 'CLOSED',
  PUBLICATION_BLOCKED = 'PUBLICATION_BLOCKED',
  PUSH_FAILED = 'PUSH_FAILED',
  PR_CREATION_FAILED = 'PR_CREATION_FAILED',
  CI_FAILED = 'CI_FAILED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  REVISION_REQUIRED = 'REVISION_REQUIRED',
  BASE_BRANCH_STALE = 'BASE_BRANCH_STALE',
  SECURITY_BLOCKED = 'SECURITY_BLOCKED',
  POST_MERGE_FAILED = 'POST_MERGE_FAILED',
  MERGE_REVERTED = 'MERGE_REVERTED',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
}

export enum NormalizedCheckStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
  NEUTRAL = 'NEUTRAL',
  STALE = 'STALE',
}

export enum ReviewState {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  DISMISSED = 'DISMISSED',
  COMMENTED = 'COMMENTED',
}

export const Sha40Schema = z.string().regex(/^[a-f0-9]{40}$/i);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
export const SafeBranchSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^(?!\/|.*(?:\.\.|@\{|\\|\s|~|\^|:|\?|\*|\[|\.lock$|\/\.|\.\/|\/$))[A-Za-z0-9._/-]+$/);

export const PublicationPolicySchema = z.object({
  version: z.string().min(1).max(64),
  allowedBaseBranches: z.array(SafeBranchSchema).min(1).max(20),
  recoveryBranchPrefix: z.string().regex(/^[A-Za-z0-9._/-]{1,80}$/),
  requireDraftPullRequest: z.boolean().default(true),
  allowForcePush: z.literal(false).default(false),
  allowProtectedBranchWrites: z.literal(false).default(false),
  allowAutomaticMerge: z.literal(false).default(false),
  requiredChecks: z.array(z.string().min(1).max(200)).max(100),
  requiredApprovals: z.number().int().min(0).max(20),
  requireCodeOwnerApproval: z.boolean().default(false),
  maximumPublicationAttempts: z.number().int().min(1).max(20),
  webhookReplayWindowSeconds: z.number().int().min(60).max(86400),
  postMergeVerificationRequired: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(3650),
});
export type PublicationPolicy = z.infer<typeof PublicationPolicySchema>;

export const ApprovedRecoveryPackageSchema = z.object({
  recoveryId: z.string().uuid(),
  incidentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  treatmentPlanId: z.string().uuid(),
  patchVersion: z.number().int().min(1),
  baseCommitSha: Sha40Schema,
  patchDigest: Sha256Schema,
  treeDigest: Sha256Schema,
  branchName: SafeBranchSchema,
  targetBaseBranch: SafeBranchSchema,
  publicationApprovalCount: z.number().int().min(1),
  publicationApprovedAt: z.string().datetime(),
  securityReviewApproved: z.literal(true),
  verificationPassed: z.literal(true),
  pullRequestTitle: z.string().min(1).max(256),
  pullRequestBody: z.string().min(1).max(200_000),
});
export type ApprovedRecoveryPackage = z.infer<typeof ApprovedRecoveryPackageSchema>;

export const StartPublicationSchema = z.object({
  installationId: z.string().regex(/^\d+$/),
  approvedPackage: ApprovedRecoveryPackageSchema,
  policy: PublicationPolicySchema,
});
export type StartPublicationInput = z.infer<typeof StartPublicationSchema>;

export const PublicationTransitionRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
});
export type PublicationTransitionRequest = z.infer<typeof PublicationTransitionRequestSchema>;

export const PublicationRunSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  incidentId: z.string().uuid(),
  recoveryId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  installationId: z.string().regex(/^\d+$/),
  status: z.nativeEnum(PublicationStatus),
  version: z.number().int().min(1),
  policyVersion: z.string().min(1),
  baseBranch: SafeBranchSchema,
  headBranch: SafeBranchSchema,
  baseCommitSha: Sha40Schema,
  patchDigest: Sha256Schema,
  treeSha: Sha40Schema.nullable(),
  commitSha: Sha40Schema.nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  pullRequestUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicationRun = z.infer<typeof PublicationRunSchema>;

export const MergeReadinessInputSchema = z.object({
  baseCommitCurrent: z.boolean(),
  publicationIntegrityValid: z.boolean(),
  requiredChecks: z.array(
    z.object({ name: z.string(), status: z.nativeEnum(NormalizedCheckStatus) }),
  ),
  reviews: z.array(
    z.object({
      actorId: z.string(),
      state: z.nativeEnum(ReviewState),
      codeOwner: z.boolean().default(false),
    }),
  ),
  unresolvedBlockingThreads: z.number().int().min(0),
  blockingSecurityFindings: z.number().int().min(0),
  pullRequestDraft: z.boolean(),
});
export type MergeReadinessInput = z.infer<typeof MergeReadinessInputSchema>;

export interface MergeReadinessDecision {
  ready: boolean;
  blockers: string[];
}
