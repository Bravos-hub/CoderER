-- CodeER Sprint 6: controlled repair, patch governance, independent verification,
-- and human-approved pull-request packaging. This migration creates no automatic
-- merge or protected-branch write capability.

ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_REQUESTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_STARTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_CHECKPOINTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_POLICY_BLOCKED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_WORKTREE_READY';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_PATCH_PROPOSED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_PATCH_REJECTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_SECURITY_REVIEWED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_VERIFICATION_COMPLETED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_PACKAGE_READY';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_PUBLICATION_APPROVED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_PUBLICATION_REJECTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_CANCELLED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_FAILED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_CLEANUP_COMPLETED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RECOVERY_CLEANUP_FAILED';

ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'RECOVERY_POLICY';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'RECOVERY_PATCH';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'RECOVERY_SECURITY_REVIEW';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'RECOVERY_VERIFICATION';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'PULL_REQUEST_PACKAGE';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'RECOVERY_CLEANUP';

CREATE TYPE "RecoveryRunStatus" AS ENUM (
  'REQUESTED','POLICY_CHECK','WORKTREE_PREPARING','PATCH_PLANNING','PATCH_GENERATING',
  'PATCH_VALIDATING','SECURITY_REVIEW','VERIFYING','PACKAGE_BUILDING',
  'AWAITING_PUBLICATION_APPROVAL','READY_TO_PUBLISH','PUBLISHED','POLICY_BLOCKED',
  'CANCELLED','TIMED_OUT','PATCH_REJECTED','SECURITY_REJECTED','VERIFICATION_FAILED',
  'WORKTREE_FAILED','MODEL_FAILED','TOOL_FAILED','BUDGET_EXCEEDED','CLEANUP_FAILED'
);
CREATE TYPE "RecoveryWorktreeStatus" AS ENUM (
  'REQUESTED','CREATING','READY','DIRTY','REMOVING','REMOVED','FAILED'
);
CREATE TYPE "PatchVersionStatus" AS ENUM ('PROPOSED','VALIDATING','ACCEPTED','REJECTED','SUPERSEDED');
CREATE TYPE "RecoverySecurityDecision" AS ENUM ('ALLOW','REQUIRE_REVISION','BLOCK');
CREATE TYPE "RecoveryVerificationStatus" AS ENUM ('PENDING','RUNNING','PASSED','FAILED','INCONCLUSIVE','CANCELLED');
CREATE TYPE "RecoveryVerificationCheckStatus" AS ENUM ('PENDING','RUNNING','PASSED','FAILED','SKIPPED','BLOCKED');
CREATE TYPE "PublicationDecision" AS ENUM ('APPROVE','REJECT');

CREATE TABLE "OrganizationRecoveryPolicy" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "policyVersion" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "allowedPaths" TEXT[] NOT NULL,
  "deniedPaths" TEXT[] NOT NULL,
  "allowedExtensions" TEXT[] NOT NULL,
  "maximumChangedFiles" INTEGER NOT NULL CHECK ("maximumChangedFiles" BETWEEN 1 AND 1000),
  "maximumChangedLines" INTEGER NOT NULL CHECK ("maximumChangedLines" BETWEEN 1 AND 100000),
  "maximumPatchHunks" INTEGER NOT NULL CHECK ("maximumPatchHunks" BETWEEN 1 AND 10000),
  "maximumPatchBytes" INTEGER NOT NULL CHECK ("maximumPatchBytes" BETWEEN 1024 AND 104857600),
  "allowNewFiles" BOOLEAN NOT NULL DEFAULT TRUE,
  "allowDeletedFiles" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowGeneratedFiles" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowDependencyChanges" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowLockfileChanges" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowWorkflowChanges" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowInfrastructureChanges" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowMigrationChanges" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowSecuritySensitiveChanges" BOOLEAN NOT NULL DEFAULT FALSE,
  "requireSecurityReview" BOOLEAN NOT NULL DEFAULT TRUE,
  "requireIndependentVerification" BOOLEAN NOT NULL DEFAULT TRUE,
  "requireHumanPublicationApproval" BOOLEAN NOT NULL DEFAULT TRUE,
  "requiredPublicationApprovals" INTEGER NOT NULL DEFAULT 1 CHECK ("requiredPublicationApprovals" BETWEEN 1 AND 10),
  "retentionDays" INTEGER NOT NULL DEFAULT 90 CHECK ("retentionDays" BETWEEN 1 AND 3650),
  "contentHash" CHAR(64) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "OrganizationRecoveryPolicy_org_version_key" UNIQUE ("organizationId","policyVersion")
);
CREATE INDEX "OrganizationRecoveryPolicy_org_active_created_idx"
  ON "OrganizationRecoveryPolicy" ("organizationId","active","createdAt" DESC);

CREATE TABLE "RecoveryRun" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "treatmentPlanId" UUID NOT NULL REFERENCES "TreatmentPlan"("id") ON DELETE RESTRICT,
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE RESTRICT,
  "recoveryPolicyId" UUID NOT NULL REFERENCES "OrganizationRecoveryPolicy"("id") ON DELETE RESTRICT,
  "status" "RecoveryRunStatus" NOT NULL DEFAULT 'REQUESTED',
  "policyVersion" TEXT NOT NULL,
  "treatmentPlanVersion" INTEGER NOT NULL CHECK ("treatmentPlanVersion" > 0),
  "baseCommitSha" CHAR(40) NOT NULL CHECK ("baseCommitSha" ~ '^[0-9a-f]{40}$'),
  "branchName" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "currentPatchVersion" INTEGER,
  "currentCheckpoint" INTEGER NOT NULL DEFAULT 0 CHECK ("currentCheckpoint" >= 0),
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "cancellationRequestedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RecoveryRun_org_incident_created_idx" ON "RecoveryRun" ("organizationId","incidentId","createdAt" DESC);
CREATE INDEX "RecoveryRun_status_lease_idx" ON "RecoveryRun" ("status","leaseExpiresAt");
CREATE INDEX "RecoveryRun_plan_created_idx" ON "RecoveryRun" ("treatmentPlanId","createdAt" DESC);
CREATE INDEX "RecoveryRun_repository_created_idx" ON "RecoveryRun" ("repositoryId","createdAt" DESC);

CREATE TABLE "RecoveryCheckpoint" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "stage" "RecoveryRunStatus" NOT NULL,
  "state" JSONB NOT NULL,
  "stateHash" CHAR(64) NOT NULL,
  "leaseOwner" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryCheckpoint_run_sequence_key" UNIQUE ("recoveryId","sequence")
);
CREATE INDEX "RecoveryCheckpoint_run_stage_sequence_idx" ON "RecoveryCheckpoint" ("recoveryId","stage","sequence");

CREATE TABLE "RecoveryEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "previousHash" CHAR(64),
  "eventHash" CHAR(64) NOT NULL UNIQUE,
  "actorType" "ActorType" NOT NULL,
  "actorId" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryEvent_run_sequence_key" UNIQUE ("recoveryId","sequence")
);
CREATE INDEX "RecoveryEvent_run_occurred_idx" ON "RecoveryEvent" ("recoveryId","occurredAt");
CREATE INDEX "RecoveryEvent_correlation_idx" ON "RecoveryEvent" ("correlationId");

CREATE TABLE "RecoveryWorktree" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL UNIQUE REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "status" "RecoveryWorktreeStatus" NOT NULL DEFAULT 'REQUESTED',
  "repositoryPathRef" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "branchName" TEXT NOT NULL,
  "baseCommitSha" CHAR(40) NOT NULL CHECK ("baseCommitSha" ~ '^[0-9a-f]{40}$'),
  "headCommitSha" CHAR(40),
  "createdByWorker" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "removedAt" TIMESTAMPTZ,
  "cleanupDigest" CHAR(64)
);
CREATE INDEX "RecoveryWorktree_status_created_idx" ON "RecoveryWorktree" ("status","createdAt");

CREATE TABLE "RecoveryAgentRun" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('REPAIR','SECURITY_REVIEWER')),
  "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "schemaName" TEXT NOT NULL,
  "inputHash" CHAR(64) NOT NULL,
  "outputHash" CHAR(64),
  "providerRequestId" TEXT,
  "providerResponseId" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("inputTokens" >= 0),
  "cachedInputTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("cachedInputTokens" >= 0),
  "outputTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("outputTokens" >= 0),
  "reasoningTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("reasoningTokens" >= 0),
  "estimatedCostUsd" NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK ("estimatedCostUsd" >= 0),
  "durationMs" INTEGER CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RecoveryAgentRun_run_kind_created_idx" ON "RecoveryAgentRun" ("recoveryId","kind","createdAt" DESC);
CREATE INDEX "RecoveryAgentRun_status_created_idx" ON "RecoveryAgentRun" ("status","createdAt");

CREATE TABLE "RecoveryPatchVersion" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "status" "PatchVersionStatus" NOT NULL DEFAULT 'PROPOSED',
  "baseCommitSha" CHAR(40) NOT NULL CHECK ("baseCommitSha" ~ '^[0-9a-f]{40}$'),
  "unifiedDiff" TEXT NOT NULL,
  "patchDigest" CHAR(64) NOT NULL UNIQUE,
  "changedFiles" INTEGER NOT NULL CHECK ("changedFiles" >= 0),
  "addedLines" INTEGER NOT NULL CHECK ("addedLines" >= 0),
  "deletedLines" INTEGER NOT NULL CHECK ("deletedLines" >= 0),
  "generatedBy" TEXT NOT NULL,
  "modelInvocationId" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryPatchVersion_run_version_key" UNIQUE ("recoveryId","version")
);
CREATE INDEX "RecoveryPatchVersion_run_status_created_idx" ON "RecoveryPatchVersion" ("recoveryId","status","createdAt" DESC);

CREATE TABLE "RecoveryPatchFile" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patchId" UUID NOT NULL REFERENCES "RecoveryPatchVersion"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "oldPath" TEXT,
  "newPath" TEXT,
  "changeType" TEXT NOT NULL CHECK ("changeType" IN ('ADD','MODIFY','DELETE','RENAME')),
  "oldDigest" CHAR(64),
  "newDigest" CHAR(64),
  "addedLines" INTEGER NOT NULL CHECK ("addedLines" >= 0),
  "deletedLines" INTEGER NOT NULL CHECK ("deletedLines" >= 0),
  "binary" BOOLEAN NOT NULL DEFAULT FALSE,
  "generated" BOOLEAN NOT NULL DEFAULT FALSE,
  "sensitive" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryPatchFile_patch_sequence_key" UNIQUE ("patchId","sequence"),
  CONSTRAINT "RecoveryPatchFile_has_path" CHECK ("oldPath" IS NOT NULL OR "newPath" IS NOT NULL)
);
CREATE INDEX "RecoveryPatchFile_patch_new_path_idx" ON "RecoveryPatchFile" ("patchId","newPath");

CREATE TABLE "RecoveryPatchHunk" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "fileId" UUID NOT NULL REFERENCES "RecoveryPatchFile"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "oldStart" INTEGER NOT NULL CHECK ("oldStart" >= 0),
  "oldLines" INTEGER NOT NULL CHECK ("oldLines" >= 0),
  "newStart" INTEGER NOT NULL CHECK ("newStart" >= 0),
  "newLines" INTEGER NOT NULL CHECK ("newLines" >= 0),
  "header" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "addedLines" INTEGER NOT NULL CHECK ("addedLines" >= 0),
  "deletedLines" INTEGER NOT NULL CHECK ("deletedLines" >= 0),
  "treatmentPlanStep" INTEGER NOT NULL CHECK ("treatmentPlanStep" > 0),
  "evidenceCitations" JSONB NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryPatchHunk_file_sequence_key" UNIQUE ("fileId","sequence")
);
CREATE INDEX "RecoveryPatchHunk_content_hash_idx" ON "RecoveryPatchHunk" ("contentHash");

CREATE TABLE "RecoveryPatchPolicyDecision" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patchId" UUID NOT NULL REFERENCES "RecoveryPatchVersion"("id") ON DELETE CASCADE,
  "allowed" BOOLEAN NOT NULL,
  "reasons" JSONB NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "decisionHash" CHAR(64) NOT NULL UNIQUE,
  "evaluatedBy" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RecoveryPatchPolicyDecision_patch_evaluated_idx" ON "RecoveryPatchPolicyDecision" ("patchId","evaluatedAt" DESC);

CREATE TABLE "RecoverySecurityReview" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "patchId" UUID NOT NULL REFERENCES "RecoveryPatchVersion"("id") ON DELETE CASCADE,
  "decision" "RecoverySecurityDecision" NOT NULL,
  "summary" TEXT NOT NULL,
  "findings" JSONB NOT NULL,
  "reviewerModel" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RecoverySecurityReview_run_decision_created_idx" ON "RecoverySecurityReview" ("recoveryId","decision","createdAt" DESC);
CREATE INDEX "RecoverySecurityReview_patch_created_idx" ON "RecoverySecurityReview" ("patchId","createdAt" DESC);

CREATE TABLE "RecoveryVerificationRun" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "patchId" UUID NOT NULL REFERENCES "RecoveryPatchVersion"("id") ON DELETE CASCADE,
  "status" "RecoveryVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "originalFailureResolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "unexpectedChanges" JSONB NOT NULL,
  "scopeExpanded" BOOLEAN NOT NULL DEFAULT FALSE,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("confidence" BETWEEN 0 AND 1),
  "contentHash" CHAR(64) UNIQUE,
  "sandboxExecutionId" UUID,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RecoveryVerificationRun_run_status_created_idx" ON "RecoveryVerificationRun" ("recoveryId","status","createdAt" DESC);
CREATE INDEX "RecoveryVerificationRun_patch_created_idx" ON "RecoveryVerificationRun" ("patchId","createdAt" DESC);

CREATE TABLE "RecoveryVerificationCheck" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "verificationId" UUID NOT NULL REFERENCES "RecoveryVerificationRun"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "name" TEXT NOT NULL,
  "command" JSONB,
  "mandatory" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" "RecoveryVerificationCheckStatus" NOT NULL DEFAULT 'PENDING',
  "exitCode" INTEGER,
  "evidenceIds" TEXT[] NOT NULL,
  "summary" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryVerificationCheck_run_sequence_key" UNIQUE ("verificationId","sequence")
);
CREATE INDEX "RecoveryVerificationCheck_run_status_sequence_idx" ON "RecoveryVerificationCheck" ("verificationId","status","sequence");

CREATE TABLE "RecoveryPublicationApproval" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "decision" "PublicationDecision" NOT NULL,
  "comment" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "actorRoles" TEXT[] NOT NULL,
  "recoveryVersion" INTEGER NOT NULL CHECK ("recoveryVersion" > 0),
  "requestId" TEXT,
  "correlationId" TEXT,
  "decisionHash" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryPublicationApproval_run_version_actor_decision_key"
    UNIQUE ("recoveryId","recoveryVersion","actorId","decision")
);
CREATE INDEX "RecoveryPublicationApproval_org_run_created_idx" ON "RecoveryPublicationApproval" ("organizationId","recoveryId","createdAt");
CREATE INDEX "RecoveryPublicationApproval_actor_created_idx" ON "RecoveryPublicationApproval" ("actorId","createdAt");

CREATE TABLE "RecoveryPullRequestPackage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "patchId" UUID NOT NULL REFERENCES "RecoveryPatchVersion"("id") ON DELETE RESTRICT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "headBranch" TEXT NOT NULL,
  "baseBranch" TEXT NOT NULL,
  "rootCauseSummary" TEXT NOT NULL,
  "changedFiles" JSONB NOT NULL,
  "riskSummary" TEXT NOT NULL,
  "verificationSummary" TEXT NOT NULL,
  "knownLimitations" JSONB NOT NULL,
  "rollbackInstructions" TEXT NOT NULL,
  "packageHash" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryPullRequestPackage_run_version_key" UNIQUE ("recoveryId","version")
);
CREATE INDEX "RecoveryPullRequestPackage_run_created_idx" ON "RecoveryPullRequestPackage" ("recoveryId","createdAt" DESC);

CREATE TABLE "RecoveryCleanupRecord" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE CASCADE,
  "attempt" INTEGER NOT NULL CHECK ("attempt" > 0),
  "worktreeAbsent" BOOLEAN NOT NULL,
  "branchDeleted" BOOLEAN NOT NULL,
  "verifiedAt" TIMESTAMPTZ NOT NULL,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "cleanupDigest" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RecoveryCleanupRecord_run_attempt_key" UNIQUE ("recoveryId","attempt")
);
CREATE INDEX "RecoveryCleanupRecord_run_verified_idx" ON "RecoveryCleanupRecord" ("recoveryId","verifiedAt" DESC);

-- Immutable evidence, patch, review, verification, approval and package records.
CREATE TRIGGER "OrganizationRecoveryPolicy_immutable" BEFORE UPDATE OR DELETE ON "OrganizationRecoveryPolicy"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryCheckpoint_immutable" BEFORE UPDATE OR DELETE ON "RecoveryCheckpoint"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryEvent_immutable" BEFORE UPDATE OR DELETE ON "RecoveryEvent"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryAgentRun_immutable" BEFORE UPDATE OR DELETE ON "RecoveryAgentRun"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryPatchVersion_immutable" BEFORE UPDATE OR DELETE ON "RecoveryPatchVersion"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryPatchFile_immutable" BEFORE UPDATE OR DELETE ON "RecoveryPatchFile"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryPatchHunk_immutable" BEFORE UPDATE OR DELETE ON "RecoveryPatchHunk"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryPatchPolicyDecision_immutable" BEFORE UPDATE OR DELETE ON "RecoveryPatchPolicyDecision"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoverySecurityReview_immutable" BEFORE UPDATE OR DELETE ON "RecoverySecurityReview"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryVerificationRun_immutable" BEFORE UPDATE OR DELETE ON "RecoveryVerificationRun"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryVerificationCheck_immutable" BEFORE UPDATE OR DELETE ON "RecoveryVerificationCheck"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryPublicationApproval_immutable" BEFORE UPDATE OR DELETE ON "RecoveryPublicationApproval"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryPullRequestPackage_immutable" BEFORE UPDATE OR DELETE ON "RecoveryPullRequestPackage"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "RecoveryCleanupRecord_immutable" BEFORE UPDATE OR DELETE ON "RecoveryCleanupRecord"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();

-- Direct tenant tables.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'OrganizationRecoveryPolicy','RecoveryRun','RecoveryPublicationApproval'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls()) WITH CHECK ("organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;

-- Tables whose tenant is inherited through RecoveryRun.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'RecoveryCheckpoint','RecoveryEvent','RecoveryWorktree','RecoveryAgentRun',
    'RecoveryPatchVersion','RecoverySecurityReview','RecoveryVerificationRun',
    'RecoveryPullRequestPackage','RecoveryCleanupRecord'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM "RecoveryRun" r WHERE r."id"="recoveryId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls()))) WITH CHECK (EXISTS (SELECT 1 FROM "RecoveryRun" r WHERE r."id"="recoveryId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())))',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;

ALTER TABLE "RecoveryPatchFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoveryPatchFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RecoveryPatchFile_tenant_policy" ON "RecoveryPatchFile"
USING (EXISTS (
  SELECT 1 FROM "RecoveryPatchVersion" p JOIN "RecoveryRun" r ON r."id"=p."recoveryId"
  WHERE p."id"="patchId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
)) WITH CHECK (EXISTS (
  SELECT 1 FROM "RecoveryPatchVersion" p JOIN "RecoveryRun" r ON r."id"=p."recoveryId"
  WHERE p."id"="patchId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
));

ALTER TABLE "RecoveryPatchHunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoveryPatchHunk" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RecoveryPatchHunk_tenant_policy" ON "RecoveryPatchHunk"
USING (EXISTS (
  SELECT 1 FROM "RecoveryPatchFile" f
  JOIN "RecoveryPatchVersion" p ON p."id"=f."patchId"
  JOIN "RecoveryRun" r ON r."id"=p."recoveryId"
  WHERE f."id"="fileId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
)) WITH CHECK (EXISTS (
  SELECT 1 FROM "RecoveryPatchFile" f
  JOIN "RecoveryPatchVersion" p ON p."id"=f."patchId"
  JOIN "RecoveryRun" r ON r."id"=p."recoveryId"
  WHERE f."id"="fileId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
));

ALTER TABLE "RecoveryPatchPolicyDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoveryPatchPolicyDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RecoveryPatchPolicyDecision_tenant_policy" ON "RecoveryPatchPolicyDecision"
USING (EXISTS (
  SELECT 1 FROM "RecoveryPatchVersion" p JOIN "RecoveryRun" r ON r."id"=p."recoveryId"
  WHERE p."id"="patchId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
)) WITH CHECK (EXISTS (
  SELECT 1 FROM "RecoveryPatchVersion" p JOIN "RecoveryRun" r ON r."id"=p."recoveryId"
  WHERE p."id"="patchId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
));

ALTER TABLE "RecoveryVerificationCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoveryVerificationCheck" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RecoveryVerificationCheck_tenant_policy" ON "RecoveryVerificationCheck"
USING (EXISTS (
  SELECT 1 FROM "RecoveryVerificationRun" v JOIN "RecoveryRun" r ON r."id"=v."recoveryId"
  WHERE v."id"="verificationId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
)) WITH CHECK (EXISTS (
  SELECT 1 FROM "RecoveryVerificationRun" v JOIN "RecoveryRun" r ON r."id"=v."recoveryId"
  WHERE v."id"="verificationId" AND (r."organizationId"=codeer_current_organization_id() OR codeer_worker_bypass_rls())
));
