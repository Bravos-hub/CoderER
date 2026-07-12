import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  ActorRole,
  ActorType,
  CitationSourceType,
  HypothesisDisposition,
  InvestigationStatus,
  PlanApprovalDecision,
  RiskLevel,
  TreatmentPlanStatus,
} from '@codeer/contracts';
import { buildInvestigationContext, defaultAiPolicy } from '@codeer/ai';
import {
  createDatabasePool,
  InvestigationStore,
  TenantResourceNotFoundError,
  withTransaction,
} from '@codeer/database';
import { sha256Hex } from '@codeer/security';

const appUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_WORKER_URL;
if (!appUrl || !workerUrl) throw new Error('DATABASE_URL and DATABASE_WORKER_URL are required.');

const appPool = createDatabasePool(appUrl, { max: 4, application_name: 'investigation-smoke-api' });
const workerPool = createDatabasePool(workerUrl, {
  max: 4,
  application_name: 'investigation-smoke-worker',
});
const appStore = new InvestigationStore(appPool);
const workerStore = new InvestigationStore(workerPool);
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const repositoryId = randomUUID();
const intakeId = randomUUID();
const worktreeId = randomUUID();
const incidentId = randomUUID();
const executionId = randomUUID();
const reproductionId = randomUUID();
const workerId = `investigation-smoke-${randomUUID()}`;
const context = {
  organizationId,
  actorId: 'ci-investigation-smoke',
  actorType: ActorType.SERVICE,
  actorRoles: [ActorRole.SERVICE],
  requestId: `request-${randomUUID()}`,
  correlationId: `correlation-${randomUUID()}`,
};
const evidenceText = 'npm error Missing script: build:super';
const evidenceDigest = sha256Hex(evidenceText);
const sourceId = randomUUID();
const citation = {
  sourceType: CitationSourceType.REPRODUCTION,
  sourceId,
  digest: evidenceDigest,
  label: 'Verified reproduction result',
};
const policy = defaultAiPolicy(['gpt-5.6']);

try {
  await withTransaction(
    async (client) => {
      await client.query(
        `INSERT INTO "Organization" ("id","slug","name","createdAt","updatedAt")
         VALUES ($1,$2,$3,NOW(),NOW())`,
        [
          organizationId,
          `investigation-${organizationId.slice(0, 8)}`,
          'Investigation Persistence Smoke',
        ],
      );
      await client.query(
        `INSERT INTO "Repository" (
          "id","organizationId","provider","providerRepoId","owner","name","fullName",
          "visibility","defaultBranch","cloneUrl","htmlUrl","createdAt","updatedAt"
        ) VALUES ($1,$2,'GITHUB',$3,'codeer-ci','investigation-fixture','codeer-ci/investigation-fixture',
          'PRIVATE','main','https://github.com/codeer-ci/investigation-fixture.git',
          'https://github.com/codeer-ci/investigation-fixture',NOW(),NOW())`,
        [repositoryId, organizationId, randomUUID()],
      );
      await client.query(
        `INSERT INTO "RepositoryIntake" (
          "id","organizationId","repositoryId","requestedBy","requestedUrl","selectedBaseBranch",
          "status","progress","requestId","requestedAt","completedAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,'https://github.com/codeer-ci/investigation-fixture','main',
          'READY',100,$5,NOW(),NOW(),NOW())`,
        [intakeId, organizationId, repositoryId, context.actorId, context.requestId],
      );
      await client.query(
        `INSERT INTO "RepositoryWorktree" (
          "id","repositoryId","intakeId","branchName","baseBranch","baseSha","relativePath","status","createdAt"
        ) VALUES ($1,$2,$3,'codeer/recovery/investigation-smoke','main',$4,'investigation-fixture','ACTIVE',NOW())`,
        [worktreeId, repositoryId, intakeId, 'a'.repeat(40)],
      );
      await client.query(
        `INSERT INTO "Incident" (
          "id","organizationId","repositoryId","shortCode","title","description","severity",
          "severityScore","severityReason","status","stage","source","labels","version","reportedAt",
          "lastActivityAt","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,'Investigation smoke','Deterministic AI persistence smoke','SEV-3',
          55,'Verified build failure','INVESTIGATING','DIAGNOSE','MANUAL',ARRAY['ci-smoke'],1,NOW(),NOW(),NOW(),NOW())`,
        [incidentId, organizationId, repositoryId, `ER-${Date.now()}`],
      );
      await client.query(
        `INSERT INTO "SandboxExecution" (
          "id","organizationId","incidentId","worktreeId","status","result","image",
          "environmentFingerprint","startedAt","completedAt","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,'COMPLETED','REPRODUCED','node:24-bookworm-slim',$5,NOW(),NOW(),NOW(),NOW())`,
        [executionId, organizationId, incidentId, worktreeId, sha256Hex('environment')],
      );
      await client.query(
        `INSERT INTO "FailureReproduction" (
          "id","organizationId","incidentId","executionId","input","status","result",
          "originalFailureSignature","observedFailureSignature","signatureComparison","confidence",
          "environmentFingerprint","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5::jsonb,'COMPLETED','REPRODUCED',$6::jsonb,$7::jsonb,$8::jsonb,0.98,$9,NOW(),NOW())`,
        [
          reproductionId,
          organizationId,
          incidentId,
          executionId,
          JSON.stringify({
            reproductionCommands: [{ executable: 'npm', arguments: ['run', 'build:super'] }],
          }),
          JSON.stringify({
            normalized: evidenceText,
            digest: evidenceDigest,
            tokens: ['npm', 'missing', 'script'],
          }),
          JSON.stringify({
            normalized: evidenceText,
            digest: evidenceDigest,
            tokens: ['npm', 'missing', 'script'],
          }),
          JSON.stringify({ matched: true, similarity: 1, rationale: 'Exact deterministic match' }),
          sha256Hex('environment'),
        ],
      );
    },
    { tenantOrganizationId: organizationId },
    appPool,
  );

  const idempotencyKey = `investigation-${randomUUID()}`;
  const createCommand = {
    context,
    incidentId,
    input: {
      reproductionId,
      focusAreas: ['build configuration'],
      additionalContext:
        'Investigate the verified build failure without modifying repository state.',
    },
    policy,
    idempotencyKey,
    idempotencyTtlSeconds: 3600,
  };
  const created = await appStore.createInvestigation(createCommand);
  const replayed = await appStore.createInvestigation(createCommand);
  if (created.id !== replayed.id) throw new Error('Investigation idempotency failed.');

  const unscoped = await appPool.query(
    `SELECT COUNT(*)::int AS count FROM "InvestigationRun" WHERE "id"=$1`,
    [created.id],
  );
  if (unscoped.rows[0]?.count !== 0)
    throw new Error('Forced RLS leaked an investigation without tenant context.');

  let crossTenantBlocked = false;
  try {
    await appStore.getInvestigation(otherOrganizationId, created.id);
  } catch (error) {
    crossTenantBlocked = error instanceof TenantResourceNotFoundError;
  }
  if (!crossTenantBlocked) throw new Error('Cross-tenant investigation access was not blocked.');

  const envelope = await workerStore.acquireLease(created.id, workerId, 90);
  if (!envelope) throw new Error('Worker could not acquire the investigation lease.');
  const duplicateLease = await workerStore.acquireLease(created.id, `${workerId}-other`, 90);
  if (duplicateLease !== null)
    throw new Error('A second worker acquired an active investigation lease.');

  await workerStore.checkpoint(
    organizationId,
    created.id,
    workerId,
    InvestigationStatus.POLICY_CHECK,
    { policyVersion: policy.policyVersion },
    'POLICY_CHECK_COMPLETED',
  );
  await workerStore.checkpoint(
    organizationId,
    created.id,
    workerId,
    InvestigationStatus.CONTEXT_BUILDING,
    { sourceCount: 1 },
    'CONTEXT_BUILDING_STARTED',
  );
  const committedContext = buildInvestigationContext(
    [
      {
        sourceType: CitationSourceType.REPRODUCTION,
        sourceId,
        label: citation.label,
        digest: evidenceDigest,
        content: evidenceText,
      },
    ],
    { maximumItems: 20, maximumBytes: 100_000, maximumItemBytes: 50_000 },
  );
  await workerStore.recordContextPackage(
    organizationId,
    created.id,
    workerId,
    committedContext,
    30,
  );

  for (const [status, eventType] of [
    [InvestigationStatus.TRIAGE, 'TRIAGE_STARTED'],
    [InvestigationStatus.MAPPING, 'MAPPING_STARTED'],
    [InvestigationStatus.HYPOTHESIS, 'HYPOTHESIS_STARTED'],
    [InvestigationStatus.VALIDATION, 'VALIDATION_STARTED'],
    [InvestigationStatus.SECURITY_REVIEW, 'SECURITY_REVIEW_STARTED'],
    [InvestigationStatus.PLAN_COMPOSITION, 'PLAN_COMPOSITION_STARTED'],
    [InvestigationStatus.CRITIC_REVIEW, 'CRITIC_REVIEW_STARTED'],
  ]) {
    await workerStore.checkpoint(
      organizationId,
      created.id,
      workerId,
      status,
      { completed: true },
      eventType,
    );
  }

  const diagnosisId = randomUUID();
  const diagnosis = {
    id: diagnosisId,
    investigationId: created.id,
    summary: 'The deployment requests a build script that is absent from the repository manifest.',
    failureMechanism:
      'npm resolves scripts from package.json and exits because build:super is not defined.',
    blastRadius: 'The production build pipeline cannot produce a deployable artifact.',
    securityImpact: 'No direct security exposure was observed in the committed evidence.',
    confidence: 0.98,
    confidenceBand: 'HIGH',
    hypotheses: [
      {
        id: randomUUID(),
        disposition: HypothesisDisposition.PRIMARY,
        title: 'Missing build script',
        mechanism:
          'The build pipeline invokes build:super while the manifest does not define that script.',
        confidence: 0.98,
        supportingEvidence: [citation],
        contradictingEvidence: [],
        missingEvidence: [],
        assumptions: [],
      },
    ],
    unknowns: [],
    citations: [citation],
    schemaVersion: 'codeer-diagnosis-v1',
    contentHash: sha256Hex('investigation-smoke-diagnosis'),
    createdAt: new Date().toISOString(),
  };
  const plan = {
    id: randomUUID(),
    investigationId: created.id,
    diagnosisId,
    version: 1,
    status: TreatmentPlanStatus.AWAITING_APPROVAL,
    goal: 'Restore the build using the smallest reversible manifest or pipeline correction.',
    risk: RiskLevel.LOW,
    steps: [
      {
        sequence: 1,
        title: 'Align the build entry point',
        objective:
          'Use the supported build script or define the intended script without unrelated refactoring.',
        affectedComponents: ['package.json'],
        scopeRestrictions: ['Do not modify runtime application behavior.'],
        risk: RiskLevel.LOW,
        securityConsiderations: [],
        verificationCommands: [],
        expectedResults: ['The original missing-script failure is absent.'],
        rollbackProcedure: 'Revert the approved package manifest or pipeline change.',
        citations: [citation],
      },
    ],
    verificationMatrix: [
      { requirement: 'Build passes', evidenceRequired: 'Isolated build log', mandatory: true },
    ],
    rollbackStrategy: 'Revert the single approved change and rerun the original reproduction.',
    compatibilityImpact: 'No public API compatibility impact is expected.',
    migrationImpact: 'No data migration is required.',
    knownLimitations: [],
    requiredApprovals: 2,
    schemaVersion: 'codeer-treatment-plan-v1',
    contentHash: sha256Hex('investigation-smoke-plan'),
    createdAt: new Date().toISOString(),
  };
  await workerStore.saveDiagnosisAndPlan({
    organizationId,
    investigationId: created.id,
    workerId,
    diagnosis,
    plan,
  });

  const storedDiagnosis = await appStore.getDiagnosis(organizationId, created.id);
  if (!storedDiagnosis || storedDiagnosis.contentHash !== diagnosis.contentHash)
    throw new Error('Diagnosis provenance was not persisted.');
  const plans = await appStore.listTreatmentPlans(organizationId, created.id);
  if (plans[0]?.status !== TreatmentPlanStatus.AWAITING_APPROVAL)
    throw new Error('Treatment plan did not await human approval.');

  const firstApproverContext = {
    ...context,
    actorId: 'incident-commander-one',
    actorType: ActorType.USER,
    actorRoles: [ActorRole.INCIDENT_COMMANDER],
    requestId: `request-${randomUUID()}`,
  };
  const secondApproverContext = {
    ...context,
    actorId: 'organization-admin-two',
    actorType: ActorType.USER,
    actorRoles: [ActorRole.ORGANIZATION_ADMIN],
    requestId: `request-${randomUUID()}`,
  };
  const partiallyApproved = await appStore.decideTreatmentPlan({
    context: firstApproverContext,
    planId: plan.id,
    decision: PlanApprovalDecision.APPROVE,
    comment:
      'First approval after reviewing the evidence citations, risk scope, verification, and rollback procedure.',
    expectedVersion: 1,
  });
  if (partiallyApproved.status !== TreatmentPlanStatus.AWAITING_APPROVAL) {
    throw new Error('Treatment plan ignored the configured approval threshold.');
  }
  const replayedApproval = await appStore.decideTreatmentPlan({
    context: firstApproverContext,
    planId: plan.id,
    decision: PlanApprovalDecision.APPROVE,
    comment: 'Idempotent retry of the first approval.',
    expectedVersion: 1,
  });
  if (replayedApproval.status !== TreatmentPlanStatus.AWAITING_APPROVAL) {
    throw new Error('Duplicate approver unexpectedly crossed the approval threshold.');
  }
  const approved = await appStore.decideTreatmentPlan({
    context: secondApproverContext,
    planId: plan.id,
    decision: PlanApprovalDecision.APPROVE,
    comment: 'Second independent approval after reviewing the complete plan and rollback evidence.',
    expectedVersion: 1,
  });
  if (approved.status !== TreatmentPlanStatus.APPROVED)
    throw new Error('Treatment plan approval threshold was not persisted.');
  const finalRun = await appStore.getInvestigation(organizationId, created.id);
  if (finalRun.status !== InvestigationStatus.APPROVED)
    throw new Error('Investigation did not reach APPROVED.');

  let immutableDiagnosis = false;
  try {
    await withTransaction(
      (client) =>
        client.query(`UPDATE "Diagnosis" SET "summary"='tampered' WHERE "id"=$1`, [diagnosis.id]),
      { tenantOrganizationId: organizationId },
      appPool,
    );
  } catch {
    immutableDiagnosis = true;
  }
  if (!immutableDiagnosis) throw new Error('Immutable diagnosis accepted an update.');

  const events = await appStore.listEvents(organizationId, created.id, 0, 500);
  if (events.length < 10) throw new Error('Investigation lifecycle events are incomplete.');

  console.log(
    JSON.stringify({
      status: 'passed',
      investigationId: created.id,
      idempotency: created.id === replayed.id,
      tenantIsolation: crossTenantBlocked,
      leaseFencing: true,
      immutableDiagnosis,
      events: events.length,
      finalStatus: finalRun.status,
      planStatus: approved.status,
    }),
  );
} finally {
  await Promise.all([appPool.end(), workerPool.end()]);
}
