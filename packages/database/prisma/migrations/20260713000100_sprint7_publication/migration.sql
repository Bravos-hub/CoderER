-- CodeER Sprint 7: GitHub publication, pull-request lifecycle and verified recovery closure.
-- Apply only after Sprint 6 controlled recovery.

CREATE TYPE "PublicationStatus" AS ENUM (
  'PUBLICATION_REQUESTED','POLICY_CHECK','COMMIT_MATERIALIZING','BRANCH_PUBLISHING',
  'DRAFT_PR_CREATING','CI_MONITORING','REVIEW_MONITORING','AWAITING_REVIEW',
  'READY_FOR_HUMAN_MERGE','MERGED','POST_MERGE_VERIFYING','RECOVERY_CONFIRMED','CLOSED',
  'PUBLICATION_BLOCKED','PUSH_FAILED','PR_CREATION_FAILED','CI_FAILED','CHANGES_REQUESTED',
  'REVISION_REQUIRED','BASE_BRANCH_STALE','SECURITY_BLOCKED','POST_MERGE_FAILED',
  'MERGE_REVERTED','CANCELLED','TIMED_OUT'
);
CREATE TYPE "PublicationCheckStatus" AS ENUM ('QUEUED','RUNNING','PASSED','FAILED','CANCELLED','TIMED_OUT','NEUTRAL','STALE');
CREATE TYPE "PublicationReviewState" AS ENUM ('PENDING','APPROVED','CHANGES_REQUESTED','DISMISSED','COMMENTED');

CREATE TABLE "GithubInstallation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "installationId" BIGINT NOT NULL,
  "accountLogin" TEXT NOT NULL,
  "accountType" TEXT NOT NULL CHECK ("accountType" IN ('User','Organization')),
  "permissions" JSONB NOT NULL,
  "repositorySelection" TEXT NOT NULL CHECK ("repositorySelection" IN ('all','selected')),
  "suspendedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "GithubInstallation_org_installation_key" UNIQUE ("organizationId","installationId")
);
CREATE INDEX "GithubInstallation_org_created_idx" ON "GithubInstallation" ("organizationId","createdAt" DESC);

CREATE TABLE "RepositoryPublicationPolicy" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE CASCADE,
  "policyVersion" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "allowedBaseBranches" TEXT[] NOT NULL,
  "recoveryBranchPrefix" TEXT NOT NULL,
  "requiredChecks" TEXT[] NOT NULL,
  "requiredApprovals" INTEGER NOT NULL CHECK ("requiredApprovals" BETWEEN 0 AND 20),
  "requireCodeOwnerApproval" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowForcePush" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("allowForcePush" = FALSE),
  "allowProtectedBranchWrites" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("allowProtectedBranchWrites" = FALSE),
  "allowAutomaticMerge" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("allowAutomaticMerge" = FALSE),
  "maximumPublicationAttempts" INTEGER NOT NULL DEFAULT 3 CHECK ("maximumPublicationAttempts" BETWEEN 1 AND 20),
  "webhookReplayWindowSeconds" INTEGER NOT NULL DEFAULT 600 CHECK ("webhookReplayWindowSeconds" BETWEEN 60 AND 86400),
  "postMergeVerificationRequired" BOOLEAN NOT NULL DEFAULT TRUE,
  "retentionDays" INTEGER NOT NULL DEFAULT 365 CHECK ("retentionDays" BETWEEN 1 AND 3650),
  "contentHash" CHAR(64) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RepositoryPublicationPolicy_repo_version_key" UNIQUE ("repositoryId","policyVersion")
);
CREATE INDEX "RepositoryPublicationPolicy_org_repo_active_idx" ON "RepositoryPublicationPolicy" ("organizationId","repositoryId","active","createdAt" DESC);

CREATE TABLE "PublicationRun" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL REFERENCES "Incident"("id") ON DELETE CASCADE,
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE RESTRICT,
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE RESTRICT,
  "installationId" UUID NOT NULL REFERENCES "GithubInstallation"("id") ON DELETE RESTRICT,
  "publicationPolicyId" UUID NOT NULL REFERENCES "RepositoryPublicationPolicy"("id") ON DELETE RESTRICT,
  "status" "PublicationStatus" NOT NULL DEFAULT 'PUBLICATION_REQUESTED',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "policyVersion" TEXT NOT NULL,
  "baseBranch" TEXT NOT NULL,
  "headBranch" TEXT NOT NULL,
  "baseCommitSha" CHAR(40) NOT NULL CHECK ("baseCommitSha" ~ '^[0-9a-f]{40}$'),
  "approvedPatchVersion" INTEGER NOT NULL CHECK ("approvedPatchVersion" > 0),
  "patchDigest" CHAR(64) NOT NULL CHECK ("patchDigest" ~ '^[0-9a-f]{64}$'),
  "expectedTreeDigest" CHAR(64) NOT NULL CHECK ("expectedTreeDigest" ~ '^[0-9a-f]{64}$'),
  "treeSha" CHAR(40),
  "commitSha" CHAR(40),
  "pullRequestNumber" INTEGER,
  "pullRequestUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "cancellationRequestedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PublicationRun_org_idempotency_key" UNIQUE ("organizationId","idempotencyKey"),
  CONSTRAINT "PublicationRun_recovery_patch_key" UNIQUE ("recoveryId","approvedPatchVersion")
);
CREATE INDEX "PublicationRun_org_incident_created_idx" ON "PublicationRun" ("organizationId","incidentId","createdAt" DESC);
CREATE INDEX "PublicationRun_status_lease_idx" ON "PublicationRun" ("status","leaseExpiresAt");
CREATE INDEX "PublicationRun_repository_created_idx" ON "PublicationRun" ("repositoryId","createdAt" DESC);

CREATE TABLE "PublicationEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "previousHash" CHAR(64),
  "eventHash" CHAR(64) NOT NULL UNIQUE,
  "actorType" "ActorType" NOT NULL,
  "actorId" TEXT,
  "correlationId" TEXT,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PublicationEvent_run_sequence_key" UNIQUE ("publicationId","sequence")
);
CREATE INDEX "PublicationEvent_run_occurred_idx" ON "PublicationEvent" ("publicationId","occurredAt");

CREATE TABLE "PublishedCommit" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL UNIQUE REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "baseCommitSha" CHAR(40) NOT NULL,
  "treeSha" CHAR(40) NOT NULL,
  "commitSha" CHAR(40) NOT NULL UNIQUE,
  "patchDigest" CHAR(64) NOT NULL,
  "treeDigest" CHAR(64) NOT NULL,
  "messageDigest" CHAR(64) NOT NULL,
  "materializedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "PullRequestRecord" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL UNIQUE REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "number" INTEGER NOT NULL,
  "nodeId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "bodyDigest" CHAR(64) NOT NULL,
  "baseBranch" TEXT NOT NULL,
  "headBranch" TEXT NOT NULL,
  "draft" BOOLEAN NOT NULL DEFAULT TRUE,
  "state" TEXT NOT NULL CHECK ("state" IN ('open','closed','merged')),
  "headSha" CHAR(40) NOT NULL,
  "baseSha" CHAR(40) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PullRequestRecord_publication_number_key" UNIQUE ("publicationId","number")
);

CREATE TABLE "PublicationCheck" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "PublicationCheckStatus" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT FALSE,
  "detailsUrl" TEXT,
  "headSha" CHAR(40) NOT NULL,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "rawConclusion" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PublicationCheck_run_external_key" UNIQUE ("publicationId","externalId")
);
CREATE INDEX "PublicationCheck_run_status_idx" ON "PublicationCheck" ("publicationId","status","required");

CREATE TABLE "PublicationReview" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "externalId" TEXT NOT NULL,
  "reviewerLogin" TEXT NOT NULL,
  "reviewerNodeId" TEXT,
  "state" "PublicationReviewState" NOT NULL,
  "codeOwner" BOOLEAN NOT NULL DEFAULT FALSE,
  "bodyDigest" CHAR(64),
  "submittedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PublicationReview_run_external_key" UNIQUE ("publicationId","externalId")
);
CREATE INDEX "PublicationReview_run_state_idx" ON "PublicationReview" ("publicationId","state");

CREATE TABLE "PublicationReviewComment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "externalId" TEXT NOT NULL,
  "reviewExternalId" TEXT,
  "authorLogin" TEXT NOT NULL,
  "path" TEXT,
  "line" INTEGER,
  "body" TEXT NOT NULL,
  "bodyDigest" CHAR(64) NOT NULL,
  "sanitizedBody" TEXT NOT NULL,
  "blocking" BOOLEAN NOT NULL DEFAULT FALSE,
  "resolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PublicationReviewComment_run_external_key" UNIQUE ("publicationId","externalId")
);

CREATE TABLE "RevisionRequest" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "recoveryId" UUID NOT NULL REFERENCES "RecoveryRun"("id") ON DELETE RESTRICT,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "sourceReviewIds" TEXT[] NOT NULL,
  "sourceCheckIds" TEXT[] NOT NULL,
  "scopeExpansionRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" TEXT NOT NULL CHECK ("status" IN ('REQUESTED','ACCEPTED','REJECTED','SUPERSEDED')),
  "digest" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "RevisionRequest_publication_created_idx" ON "RevisionRequest" ("publicationId","createdAt" DESC);

CREATE TABLE "MergeReadinessDecision" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "ready" BOOLEAN NOT NULL,
  "blockers" JSONB NOT NULL,
  "inputDigest" CHAR(64) NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "headSha" CHAR(40) NOT NULL,
  "baseSha" CHAR(40) NOT NULL,
  "evaluatedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "MergeReadinessDecision_run_input_key" UNIQUE ("publicationId","inputDigest")
);
CREATE INDEX "MergeReadinessDecision_run_evaluated_idx" ON "MergeReadinessDecision" ("publicationId","evaluatedAt" DESC);

CREATE TABLE "MergeObservation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL UNIQUE REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "mergeCommitSha" CHAR(40) NOT NULL,
  "mergedBy" TEXT NOT NULL,
  "mergedAt" TIMESTAMPTZ NOT NULL,
  "approvedHeadSha" CHAR(40) NOT NULL,
  "observedTreeSha" CHAR(40),
  "integrityValid" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "PostMergeVerification" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL CHECK ("status" IN ('PENDING','RUNNING','PASSED','FAILED','INCONCLUSIVE')),
  "mergeCommitSha" CHAR(40) NOT NULL,
  "approvedPatchPresent" BOOLEAN NOT NULL DEFAULT FALSE,
  "originalFailureResolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "requiredChecksPassed" BOOLEAN NOT NULL DEFAULT FALSE,
  "repositoryHealthImproved" BOOLEAN NOT NULL DEFAULT FALSE,
  "rollbackTriggered" BOOLEAN NOT NULL DEFAULT FALSE,
  "evidence" JSONB NOT NULL,
  "digest" CHAR(64) NOT NULL UNIQUE,
  "startedAt" TIMESTAMPTZ NOT NULL,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "PostMergeVerification_run_created_idx" ON "PostMergeVerification" ("publicationId","createdAt" DESC);

CREATE TABLE "IncidentClosureRecord" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "incidentId" UUID NOT NULL UNIQUE REFERENCES "Incident"("id") ON DELETE RESTRICT,
  "publicationId" UUID NOT NULL REFERENCES "PublicationRun"("id") ON DELETE RESTRICT,
  "postMergeVerificationId" UUID NOT NULL REFERENCES "PostMergeVerification"("id") ON DELETE RESTRICT,
  "closedBy" TEXT NOT NULL,
  "closureReason" TEXT NOT NULL,
  "evidenceDigest" CHAR(64) NOT NULL UNIQUE,
  "closedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "GithubWebhookDelivery" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID REFERENCES "Organization"("id") ON DELETE CASCADE,
  "installationId" BIGINT,
  "deliveryId" TEXT NOT NULL UNIQUE,
  "eventName" TEXT NOT NULL,
  "action" TEXT,
  "signatureValid" BOOLEAN NOT NULL,
  "payloadDigest" CHAR(64) NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('RECEIVED','PROCESSED','IGNORED','REJECTED','FAILED')),
  "errorCode" TEXT,
  "receivedAt" TIMESTAMPTZ NOT NULL,
  "processedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "GithubWebhookDelivery_installation_received_idx" ON "GithubWebhookDelivery" ("installationId","receivedAt" DESC);

-- Immutable audit-bearing records.
CREATE TRIGGER "PublishedCommit_immutable" BEFORE UPDATE OR DELETE ON "PublishedCommit"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "PublicationEvent_immutable" BEFORE UPDATE OR DELETE ON "PublicationEvent"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "MergeReadinessDecision_immutable" BEFORE UPDATE OR DELETE ON "MergeReadinessDecision"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "MergeObservation_immutable" BEFORE UPDATE OR DELETE ON "MergeObservation"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "PostMergeVerification_immutable" BEFORE UPDATE OR DELETE ON "PostMergeVerification"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();
CREATE TRIGGER "IncidentClosureRecord_immutable" BEFORE UPDATE OR DELETE ON "IncidentClosureRecord"
FOR EACH ROW EXECUTE FUNCTION codeer_reject_immutable_mutation();

-- Tenant isolation. Child tables resolve tenancy through PublicationRun.
ALTER TABLE "GithubInstallation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GithubInstallation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RepositoryPublicationPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepositoryPublicationPolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PublicationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PublicationRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "IncidentClosureRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncidentClosureRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GithubWebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GithubWebhookDelivery" FORCE ROW LEVEL SECURITY;

CREATE POLICY "GithubInstallation_tenant" ON "GithubInstallation"
USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY "RepositoryPublicationPolicy_tenant" ON "RepositoryPublicationPolicy"
USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY "PublicationRun_tenant" ON "PublicationRun"
USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY "IncidentClosureRecord_tenant" ON "IncidentClosureRecord"
USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY "GithubWebhookDelivery_tenant" ON "GithubWebhookDelivery"
USING ("organizationId" IS NULL OR "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organizationId" IS NULL OR "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PublicationEvent','PublishedCommit','PullRequestRecord','PublicationCheck','PublicationReview',
    'PublicationReviewComment','RevisionRequest','MergeReadinessDecision','MergeObservation','PostMergeVerification'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM "PublicationRun" p WHERE p."id" = %I."publicationId" AND p."organizationId" = NULLIF(current_setting(''app.current_organization_id'', true), '''')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM "PublicationRun" p WHERE p."id" = %I."publicationId" AND p."organizationId" = NULLIF(current_setting(''app.current_organization_id'', true), '''')::uuid))',
      table_name || '_tenant', table_name, table_name, table_name
    );
  END LOOP;
END $$;
