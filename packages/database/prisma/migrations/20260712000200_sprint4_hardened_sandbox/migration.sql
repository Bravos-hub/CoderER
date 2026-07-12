-- CodeER Sprint 4: hardened sandbox execution and deterministic failure reproduction.
-- Apply only after the Sprint 3 enterprise incident-engine migration.

ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'REPRODUCTION_REQUESTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'SANDBOX_POLICY_APPROVED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'SANDBOX_POLICY_BLOCKED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'SANDBOX_PREPARING';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'REPRODUCTION_STARTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'FAILURE_REPRODUCED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'FAILURE_NOT_REPRODUCED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'REPRODUCTION_TIMED_OUT';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'REPRODUCTION_CANCELLATION_REQUESTED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'REPRODUCTION_CANCELLED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'REPRODUCTION_INCONCLUSIVE';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'SANDBOX_INFRASTRUCTURE_FAILED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'SANDBOX_CLEANUP_COMPLETED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'SANDBOX_CLEANUP_FAILED';

ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'SANDBOX_POLICY';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'SANDBOX_LOG';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'SANDBOX_ARTIFACT';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'FAILURE_REPRODUCTION';
ALTER TYPE "EvidenceKind" ADD VALUE IF NOT EXISTS 'SANDBOX_CLEANUP';

CREATE TYPE "SandboxExecutionStatus" AS ENUM (
  'REQUESTED', 'POLICY_CHECK', 'PREPARING', 'INSTALLING', 'REPRODUCING',
  'COLLECTING', 'CLEANING', 'COMPLETED', 'POLICY_BLOCKED', 'CANCELLED',
  'TIMED_OUT', 'INFRASTRUCTURE_FAILED', 'CLEANUP_FAILED'
);
CREATE TYPE "SandboxResult" AS ENUM (
  'REPRODUCED', 'NOT_REPRODUCED', 'INCONCLUSIVE', 'POLICY_BLOCKED', 'INFRASTRUCTURE_FAILED'
);
CREATE TYPE "SandboxNetworkMode" AS ENUM ('NONE', 'RESTRICTED_INSTALL');
CREATE TYPE "SandboxCommandPhase" AS ENUM ('PREPARE', 'INSTALL', 'REPRODUCE', 'COLLECT');
CREATE TYPE "SandboxCommandStatus" AS ENUM (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'POLICY_BLOCKED'
);
CREATE TYPE "SandboxArtifactRetention" AS ENUM ('EPHEMERAL', 'INCIDENT', 'LEGAL_HOLD');

CREATE TABLE "SandboxExecution" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "worktreeId" UUID NOT NULL REFERENCES "RepositoryWorktree"("id") ON DELETE RESTRICT,
  "status" "SandboxExecutionStatus" NOT NULL DEFAULT 'REQUESTED',
  "result" "SandboxResult",
  "image" TEXT NOT NULL,
  "environmentFingerprint" CHAR(64),
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
CREATE INDEX "SandboxExecution_org_incident_created_idx"
  ON "SandboxExecution" ("organizationId", "incidentId", "createdAt" DESC);
CREATE INDEX "SandboxExecution_status_lease_idx"
  ON "SandboxExecution" ("status", "leaseExpiresAt");
CREATE INDEX "SandboxExecution_worktree_created_idx"
  ON "SandboxExecution" ("worktreeId", "createdAt" DESC);

CREATE TABLE "FailureReproduction" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "executionId" UUID NOT NULL REFERENCES "SandboxExecution"("id") ON DELETE CASCADE,
  "input" JSONB NOT NULL,
  "status" "SandboxExecutionStatus" NOT NULL DEFAULT 'REQUESTED',
  "result" "SandboxResult",
  "originalFailureSignature" JSONB NOT NULL,
  "observedFailureSignature" JSONB,
  "signatureComparison" JSONB,
  "confidence" DOUBLE PRECISION CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  "environmentFingerprint" CHAR(64),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "FailureReproduction_org_incident_created_idx"
  ON "FailureReproduction" ("organizationId", "incidentId", "createdAt" DESC);
CREATE INDEX "FailureReproduction_status_created_idx"
  ON "FailureReproduction" ("status", "createdAt");
CREATE INDEX "FailureReproduction_result_created_idx"
  ON "FailureReproduction" ("result", "createdAt");

CREATE TABLE "SandboxPolicySnapshot" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "executionId" UUID NOT NULL UNIQUE REFERENCES "SandboxExecution"("id") ON DELETE CASCADE,
  "policyVersion" TEXT NOT NULL,
  "decisionId" UUID NOT NULL UNIQUE,
  "allowed" BOOLEAN NOT NULL,
  "reasons" JSONB NOT NULL,
  "image" TEXT NOT NULL,
  "imageDigestRequired" BOOLEAN NOT NULL,
  "normalizedCommands" JSONB NOT NULL,
  "resourceLimits" JSONB NOT NULL,
  "networkPolicy" JSONB NOT NULL,
  "overrideRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "overrideReason" TEXT,
  "approvedBy" TEXT,
  "evaluatedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "SandboxCommand" (
  "id" UUID PRIMARY KEY,
  "executionId" UUID NOT NULL REFERENCES "SandboxExecution"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "phase" "SandboxCommandPhase" NOT NULL,
  "executable" TEXT NOT NULL,
  "arguments" TEXT[] NOT NULL,
  "workingDirectory" TEXT NOT NULL,
  "environment" JSONB NOT NULL,
  "networkMode" "SandboxNetworkMode" NOT NULL,
  "timeoutMs" INTEGER NOT NULL CHECK ("timeoutMs" BETWEEN 1000 AND 3600000),
  "expectedExitCodes" INTEGER[] NOT NULL,
  "status" "SandboxCommandStatus" NOT NULL DEFAULT 'PENDING',
  "exitCode" INTEGER CHECK ("exitCode" IS NULL OR ("exitCode" >= 0 AND "exitCode" <= 255)),
  "signal" TEXT,
  "durationMs" INTEGER CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  "timedOut" BOOLEAN NOT NULL DEFAULT FALSE,
  "oomKilled" BOOLEAN NOT NULL DEFAULT FALSE,
  "outputDigest" CHAR(64),
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SandboxCommand_execution_sequence_key" UNIQUE ("executionId", "sequence")
);
CREATE INDEX "SandboxCommand_execution_status_sequence_idx"
  ON "SandboxCommand" ("executionId", "status", "sequence");

CREATE TABLE "SandboxLogChunk" (
  "id" UUID PRIMARY KEY,
  "executionId" UUID NOT NULL REFERENCES "SandboxExecution"("id") ON DELETE CASCADE,
  "commandId" UUID REFERENCES "SandboxCommand"("id") ON DELETE SET NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "stream" TEXT NOT NULL CHECK ("stream" IN ('stdout', 'stderr', 'system')),
  "content" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" >= 0 AND "byteSize" <= 131072),
  "redacted" BOOLEAN NOT NULL DEFAULT FALSE,
  "redactionCount" INTEGER NOT NULL DEFAULT 0 CHECK ("redactionCount" >= 0),
  "truncated" BOOLEAN NOT NULL DEFAULT FALSE,
  "previousHash" CHAR(64),
  "chunkHash" CHAR(64) NOT NULL UNIQUE,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SandboxLogChunk_execution_sequence_key" UNIQUE ("executionId", "sequence")
);
CREATE INDEX "SandboxLogChunk_execution_occurred_idx"
  ON "SandboxLogChunk" ("executionId", "occurredAt");
CREATE INDEX "SandboxLogChunk_command_sequence_idx"
  ON "SandboxLogChunk" ("commandId", "sequence");

CREATE TABLE "SandboxArtifact" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "executionId" UUID NOT NULL REFERENCES "SandboxExecution"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" >= 0),
  "digest" CHAR(64) NOT NULL,
  "retention" "SandboxArtifactRetention" NOT NULL,
  "storageReference" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SandboxArtifact_execution_path_digest_key" UNIQUE ("executionId", "path", "digest")
);
CREATE INDEX "SandboxArtifact_org_incident_created_idx"
  ON "SandboxArtifact" ("organizationId", "incidentId", "createdAt" DESC);
CREATE INDEX "SandboxArtifact_execution_created_idx"
  ON "SandboxArtifact" ("executionId", "createdAt");

CREATE TABLE "SandboxCleanupRecord" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "executionId" UUID NOT NULL REFERENCES "SandboxExecution"("id") ON DELETE CASCADE,
  "containerIds" TEXT[] NOT NULL,
  "volumeIds" TEXT[] NOT NULL,
  "networkIds" TEXT[] NOT NULL,
  "verifiedAbsent" BOOLEAN NOT NULL,
  "attempts" INTEGER NOT NULL CHECK ("attempts" > 0),
  "digest" CHAR(64) NOT NULL,
  "error" TEXT,
  "completedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SandboxCleanupRecord_execution_digest_key" UNIQUE ("executionId", "digest")
);
CREATE INDEX "SandboxCleanupRecord_execution_completed_idx"
  ON "SandboxCleanupRecord" ("executionId", "completedAt" DESC);

-- Immutable evidence-bearing records.
CREATE TRIGGER "SandboxPolicySnapshot_immutable" BEFORE UPDATE OR DELETE ON "SandboxPolicySnapshot"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "SandboxLogChunk_immutable" BEFORE UPDATE OR DELETE ON "SandboxLogChunk"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "SandboxArtifact_immutable_update" BEFORE UPDATE ON "SandboxArtifact"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "SandboxCleanupRecord_immutable" BEFORE UPDATE OR DELETE ON "SandboxCleanupRecord"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();


-- Worker-wide maintenance requires both a transaction-local intent flag and membership in a
-- dedicated NOLOGIN capability role. The API runtime role is explicitly not a member.
CREATE OR REPLACE FUNCTION codeer_worker_bypass_rls() RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codeer_worker_bypass')
      THEN pg_has_role(current_user, 'codeer_worker_bypass', 'member')
        AND COALESCE(current_setting('app.codeer_worker_bypass', true), '') = 'true'
    ELSE FALSE
  END;
$$ LANGUAGE SQL STABLE;

-- Tenant isolation. Worker-wide reconciliation is allowed only when the transaction-local worker
-- bypass is enabled by the dedicated worker database role.
ALTER TABLE "SandboxExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SandboxExecution" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SandboxExecution_tenant_or_worker_policy" ON "SandboxExecution" FOR ALL
  USING ("organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls())
  WITH CHECK ("organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls());

ALTER TABLE "FailureReproduction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FailureReproduction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FailureReproduction_tenant_or_worker_policy" ON "FailureReproduction" FOR ALL
  USING ("organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls())
  WITH CHECK ("organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls());

ALTER TABLE "SandboxArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SandboxArtifact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SandboxArtifact_tenant_or_worker_policy" ON "SandboxArtifact" FOR ALL
  USING ("organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls())
  WITH CHECK ("organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls());

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['SandboxPolicySnapshot', 'SandboxCommand', 'SandboxLogChunk', 'SandboxCleanupRecord']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (EXISTS (SELECT 1 FROM "SandboxExecution" se WHERE se."id" = %I."executionId" AND (se."organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls()))) WITH CHECK (EXISTS (SELECT 1 FROM "SandboxExecution" se WHERE se."id" = %I."executionId" AND (se."organizationId" = codeer_current_organization_id() OR codeer_worker_bypass_rls())))',
      table_name || '_tenant_or_worker_policy', table_name, table_name, table_name
    );
  END LOOP;
END $$;
