import { randomUUID } from 'node:crypto';
import {
  ActorRole,
  ActorType,
  EvidenceKind,
  EvidenceSensitivity,
  EvidenceSource,
  IncidentStatus,
} from '@codeer/contracts';
import {
  createDatabasePool,
  IncidentStore,
  TenantResourceNotFoundError,
  withTransaction,
} from '@codeer/database';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = createDatabasePool(databaseUrl, {
  max: 4,
  application_name: 'codeer-incident-smoke',
});
const store = new IncidentStore(pool);
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const repositoryId = randomUUID();
const actorId = 'ci-incident-smoke';
const context = {
  organizationId,
  actorId,
  actorType: ActorType.SERVICE,
  actorRoles: [ActorRole.SERVICE],
  requestId: `smoke-${randomUUID()}`,
  correlationId: `smoke-${randomUUID()}`,
};
const input = {
  repositoryId,
  title: 'Production build blocked by workspace contract failure',
  description: 'The production build cannot resolve a required workspace package.',
  source: 'MONITORING',
  labels: ['ci-smoke', 'build'],
  impact: {
    availability: 2,
    affectedUsers: 1_000,
    revenueImpact: 1,
    dataIntegrity: 0,
    securityImpact: 0,
    environment: 'production',
  },
  signals: {
    errorMessage: 'Missing workspace package. Authorization header contained a secret value.',
    failingCommand: 'npm run build',
    deploymentBlocked: true,
    failingTests: true,
    securityExposure: false,
    dataIntegrityRisk: false,
    productionUnavailable: false,
    authenticationBroken: false,
    dependencyIssue: true,
    apiContractMismatch: false,
    frontendFunctionalityFailure: false,
    workaroundAvailable: false,
    recurrenceCount: 2,
  },
};

try {
  await withTransaction(
    async (client) => {
      await client.query(
        `INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [organizationId, `ci-${organizationId.slice(0, 8)}`, 'CI Incident Engine'],
      );
      await client.query(
        `INSERT INTO "Repository" (
           "id", "organizationId", "provider", "providerRepoId", "owner", "name", "fullName",
           "visibility", "defaultBranch", "cloneUrl", "htmlUrl", "createdAt", "updatedAt"
         ) VALUES ($1, $2, 'GITHUB', $3, 'codeer-ci', 'incident-fixture', 'codeer-ci/incident-fixture',
           'PRIVATE', 'main', 'https://github.com/codeer-ci/incident-fixture.git',
           'https://github.com/codeer-ci/incident-fixture', NOW(), NOW())`,
        [repositoryId, organizationId, randomUUID()],
      );
    },
    { tenantOrganizationId: organizationId },
    pool,
  );

  const idempotencyKey = `incident-smoke-${randomUUID()}`;
  const createCommand = {
    context,
    input,
    idempotencyKey,
    idempotencyTtlSeconds: 3_600,
    organizationDefaults: {
      id: organizationId,
      slug: `ci-${organizationId.slice(0, 8)}`,
      name: 'CI Incident Engine',
    },
  };
  const created = await store.createIncident(createCommand);
  const replayed = await store.createIncident(createCommand);
  if (created.id !== replayed.id) throw new Error('Idempotent create returned another incident');
  if (created.status !== IncidentStatus.ADMITTED) throw new Error('Incident was not admitted');

  const unscopedIncidentCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM "Incident" WHERE "id" = $1`,
    [created.id],
  );
  if (unscopedIncidentCount.rows[0]?.count !== 0) {
    throw new Error('Forced row-level security leaked an incident without tenant context');
  }

  let crossTenantBlocked = false;
  try {
    await store.getIncidentDetail(otherOrganizationId, created.id);
  } catch (error) {
    crossTenantBlocked = error instanceof TenantResourceNotFoundError;
  }
  if (!crossTenantBlocked) throw new Error('Cross-tenant incident lookup was not blocked');

  const evidence = await store.addEvidence(context, created.id, {
    kind: EvidenceKind.LOG,
    source: EvidenceSource.CI,
    sensitivity: EvidenceSensitivity.INTERNAL,
    title: 'CI build log',
    summary: 'Build output captured by the integration smoke test.',
    payload: {
      authorization: 'sensitive credential value',
      output: 'workspace package missing',
    },
  });
  if (!evidence.redacted || JSON.stringify(evidence.payload).includes('credential value')) {
    throw new Error('Evidence secret redaction failed');
  }

  const claimed = await store.claimOutboxBatch('ci-outbox-smoke', 10, 60_000);
  const triageMessage = claimed.find(
    (message) =>
      message.partitionKey === created.id && message.topic === 'incident.triage.requested',
  );
  if (!triageMessage) throw new Error('Transactional outbox did not expose the triage request');
  await store.markOutboxPublished(triageMessage.id);

  const triage = await store.processTriage({
    incidentId: created.id,
    organizationId,
    requestedAt: new Date().toISOString(),
    requestedBy: actorId,
    requestId: context.requestId,
    correlationId: context.correlationId,
    signals: input.signals,
    attempt: 1,
  });
  if (triage.status !== IncidentStatus.INVESTIGATING) throw new Error('Triage did not complete');

  const detail = await store.getIncidentDetail(organizationId, created.id);
  if (!detail.timelineIntegrity.valid) {
    throw new Error(detail.timelineIntegrity.reason ?? 'Invalid timeline');
  }
  if (detail.timeline.length < 7) {
    throw new Error('Expected incident timeline events were not recorded');
  }
  if (!detail.latestHealthSnapshot) {
    throw new Error('Repository health snapshot was not recorded');
  }
  if (detail.evidence.length < 2) {
    throw new Error('Expected evidence records were not persisted');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      incidentId: created.id,
      events: detail.timeline.length,
      evidence: detail.evidence.length,
      health: detail.latestHealthSnapshot.overallScore,
      integrity: detail.timelineIntegrity.valid,
      idempotency: created.id === replayed.id,
      tenantIsolation: crossTenantBlocked,
      outbox: triageMessage.topic,
    }),
  );
} finally {
  await pool.end();
}
