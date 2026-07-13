import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  ActorRole,
  ActorType,
  CitationSourceType,
  PatchVersionStatus,
  PublicationDecision,
  RecoveryRunStatus,
  RecoverySecurityDecision,
  RecoveryVerificationCheckStatus,
  RecoveryVerificationStatus,
} from '@codeer/contracts';
import {
  createDatabasePool,
  RecoveryStore,
  TenantResourceNotFoundError,
  withTransaction,
} from '@codeer/database';
import { defaultRecoveryPolicy } from '@codeer/recovery';
import { sha256Hex } from '@codeer/security';

const appUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_WORKER_URL;
if (!appUrl || !workerUrl) throw new Error('DATABASE_URL and DATABASE_WORKER_URL are required.');

const appPool = createDatabasePool(appUrl, { max: 4, application_name: 'recovery-smoke-api' });
const workerPool = createDatabasePool(workerUrl, {
  max: 4,
  application_name: 'recovery-smoke-worker',
});
const appStore = new RecoveryStore(appPool);
const workerStore = new RecoveryStore(workerPool);

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const repositoryId = randomUUID();
const intakeId = randomUUID();
const worktreeId = randomUUID();
const incidentId = randomUUID();
const sandboxExecutionId = randomUUID();
const reproductionId = randomUUID();
const aiPolicyId = randomUUID();
const investigationId = randomUUID();
const diagnosisId = randomUUID();
const planId = randomUUID();
const planStepId = randomUUID();
const baseCommitSha = 'a'.repeat(40);
const sourceDigest = sha256Hex('verified missing build script');
const workerId = `recovery-smoke-${randomUUID()}`;

const serviceContext = {
  organizationId,
  actorId: 'recovery-smoke-service',
  actorType: ActorType.SERVICE,
  actorRoles: [ActorRole.SERVICE],
  requestId: `request-${randomUUID()}`,
  correlationId: `correlation-${randomUUID()}`,
};
const citation = {
  sourceType: CitationSourceType.REPRODUCTION,
  sourceId: reproductionId,
  digest: sourceDigest,
  label: 'Verified failure reproduction',
};

try {
  await withTransaction(
    async (client) => {
      await client.query(
        `INSERT INTO "Organization" ("id","slug","name","createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())`,
        [organizationId, `recovery-${organizationId.slice(0, 8)}`, 'Recovery Persistence Smoke'],
      );
      await client.query(
        `INSERT INTO "Repository" (
          "id","organizationId","provider","providerRepoId","owner","name","fullName","visibility",
          "defaultBranch","cloneUrl","htmlUrl","headSha","createdAt","updatedAt"
        ) VALUES ($1,$2,'GITHUB',$3,'codeer-ci','recovery-fixture','codeer-ci/recovery-fixture',
          'PRIVATE','main','https://github.com/codeer-ci/recovery-fixture.git',
          'https://github.com/codeer-ci/recovery-fixture',$4,NOW(),NOW())`,
        [repositoryId, organizationId, randomUUID(), baseCommitSha],
      );
      await client.query(
        `INSERT INTO "RepositoryIntake" (
          "id","organizationId","repositoryId","requestedBy","requestedUrl","selectedBaseBranch",
          "status","progress","requestId","requestedAt","completedAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,'https://github.com/codeer-ci/recovery-fixture','main','READY',100,$5,NOW(),NOW(),NOW())`,
        [intakeId, organizationId, repositoryId, serviceContext.actorId, serviceContext.requestId],
      );
      await client.query(
        `INSERT INTO "RepositoryWorktree" (
          "id","repositoryId","intakeId","branchName","baseBranch","baseSha","relativePath","status","createdAt"
        ) VALUES ($1,$2,$3,'codeer/source/recovery-smoke','main',$4,'recovery-fixture','ACTIVE',NOW())`,
        [worktreeId, repositoryId, intakeId, baseCommitSha],
      );
      await client.query(
        `INSERT INTO "Incident" (
          "id","organizationId","repositoryId","shortCode","title","description","severity","severityScore",
          "severityReason","status","stage","source","labels","version","reportedAt","lastActivityAt","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,'Recovery smoke','Controlled recovery persistence smoke','SEV-2',75,
          'Production build blocked','INVESTIGATING','RECOVER','MANUAL',ARRAY['ci-smoke'],1,NOW(),NOW(),NOW(),NOW())`,
        [incidentId, organizationId, repositoryId, `ER-${Date.now()}`],
      );
      await client.query(
        `INSERT INTO "SandboxExecution" (
          "id","organizationId","incidentId","worktreeId","status","result","image","environmentFingerprint",
          "startedAt","completedAt","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,'COMPLETED','REPRODUCED','node:24-bookworm-slim',$5,NOW(),NOW(),NOW(),NOW())`,
        [sandboxExecutionId, organizationId, incidentId, worktreeId, sha256Hex('environment')],
      );
      await client.query(
        `INSERT INTO "FailureReproduction" (
          "id","organizationId","incidentId","executionId","input","status","result","originalFailureSignature",
          "observedFailureSignature","signatureComparison","confidence","environmentFingerprint","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5::jsonb,'COMPLETED','REPRODUCED',$6::jsonb,$6::jsonb,$7::jsonb,0.99,$8,NOW(),NOW())`,
        [
          reproductionId,
          organizationId,
          incidentId,
          sandboxExecutionId,
          JSON.stringify({
            reproductionCommands: [{ executable: 'npm', arguments: ['run', 'build:super'] }],
          }),
          JSON.stringify({
            normalized: 'npm error Missing script: build:super',
            digest: sourceDigest,
            tokens: ['npm', 'missing', 'script'],
          }),
          JSON.stringify({ matched: true, similarity: 1, rationale: 'Exact match' }),
          sha256Hex('environment'),
        ],
      );
      await client.query(
        `INSERT INTO "OrganizationAiPolicy" (
          "id","organizationId","provider","allowedModels","modelByAgent","allowedTools",
          "maximumConcurrentInvestigations","maximumModelInvocations","maximumToolCalls","maximumInputTokens",
          "maximumOutputTokens","maximumCostUsd","timeoutMs","retentionDays","requireHumanApproval",
          "requireIndependentCritic","requireSecurityReview","storeProviderResponses","policyVersion","active",
          "contentHash","createdBy","createdAt"
        ) VALUES ($1,$2,'OPENAI',ARRAY['gpt-5.6'],'{}'::jsonb,ARRAY[]::text[],2,20,100,200000,30000,25,2700000,30,
          true,true,true,false,'smoke-ai-v1',true,$3,$4,NOW())`,
        [aiPolicyId, organizationId, sha256Hex('smoke-ai-policy'), serviceContext.actorId],
      );
      await client.query(
        `INSERT INTO "InvestigationRun" (
          "id","organizationId","incidentId","reproductionId","aiPolicyId","status","promptTemplateVersion",
          "requestedBy","input","completedAt","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'APPROVED','smoke-v1',$6,'{}'::jsonb,NOW(),NOW(),NOW())`,
        [
          investigationId,
          organizationId,
          incidentId,
          reproductionId,
          aiPolicyId,
          serviceContext.actorId,
        ],
      );
      await client.query(
        `INSERT INTO "Diagnosis" (
          "id","organizationId","incidentId","investigationId","summary","failureMechanism","blastRadius",
          "securityImpact","confidence","confidenceBand","unknowns","citations","schemaVersion","contentHash","createdAt"
        ) VALUES ($1,$2,$3,$4,'The configured build script is missing.','The CI command invokes an absent npm script.',
          'Production artifacts cannot be built.','No direct security exposure observed.',0.99,'HIGH','[]'::jsonb,$5::jsonb,
          'diagnosis-v1',$6,NOW())`,
        [
          diagnosisId,
          organizationId,
          incidentId,
          investigationId,
          JSON.stringify([citation]),
          sha256Hex(`diagnosis:${investigationId}`),
        ],
      );
      await client.query(
        `INSERT INTO "TreatmentPlan" (
          "id","organizationId","incidentId","investigationId","diagnosisId","version","status","goal","risk",
          "verificationMatrix","rollbackStrategy","compatibilityImpact","migrationImpact","knownLimitations",
          "requiredApprovals","schemaVersion","contentHash","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,1,'APPROVED','Restore the build with the smallest manifest correction.','HIGH',
          $6::jsonb,'Revert the single manifest change.','No public API impact.','No migration.','[]'::jsonb,1,
          'plan-v1',$7,NOW(),NOW())`,
        [
          planId,
          organizationId,
          incidentId,
          investigationId,
          diagnosisId,
          JSON.stringify([
            {
              requirement: 'Build succeeds',
              evidenceRequired: 'Sandbox build log',
              mandatory: true,
            },
          ]),
          sha256Hex(`plan:${planId}`),
        ],
      );
      await client.query(
        `INSERT INTO "TreatmentPlanStep" (
          "id","planId","sequence","title","objective","affectedComponents","scopeRestrictions","risk",
          "securityConsiderations","verificationCommands","expectedResults","rollbackProcedure","citations","createdAt"
        ) VALUES ($1,$2,1,'Align build entry point','Add or correct the approved build script.',ARRAY['apps/api/package.json'],
          '["No unrelated refactoring"]'::jsonb,'HIGH','[]'::jsonb,$3::jsonb,
          '["Original failure is absent"]'::jsonb,'Revert the manifest hunk.',$4::jsonb,NOW())`,
        [
          planStepId,
          planId,
          JSON.stringify([
            {
              executable: 'npm',
              arguments: ['run', 'build'],
              workingDirectory: '.',
              phase: 'REPRODUCTION',
              timeoutMs: 600000,
            },
          ]),
          JSON.stringify([citation]),
        ],
      );
      await client.query(
        `INSERT INTO "PlanApproval" (
          "id","organizationId","planId","decision","comment","actorId","actorType","actorRoles",
          "planVersion","requestId","correlationId","decisionHash","createdAt"
        ) VALUES ($1,$2,$3,'APPROVE','Approved high-risk treatment plan.','plan-approver','USER',ARRAY['INCIDENT_COMMANDER'],
          1,$4,$5,$6,NOW())`,
        [
          randomUUID(),
          organizationId,
          planId,
          serviceContext.requestId,
          serviceContext.correlationId,
          sha256Hex('plan-approval'),
        ],
      );
    },
    { tenantOrganizationId: organizationId },
    appPool,
  );

  const policy = {
    ...defaultRecoveryPolicy(['apps/api'], ['.json']),
    requiredPublicationApprovals: 2,
    allowDependencyChanges: true,
  };
  const command = {
    context: serviceContext,
    planId,
    input: { baseCommitSha, additionalConstraints: ['Only modify apps/api/package.json.'] },
    policy,
    idempotencyKey: `recovery-${randomUUID()}`,
    idempotencyTtlSeconds: 3600,
  };
  const created = await appStore.createRecovery(command);
  const replayed = await appStore.createRecovery(command);
  if (created.id !== replayed.id) throw new Error('Recovery idempotency failed.');

  const unscoped = await appPool.query(
    `SELECT COUNT(*)::int AS count FROM "RecoveryRun" WHERE "id"=$1`,
    [created.id],
  );
  if (unscoped.rows[0]?.count !== 0)
    throw new Error('Forced RLS leaked recovery data without tenant context.');
  let crossTenantBlocked = false;
  try {
    await appStore.getRecovery(otherOrganizationId, created.id);
  } catch (error) {
    crossTenantBlocked = error instanceof TenantResourceNotFoundError;
  }
  if (!crossTenantBlocked) throw new Error('Cross-tenant recovery access was not blocked.');

  const envelope = await workerStore.acquireLease(created.id, workerId, 90);
  if (!envelope) throw new Error('Worker could not acquire the recovery lease.');
  const duplicateLease = await workerStore.acquireLease(created.id, `${workerId}-other`, 90);
  if (duplicateLease !== null)
    throw new Error('A second worker acquired the active recovery lease.');

  for (const [status, event] of [
    [RecoveryRunStatus.POLICY_CHECK, 'RECOVERY_POLICY_CHECKED'],
    [RecoveryRunStatus.WORKTREE_PREPARING, 'RECOVERY_WORKTREE_PREPARING'],
    [RecoveryRunStatus.PATCH_PLANNING, 'RECOVERY_PATCH_PLANNING'],
    [RecoveryRunStatus.PATCH_GENERATING, 'RECOVERY_PATCH_GENERATING'],
    [RecoveryRunStatus.PATCH_VALIDATING, 'RECOVERY_PATCH_VALIDATING'],
  ]) {
    await workerStore.checkpoint(
      organizationId,
      created.id,
      workerId,
      status,
      { smoke: true },
      event,
    );
  }
  await workerStore.recordWorktree({
    organizationId,
    recoveryId: created.id,
    workerId,
    relativePath: created.id,
    repositoryPathRef: 'recovery-fixture',
    branchName: created.branchName,
    baseCommitSha,
  });

  const patchId = randomUUID();
  const fileId = randomUUID();
  const hunkId = randomUUID();
  const unifiedDiff = [
    'diff --git a/apps/api/package.json b/apps/api/package.json',
    '--- a/apps/api/package.json',
    '+++ b/apps/api/package.json',
    '@@ -1 +1 @@',
    '-{"scripts":{}}',
    '+{"scripts":{"build":"tsc"}}',
  ].join('\n');
  const patch = {
    id: patchId,
    recoveryId: created.id,
    version: 1,
    status: PatchVersionStatus.ACCEPTED,
    baseCommitSha,
    unifiedDiff,
    patchDigest: sha256Hex(`${unifiedDiff}:${created.id}`),
    changedFiles: 1,
    addedLines: 1,
    deletedLines: 1,
    files: [
      {
        id: fileId,
        patchId,
        oldPath: 'apps/api/package.json',
        newPath: 'apps/api/package.json',
        changeType: 'MODIFY',
        oldDigest: sha256Hex('{"scripts":{}}'),
        newDigest: sha256Hex('{"scripts":{"build":"tsc"}}'),
        addedLines: 1,
        deletedLines: 1,
        binary: false,
        generated: false,
        sensitive: false,
        hunks: [
          {
            id: hunkId,
            fileId,
            sequence: 1,
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            content: '@@ -1 +1 @@\n-{"scripts":{}}\n+{"scripts":{"build":"tsc"}}',
            addedLines: 1,
            deletedLines: 1,
            treatmentPlanStep: 1,
            evidenceCitations: [citation],
            contentHash: sha256Hex(`hunk-content:${hunkId}`),
          },
        ],
      },
    ],
    policyDecision: {
      allowed: true,
      reasons: [],
      policyVersion: policy.policyVersion,
      evaluatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
  await workerStore.recordPatch(organizationId, created.id, workerId, patch);
  await workerStore.checkpoint(
    organizationId,
    created.id,
    workerId,
    RecoveryRunStatus.SECURITY_REVIEW,
    { patchId },
    'RECOVERY_SECURITY_REVIEW_STARTED',
  );
  const review = {
    id: randomUUID(),
    recoveryId: created.id,
    patchId,
    decision: RecoverySecurityDecision.ALLOW,
    summary: 'Independent review found the evidence-linked manifest patch within approved scope.',
    findings: [],
    reviewerModel: 'deterministic-smoke',
    contentHash: sha256Hex(`security-review:${patchId}`),
    createdAt: new Date().toISOString(),
  };
  await workerStore.recordSecurityReview(organizationId, created.id, workerId, review);
  await workerStore.checkpoint(
    organizationId,
    created.id,
    workerId,
    RecoveryRunStatus.VERIFYING,
    { patchId },
    'RECOVERY_VERIFYING',
  );
  const verificationId = randomUUID();
  const verification = {
    id: verificationId,
    recoveryId: created.id,
    patchId,
    status: RecoveryVerificationStatus.PASSED,
    originalFailureResolved: true,
    unexpectedChanges: [],
    scopeExpanded: false,
    checks: [
      {
        id: randomUUID(),
        verificationId,
        sequence: 1,
        name: 'production build',
        mandatory: true,
        status: RecoveryVerificationCheckStatus.PASSED,
        exitCode: 0,
        evidenceIds: [randomUUID()],
        summary: 'Build passed in the hardened sandbox.',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ],
    summary: 'Original failure resolved and mandatory verification passed.',
    confidence: 0.99,
    contentHash: sha256Hex(`verification:${verificationId}`),
    createdAt: new Date().toISOString(),
  };
  await workerStore.recordVerification(organizationId, created.id, workerId, verification);
  await workerStore.checkpoint(
    organizationId,
    created.id,
    workerId,
    RecoveryRunStatus.PACKAGE_BUILDING,
    { patchId },
    'RECOVERY_PACKAGE_BUILDING',
  );
  const pkg = {
    id: randomUUID(),
    version: 1,
    recoveryId: created.id,
    patchId,
    title: 'Restore approved production build entry point',
    body: '## Root cause\nThe build script was absent.\n\n## Verification\nThe hardened sandbox build passed.',
    headBranch: created.branchName,
    baseBranch: 'main',
    rootCauseSummary: 'The deployment invoked an npm script absent from the manifest.',
    changedFiles: ['apps/api/package.json'],
    riskSummary: 'High-risk plan constrained to one manifest hunk.',
    verificationSummary: 'Original failure resolved; mandatory build passed.',
    knownLimitations: [],
    rollbackInstructions: 'Revert the single manifest hunk and rerun the original reproduction.',
    packageHash: sha256Hex(`pr-package:${created.id}`),
    createdAt: new Date().toISOString(),
  };
  await workerStore.recordPullRequestPackage(organizationId, created.id, workerId, pkg);
  await workerStore.checkpoint(
    organizationId,
    created.id,
    workerId,
    RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
    { packageId: pkg.id },
    'RECOVERY_AWAITING_PUBLICATION_APPROVAL',
  );
  await workerStore.markCleanup({
    organizationId,
    recoveryId: created.id,
    workerId,
    worktreeAbsent: true,
    branchDeleted: true,
  });
  await workerStore.releaseLease(organizationId, created.id, workerId);

  const planApprover = {
    ...serviceContext,
    actorId: 'plan-approver',
    actorType: ActorType.USER,
    actorRoles: [ActorRole.INCIDENT_COMMANDER],
    requestId: randomUUID(),
  };
  let separationBlocked = false;
  try {
    const current = await appStore.getRecovery(organizationId, created.id);
    await appStore.decidePublication({
      context: planApprover,
      recoveryId: created.id,
      decision: PublicationDecision.APPROVE,
      comment: 'Attempting publication approval after approving the treatment plan.',
      expectedVersion: current.version,
    });
  } catch (error) {
    separationBlocked = /Separation of duties/i.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!separationBlocked)
    throw new Error('Separation of duties did not block the treatment-plan approver.');

  const firstPublisher = {
    ...serviceContext,
    actorId: 'publisher-one',
    actorType: ActorType.USER,
    actorRoles: [ActorRole.INCIDENT_COMMANDER],
    requestId: randomUUID(),
  };
  const secondPublisher = {
    ...serviceContext,
    actorId: 'publisher-two',
    actorType: ActorType.USER,
    actorRoles: [ActorRole.ORGANIZATION_ADMIN],
    requestId: randomUUID(),
  };
  let current = await appStore.getRecovery(organizationId, created.id);
  const partial = await appStore.decidePublication({
    context: firstPublisher,
    recoveryId: created.id,
    decision: PublicationDecision.APPROVE,
    comment: 'First independent publication approval after full evidence review.',
    expectedVersion: current.version,
  });
  if (partial.status !== RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL)
    throw new Error('First approval crossed a two-person threshold.');
  current = await appStore.getRecovery(organizationId, created.id);
  const approved = await appStore.decidePublication({
    context: secondPublisher,
    recoveryId: created.id,
    decision: PublicationDecision.APPROVE,
    comment: 'Second independent publication approval after full evidence review.',
    expectedVersion: current.version,
  });
  if (approved.status !== RecoveryRunStatus.READY_TO_PUBLISH)
    throw new Error('Publication approval threshold was not persisted.');

  let immutablePatch = false;
  try {
    await withTransaction(
      (client) =>
        client.query(`UPDATE "RecoveryPatchVersion" SET "unifiedDiff"='tampered' WHERE "id"=$1`, [
          patchId,
        ]),
      { tenantOrganizationId: organizationId },
      appPool,
    );
  } catch {
    immutablePatch = true;
  }
  if (!immutablePatch) throw new Error('Immutable patch accepted an update.');

  const events = await appStore.listEvents(organizationId, created.id, 0, 500);
  console.log(
    JSON.stringify({
      status: 'passed',
      recoveryId: created.id,
      idempotency: created.id === replayed.id,
      tenantIsolation: crossTenantBlocked,
      leaseFencing: true,
      separationOfDuties: separationBlocked,
      publicationThreshold: approved.status,
      immutablePatch,
      events: events.length,
    }),
  );
} finally {
  await Promise.all([appPool.end(), workerPool.end()]);
}
