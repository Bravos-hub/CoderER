-- CodeER Sprint 3 enterprise incident engine baseline.
-- This migration assumes a new CodeER database. Existing pilot databases should be migrated
-- through a reviewed, backed-up environment-specific migration plan.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "RepositoryProvider" AS ENUM ('GITHUB');
CREATE TYPE "RepositoryVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'INTERNAL');
CREATE TYPE "RepositoryIntakeStatus" AS ENUM ('QUEUED', 'AUTHENTICATING', 'READING_METADATA', 'CLONING', 'INSPECTING', 'CREATING_WORKTREE', 'READY', 'FAILED');
CREATE TYPE "WorktreeStatus" AS ENUM ('ACTIVE', 'REMOVED', 'FAILED');
CREATE TYPE "IncidentSeverity" AS ENUM ('SEV-1', 'SEV-2', 'SEV-3', 'SEV-4');
CREATE TYPE "IncidentStatus" AS ENUM ('ADMITTED', 'TRIAGING', 'INVESTIGATING', 'AWAITING_APPROVAL', 'RECOVERING', 'VERIFYING', 'VERIFIED', 'FAILED', 'CANCELLED');
CREATE TYPE "RecoveryStage" AS ENUM ('ADMIT', 'TRIAGE', 'DIAGNOSE', 'RECOVER', 'VERIFY');
CREATE TYPE "IncidentSource" AS ENUM ('MANUAL', 'GITHUB_ACTIONS', 'WEBHOOK', 'API', 'MONITORING');
CREATE TYPE "ActorType" AS ENUM ('USER', 'SERVICE', 'AGENT', 'SYSTEM');
CREATE TYPE "IncidentEventType" AS ENUM ('INCIDENT_ADMITTED', 'TRIAGE_REQUESTED', 'TRIAGE_STARTED', 'EVIDENCE_RECORDED', 'SEVERITY_ASSESSED', 'HEALTH_SNAPSHOT_RECORDED', 'TRIAGE_COMPLETED', 'STATUS_CHANGED', 'RECOVERY_APPROVAL_REQUESTED', 'RECOVERY_APPROVED', 'INCIDENT_FAILED', 'INCIDENT_CANCELLED');
CREATE TYPE "EvidenceKind" AS ENUM ('ERROR', 'LOG', 'COMMAND_OUTPUT', 'CI_RUN', 'REPOSITORY_METADATA', 'CONFIGURATION', 'TEST_RESULT', 'BUILD_RESULT', 'USER_OBSERVATION', 'HEALTH_SIGNAL');
CREATE TYPE "EvidenceSource" AS ENUM ('USER', 'GITHUB', 'SANDBOX', 'CI', 'AGENT', 'SYSTEM');
CREATE TYPE "EvidenceSensitivity" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');
CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'AT_RISK', 'DEGRADED', 'CRITICAL');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

CREATE TABLE "Organization" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Repository" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "provider" "RepositoryProvider" NOT NULL,
  "providerRepoId" TEXT NOT NULL,
  "installationId" TEXT,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "visibility" "RepositoryVisibility" NOT NULL,
  "defaultBranch" TEXT NOT NULL,
  "cloneUrl" TEXT NOT NULL,
  "htmlUrl" TEXT NOT NULL,
  "headSha" TEXT,
  "lastIntakeAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Repository_org_provider_repo_key" UNIQUE ("organizationId", "provider", "providerRepoId"),
  CONSTRAINT "Repository_org_provider_full_name_key" UNIQUE ("organizationId", "provider", "fullName")
);
CREATE INDEX "Repository_org_updated_idx" ON "Repository" ("organizationId", "updatedAt");

CREATE TABLE "RepositoryIntake" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "repositoryId" UUID REFERENCES "Repository"("id") ON DELETE SET NULL,
  "requestedBy" TEXT NOT NULL,
  "requestedUrl" TEXT NOT NULL,
  "requestedBranch" TEXT,
  "selectedBaseBranch" TEXT,
  "status" "RepositoryIntakeStatus" NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0 CHECK ("progress" BETWEEN 0 AND 100),
  "errorCode" TEXT,
  "error" TEXT,
  "requestId" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RepositoryIntake_org_status_requested_idx" ON "RepositoryIntake" ("organizationId", "status", "requestedAt");
CREATE INDEX "RepositoryIntake_repo_requested_idx" ON "RepositoryIntake" ("repositoryId", "requestedAt");

CREATE TABLE "RepositoryWorktree" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE CASCADE,
  "intakeId" UUID NOT NULL UNIQUE REFERENCES "RepositoryIntake"("id") ON DELETE CASCADE,
  "branchName" TEXT NOT NULL,
  "baseBranch" TEXT NOT NULL,
  "baseSha" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "status" "WorktreeStatus" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "removedAt" TIMESTAMPTZ
);
CREATE INDEX "RepositoryWorktree_repo_created_idx" ON "RepositoryWorktree" ("repositoryId", "createdAt");
CREATE INDEX "RepositoryWorktree_status_created_idx" ON "RepositoryWorktree" ("status", "createdAt");

CREATE TABLE "Incident" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE RESTRICT,
  "shortCode" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "IncidentSeverity" NOT NULL,
  "severityScore" INTEGER NOT NULL CHECK ("severityScore" BETWEEN 0 AND 100),
  "severityReason" TEXT NOT NULL,
  "status" "IncidentStatus" NOT NULL,
  "stage" "RecoveryStage" NOT NULL,
  "source" "IncidentSource" NOT NULL,
  "externalReference" TEXT,
  "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "impact" JSONB,
  "signals" JSONB,
  "reportedAt" TIMESTAMPTZ NOT NULL,
  "acknowledgedAt" TIMESTAMPTZ,
  "resolvedAt" TIMESTAMPTZ,
  "lastActivityAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "Incident_org_status_severity_activity_idx" ON "Incident" ("organizationId", "status", "severity", "lastActivityAt" DESC);
CREATE INDEX "Incident_org_repo_created_idx" ON "Incident" ("organizationId", "repositoryId", "createdAt" DESC);
CREATE INDEX "Incident_org_external_ref_idx" ON "Incident" ("organizationId", "externalReference");

CREATE TABLE "IncidentEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "type" "IncidentEventType" NOT NULL,
  "payload" JSONB NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "actorId" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT,
  "causationId" TEXT,
  "previousHash" CHAR(64),
  "eventHash" CHAR(64) NOT NULL UNIQUE,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "IncidentEvent_incident_sequence_key" UNIQUE ("incidentId", "sequence")
);
CREATE INDEX "IncidentEvent_incident_occurred_idx" ON "IncidentEvent" ("incidentId", "occurredAt");
CREATE INDEX "IncidentEvent_correlation_idx" ON "IncidentEvent" ("correlationId");

CREATE TABLE "SeverityAssessment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "score" INTEGER NOT NULL CHECK ("score" BETWEEN 0 AND 100),
  "severity" "IncidentSeverity" NOT NULL,
  "calculatedSeverity" "IncidentSeverity" NOT NULL,
  "overrideApplied" BOOLEAN NOT NULL DEFAULT FALSE,
  "rationale" TEXT NOT NULL,
  "factors" JSONB NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "createdByType" "ActorType" NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "SeverityAssessment_incident_created_idx" ON "SeverityAssessment" ("incidentId", "createdAt" DESC);
CREATE INDEX "SeverityAssessment_severity_created_idx" ON "SeverityAssessment" ("severity", "createdAt" DESC);

CREATE TABLE "RecoverySession" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "worktreeId" UUID REFERENCES "RepositoryWorktree"("id") ON DELETE SET NULL,
  "sandboxId" TEXT,
  "status" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RecoverySession_incident_created_idx" ON "RecoverySession" ("incidentId", "createdAt");
CREATE INDEX "RecoverySession_worktree_idx" ON "RecoverySession" ("worktreeId");

CREATE TABLE "Evidence" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "sessionId" UUID REFERENCES "RecoverySession"("id") ON DELETE SET NULL,
  "kind" "EvidenceKind" NOT NULL,
  "source" "EvidenceSource" NOT NULL,
  "sensitivity" "EvidenceSensitivity" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'application/json',
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" >= 0),
  "digest" CHAR(64) NOT NULL,
  "redacted" BOOLEAN NOT NULL DEFAULT FALSE,
  "redactionCount" INTEGER NOT NULL DEFAULT 0 CHECK ("redactionCount" >= 0),
  "origin" TEXT,
  "collectionMethod" TEXT,
  "observedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Evidence_incident_digest_kind_key" UNIQUE ("incidentId", "digest", "kind")
);
CREATE INDEX "Evidence_org_incident_created_idx" ON "Evidence" ("organizationId", "incidentId", "createdAt" DESC);
CREATE INDEX "Evidence_expires_idx" ON "Evidence" ("expiresAt");

CREATE TABLE "RepositoryHealthSnapshot" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE CASCADE,
  "incidentId" UUID REFERENCES "Incident"("id") ON DELETE SET NULL,
  "overallScore" INTEGER NOT NULL CHECK ("overallScore" BETWEEN 0 AND 100),
  "status" "HealthStatus" NOT NULL,
  "dimensions" JSONB NOT NULL,
  "evidenceCount" INTEGER NOT NULL CHECK ("evidenceCount" >= 0),
  "calculationVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RepositoryHealth_org_repo_created_idx" ON "RepositoryHealthSnapshot" ("organizationId", "repositoryId", "createdAt" DESC);
CREATE INDEX "RepositoryHealth_incident_created_idx" ON "RepositoryHealthSnapshot" ("incidentId", "createdAt" DESC);
CREATE INDEX "RepositoryHealth_status_created_idx" ON "RepositoryHealthSnapshot" ("status", "createdAt" DESC);

CREATE TABLE "VerificationReport" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL UNIQUE REFERENCES "RecoverySession"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "originalFailureResolved" BOOLEAN NOT NULL,
  "buildPassed" BOOLEAN NOT NULL,
  "testsPassed" BOOLEAN NOT NULL,
  "unexpectedChanges" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "OutboxMessage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "topic" TEXT NOT NULL,
  "partitionKey" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "availableAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lockedAt" TIMESTAMPTZ,
  "lockedBy" TEXT,
  "publishedAt" TIMESTAMPTZ,
  "lastErrorCode" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "Outbox_status_available_created_idx" ON "OutboxMessage" ("status", "availableAt", "createdAt");
CREATE INDEX "Outbox_org_topic_created_idx" ON "OutboxMessage" ("organizationId", "topic", "createdAt");

CREATE TABLE "AuditLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID REFERENCES "Incident"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "actorId" TEXT,
  "outcome" "AuditOutcome" NOT NULL,
  "requestId" TEXT,
  "correlationId" TEXT,
  "reason" TEXT,
  "metadata" JSONB NOT NULL,
  "previousHash" CHAR(64),
  "auditHash" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "AuditLog_org_created_idx" ON "AuditLog" ("organizationId", "createdAt" DESC);
CREATE INDEX "AuditLog_resource_created_idx" ON "AuditLog" ("resourceType", "resourceId", "createdAt" DESC);
CREATE INDEX "AuditLog_incident_created_idx" ON "AuditLog" ("incidentId", "createdAt" DESC);

CREATE TABLE "IdempotencyRecord" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "resourceId" TEXT,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Idempotency_org_scope_key" UNIQUE ("organizationId", "scope", "key")
);
CREATE INDEX "Idempotency_expires_idx" ON "IdempotencyRecord" ("expiresAt");

INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'local-development', 'Local Development', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- Append-only protection for evidence, events and audit history.
CREATE OR REPLACE FUNCTION codeer_reject_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CodeER immutable record cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IncidentEvent_immutable_update" BEFORE UPDATE OR DELETE ON "IncidentEvent"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "AuditLog_immutable_update" BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();

-- Evidence contents are immutable after collection. Retention workers may delete expired records,
-- but updates are rejected so digest-bearing evidence cannot be silently rewritten.
CREATE TRIGGER "Evidence_immutable_update" BEFORE UPDATE ON "Evidence"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();

-- Defense-in-depth tenant isolation. Application transactions set
-- app.current_organization_id before accessing tenant-owned rows. The outbox dispatcher uses a
-- narrowly scoped transaction-local worker bypass because it must dispatch messages across tenants.
CREATE OR REPLACE FUNCTION codeer_current_organization_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION codeer_worker_bypass_rls() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.codeer_worker_bypass', true), '') = 'true';
$$ LANGUAGE SQL STABLE;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Organization_tenant_policy" ON "Organization" FOR ALL
  USING ("id" = codeer_current_organization_id())
  WITH CHECK ("id" = codeer_current_organization_id());

ALTER TABLE "Repository" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Repository" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Repository_tenant_policy" ON "Repository" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "RepositoryIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepositoryIntake" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RepositoryIntake_tenant_policy" ON "RepositoryIntake" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "Incident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Incident" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Incident_tenant_policy" ON "Incident" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "Evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Evidence_tenant_policy" ON "Evidence" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "RepositoryHealthSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepositoryHealthSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RepositoryHealthSnapshot_tenant_policy" ON "RepositoryHealthSnapshot" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditLog_tenant_policy" ON "AuditLog" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY "IdempotencyRecord_tenant_policy" ON "IdempotencyRecord" FOR ALL
  USING ("organizationId" = codeer_current_organization_id())
  WITH CHECK ("organizationId" = codeer_current_organization_id());

ALTER TABLE "OutboxMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OutboxMessage_tenant_or_dispatcher_policy" ON "OutboxMessage" FOR ALL
  USING (
    "organizationId" = codeer_current_organization_id()
    OR codeer_worker_bypass_rls()
  )
  WITH CHECK (
    "organizationId" = codeer_current_organization_id()
    OR codeer_worker_bypass_rls()
  );

ALTER TABLE "RepositoryWorktree" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepositoryWorktree" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RepositoryWorktree_tenant_policy" ON "RepositoryWorktree" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Repository" r
    WHERE r."id" = "RepositoryWorktree"."repositoryId"
      AND r."organizationId" = codeer_current_organization_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Repository" r
    WHERE r."id" = "RepositoryWorktree"."repositoryId"
      AND r."organizationId" = codeer_current_organization_id()
  ));

ALTER TABLE "IncidentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncidentEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "IncidentEvent_tenant_policy" ON "IncidentEvent" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."id" = "IncidentEvent"."incidentId"
      AND i."organizationId" = codeer_current_organization_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."id" = "IncidentEvent"."incidentId"
      AND i."organizationId" = codeer_current_organization_id()
  ));

ALTER TABLE "SeverityAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeverityAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SeverityAssessment_tenant_policy" ON "SeverityAssessment" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."id" = "SeverityAssessment"."incidentId"
      AND i."organizationId" = codeer_current_organization_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."id" = "SeverityAssessment"."incidentId"
      AND i."organizationId" = codeer_current_organization_id()
  ));

ALTER TABLE "RecoverySession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoverySession" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RecoverySession_tenant_policy" ON "RecoverySession" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."id" = "RecoverySession"."incidentId"
      AND i."organizationId" = codeer_current_organization_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."id" = "RecoverySession"."incidentId"
      AND i."organizationId" = codeer_current_organization_id()
  ));

ALTER TABLE "VerificationReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "VerificationReport_tenant_policy" ON "VerificationReport" FOR ALL
  USING (EXISTS (
    SELECT 1
    FROM "RecoverySession" rs
    JOIN "Incident" i ON i."id" = rs."incidentId"
    WHERE rs."id" = "VerificationReport"."sessionId"
      AND i."organizationId" = codeer_current_organization_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM "RecoverySession" rs
    JOIN "Incident" i ON i."id" = rs."incidentId"
    WHERE rs."id" = "VerificationReport"."sessionId"
      AND i."organizationId" = codeer_current_organization_id()
  ));
