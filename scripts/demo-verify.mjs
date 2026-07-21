import 'dotenv/config';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const FROZEN_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const FROZEN_INCIDENT_ID = '00000000-0000-4000-8000-000000290004';
const FROZEN_REPOSITORY_PROVIDER_ID = 'codeer-demo-primary-incident';
const FROZEN_EXTERNAL_REFERENCE = 'competition-closeout-primary-demo-2026-07-19';
const SEEDED_EVIDENCE_MODE = 'SEEDED_DETERMINISTIC_REPLAY';

const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required.');

const demoRepositoryPath = path.join(
  path.resolve(process.env.CODEER_DEMO_REPOSITORY_ROOT ?? '/tmp/codeer-demo-repositories'),
  'primary',
);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digestPayload(value) {
  return sha256(canonicalJson(value));
}

function incidentEventHash(input) {
  return digestPayload({
    actorId: input.actorId ?? null,
    actorType: input.actorType,
    causationId: input.causationId ?? null,
    correlationId: input.correlationId ?? null,
    incidentId: input.incidentId,
    occurredAt: input.occurredAt,
    payload: input.payload,
    previousHash: input.previousHash ?? null,
    requestId: input.requestId ?? null,
    sequence: input.sequence,
    type: input.type,
  });
}

/** Collects real http(s) URLs whose host is github.com (or a subdomain). */
function findGithubUrls(value, found = []) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      try {
        const host = new URL(match[0]).hostname;
        if (host === 'github.com' || host.endsWith('.github.com')) found.push(match[0]);
      } catch {
        // Not a parseable URL; ignore.
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) findGithubUrls(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) findGithubUrls(item, found);
  }
  return found;
}

const failures = [];
const passes = [];

function check(label, condition, detail) {
  if (condition) {
    passes.push(label);
  } else {
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [
    FROZEN_ORGANIZATION_ID,
  ]);

  // 1. Frozen organization and repository.
  const org = await client.query(`SELECT "id" FROM "Organization" WHERE "id" = $1`, [
    FROZEN_ORGANIZATION_ID,
  ]);
  check('frozen demo organization exists', org.rowCount === 1);

  const repo = await client.query(
    `SELECT "id", "htmlUrl" FROM "Repository"
     WHERE "organizationId" = $1 AND "providerRepoId" = $2`,
    [FROZEN_ORGANIZATION_ID, FROZEN_REPOSITORY_PROVIDER_ID],
  );
  check('exactly one frozen demo repository exists', repo.rowCount === 1);
  check(
    'repository links do not reference a temporary branch',
    repo.rowCount === 1 && !repo.rows[0].htmlUrl.includes('/tree/agent/'),
    repo.rows[0]?.htmlUrl,
  );

  // 2. Frozen incident.
  const incident = await client.query(
    `SELECT "id" FROM "Incident"
     WHERE "id" = $1 AND "organizationId" = $2 AND "externalReference" = $3`,
    [FROZEN_INCIDENT_ID, FROZEN_ORGANIZATION_ID, FROZEN_EXTERNAL_REFERENCE],
  );
  check('frozen incident exists for the demo tenant', incident.rowCount === 1);

  // 3. Incident event hash chain.
  const events = await client.query(
    `SELECT "incidentId", "sequence", "type", "payload", "actorType", "actorId",
            "requestId", "correlationId", "causationId", "previousHash", "eventHash", "occurredAt"
     FROM "IncidentEvent" WHERE "incidentId" = $1 ORDER BY "sequence" ASC`,
    [FROZEN_INCIDENT_ID],
  );
  let previousHash = null;
  let chainValid = events.rowCount > 0;
  let chainDetail = '';
  for (const row of events.rows) {
    const occurredAt = new Date(row.occurredAt).toISOString();
    const expected = incidentEventHash({
      incidentId: row.incidentId,
      sequence: row.sequence,
      type: row.type,
      payload: row.payload,
      occurredAt,
      actorType: row.actorType,
      actorId: row.actorId,
      requestId: row.requestId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      previousHash,
    });
    if (row.previousHash !== previousHash || row.eventHash !== expected) {
      chainValid = false;
      chainDetail = `sequence ${row.sequence} (${row.type})`;
      break;
    }
    previousHash = row.eventHash;
  }
  check('incident event hash chain is valid', chainValid, chainDetail);

  // 4. Evidence digests and provenance labels.
  const evidence = await client.query(
    `SELECT "id", "payload", "byteSize", "digest", "organizationId" FROM "Evidence"
     WHERE "incidentId" = $1`,
    [FROZEN_INCIDENT_ID],
  );
  check('demo incident has seeded evidence', evidence.rowCount >= 6, `${evidence.rowCount} rows`);
  const badDigest = evidence.rows.filter(
    (row) =>
      row.digest !== digestPayload(row.payload) ||
      row.byteSize !== Buffer.byteLength(canonicalJson(row.payload), 'utf8'),
  );
  check('evidence digests and byte sizes are valid', badDigest.length === 0, badDigest[0]?.id);
  const unlabelled = evidence.rows.filter(
    (row) => row.payload?.provenance?.evidenceMode !== SEEDED_EVIDENCE_MODE,
  );
  check(
    'all evidence carries the seeded-replay provenance label',
    unlabelled.length === 0,
    unlabelled[0]?.id,
  );
  const foreignEvidence = evidence.rows.filter(
    (row) => row.organizationId !== FROZEN_ORGANIZATION_ID,
  );
  check('evidence rows belong to the demo tenant', foreignEvidence.length === 0);

  // 5. Investigation linkage and seeded model invocation labels.
  const investigation = await client.query(
    `SELECT "id" FROM "InvestigationRun" WHERE "incidentId" = $1`,
    [FROZEN_INCIDENT_ID],
  );
  check('investigation is linked to the incident', investigation.rowCount === 1);
  const invocations = await client.query(
    `SELECT "providerRequestId", "providerResponseId" FROM "ModelInvocation"
     WHERE "organizationId" = $1`,
    [FROZEN_ORGANIZATION_ID],
  );
  const liveLooking = invocations.rows.filter(
    (row) =>
      !String(row.providerRequestId ?? '').startsWith('seeded-replay:') ||
      !String(row.providerResponseId ?? '').startsWith('seeded-replay:'),
  );
  check(
    'no seeded model invocation claims a live provider request id',
    invocations.rowCount > 0 && liveLooking.length === 0,
    liveLooking[0]?.providerRequestId,
  );

  // 6. Treatment plan approved.
  const plan = await client.query(
    `SELECT "id" FROM "TreatmentPlan"
     WHERE "incidentId" = $1 AND "organizationId" = $2 AND "status" = 'APPROVED'`,
    [FROZEN_INCIDENT_ID, FROZEN_ORGANIZATION_ID],
  );
  check('treatment plan is approved', plan.rowCount === 1);

  // 7. Recovery patch digest matches the pull-request package and publication.
  const recovery = await client.query(
    `SELECT "id" FROM "RecoveryRun" WHERE "incidentId" = $1 AND "status" = 'PUBLISHED'`,
    [FROZEN_INCIDENT_ID],
  );
  check('recovery run is published', recovery.rowCount === 1);
  const recoveryId = recovery.rows[0]?.id;
  const patch = await client.query(
    `SELECT "id", "patchDigest" FROM "RecoveryPatchVersion"
     WHERE "recoveryId" = $1 AND "status" = 'ACCEPTED'`,
    [recoveryId],
  );
  check('accepted patch version exists', patch.rowCount === 1);
  const patchDigest = patch.rows[0]?.patchDigest;
  const pkg = await client.query(
    `SELECT "id" FROM "RecoveryPullRequestPackage"
     WHERE "recoveryId" = $1 AND "patchId" = $2`,
    [recoveryId, patch.rows[0]?.id],
  );
  check('pull-request package references the accepted patch', pkg.rowCount === 1);
  const publication = await client.query(
    `SELECT "id", "pullRequestNumber", "pullRequestUrl", "patchDigest"
     FROM "PublicationRun" WHERE "recoveryId" = $1`,
    [recoveryId],
  );
  check('publication exists for the recovery', publication.rowCount === 1);
  check(
    'publication patch digest matches the accepted patch',
    publication.rows[0]?.patchDigest === patchDigest,
  );

  // 8. Verification passed.
  const verification = await client.query(
    `SELECT "id" FROM "RecoveryVerificationRun"
     WHERE "recoveryId" = $1 AND "status" = 'PASSED'`,
    [recoveryId],
  );
  check('independent recovery verification passed', verification.rowCount >= 1);

  // 9. Publication is labelled as a seeded replay, never as live GitHub execution.
  const pub = publication.rows[0] ?? {};
  check(
    'publication carries no external pull-request identity',
    pub.pullRequestNumber === null && pub.pullRequestUrl === null,
    `${pub.pullRequestNumber} ${pub.pullRequestUrl}`,
  );
  const prRecord = await client.query(
    `SELECT "number", "url" FROM "PullRequestRecord" WHERE "publicationId" = $1`,
    [pub.id],
  );
  check(
    'pull-request record uses seeded sentinel identifiers',
    prRecord.rowCount === 1 &&
      prRecord.rows[0].number === 0 &&
      prRecord.rows[0].url.startsWith('seed://'),
    `${prRecord.rows[0]?.number} ${prRecord.rows[0]?.url}`,
  );
  const pubEvents = await client.query(
    `SELECT "payload", "correlationId" FROM "PublicationEvent" WHERE "publicationId" = $1`,
    [pub.id],
  );
  // Provenance labels mark seeded records created by demo-reset. Events
  // appended later by live system behavior (webhook sync, readiness
  // evaluations) are genuinely live and must not carry the seeded label.
  const seededPubEvents = pubEvents.rows.filter(
    (row) => row.correlationId === 'demo-primary-incident-20260719',
  );
  const unlabelledPubEvents = seededPubEvents.filter(
    (row) => row.payload?.provenance?.providerExecution !== false,
  );
  check(
    'seeded publication events carry the seeded-replay provenance label',
    seededPubEvents.length > 0 && unlabelledPubEvents.length === 0,
  );
  const githubUrls = seededPubEvents.flatMap((row) => findGithubUrls(row.payload));
  check('no seeded publication record links to github.com', githubUrls.length === 0, githubUrls[0]);

  // 10. Restored fixture repository exists on disk.
  const fixturePresent = await access(
    path.join(demoRepositoryPath, 'scripts', 'reproduce-failure.mjs'),
  )
    .then(() => true)
    .catch(() => false);
  check('fixture repository is restored under the demo root', fixturePresent, demoRepositoryPath);
} finally {
  client.release();
  await pool.end();
}

for (const label of passes) console.log(`ok   ${label}`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`demo:verify failed with ${failures.length} problem(s).`);
  process.exit(1);
}
console.log(`demo:verify passed (${passes.length} checks).`);
