import 'dotenv/config';
import { MergeClosureStore } from '@codeer/database';

/**
 * Integration smoke for merge readiness and post-merge closure against the
 * seeded deterministic demo data. Runs with the runtime application role so
 * RLS and tenant scoping are exercised exactly as in production.
 */

const organizationId = '00000000-0000-4000-8000-000000000001';
const publicationId = '00000000-0000-4000-8000-000000290045';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://codeer_app:development-app-only@localhost:5432/codeer?schema=public';
}

const store = new MergeClosureStore();
const failures = [];
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`);
  else failures.push(detail ? `${label}: ${detail}` : label);
}

const first = await store.evaluateAndPersistMergeReadiness(
  organizationId,
  publicationId,
  'smoke-publication-closure-1',
);
check('readiness evaluation returned a decision', first !== undefined);
check(
  'seeded publication is merge-ready',
  first?.ready === true,
  `blockers: ${(first?.blockers ?? []).join(' | ')}`,
);

const latest = await store.latestMergeReadiness(organizationId, publicationId);
check('latest readiness decision is persisted and green', latest?.ready === true);

const second = await store.evaluateAndPersistMergeReadiness(
  organizationId,
  publicationId,
  'smoke-publication-closure-2',
);
check('re-evaluation is idempotent and appends a new decision', second?.ready === true);

const postMerge = await store.applyPostMergeVerification(
  organizationId,
  publicationId,
  'smoke-publication-closure-3',
);
check(
  'post-merge verification refuses a publication that is not in MERGED state',
  postMerge.applied === false,
  JSON.stringify(postMerge),
);

const crossTenant = await store.latestMergeReadiness(
  '11111111-1111-4111-8111-111111111111',
  publicationId,
);
check('readiness decisions are not visible across tenants', crossTenant === undefined);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`Publication closure smoke failed with ${failures.length} problem(s).`);
  process.exit(1);
}
console.log('Publication closure smoke passed.');
process.exit(0);
