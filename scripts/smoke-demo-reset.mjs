import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

/**
 * Integration proof for the deterministic demo reset: reset runs twice with
 * the same final state, unrelated tenant rows survive, and the seeded slice
 * passes the full demo verification afterwards.
 */

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required.');

const env = {
  ...process.env,
  DATABASE_ADMIN_URL: adminUrl,
  CODEER_DEMO_RESET_ENABLED: 'true',
  CODEER_DEMO_RESET_CONFIRMATION: 'RESET-COMPETITION-DEMO',
};
const CANARY_ORG = '11111111-1111-4111-8111-111111111111';

const pool = new Pool({ connectionString: adminUrl, max: 1 });

async function demoOrgCounts(client) {
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM "Incident") AS incidents,
       (SELECT count(*) FROM "IncidentEvent") AS events,
       (SELECT count(*) FROM "Evidence") AS evidence,
       (SELECT count(*) FROM "PublicationRun") AS publications,
       (SELECT count(*) FROM "Organization") AS organizations`,
  );
  return result.rows[0];
}

const client = await pool.connect();
try {
  // Remove any canary left by a previously interrupted run.
  await client.query(`DELETE FROM "Organization" WHERE "id"=$1`, [CANARY_ORG]);

  console.log('==> reset run 1');
  execFileSync('npm', ['run', 'demo:reset'], { env, stdio: 'pipe' });
  const first = await demoOrgCounts(client);

  await client.query(
    `INSERT INTO "Organization" ("id","slug","name","createdAt","updatedAt")
     VALUES ($1,'smoke-canary-tenant','Smoke Canary Tenant',NOW(),NOW())
     ON CONFLICT ("id") DO NOTHING`,
    [CANARY_ORG],
  );

  console.log('==> reset run 2 (must be idempotent)');
  execFileSync('npm', ['run', 'demo:reset'], { env, stdio: 'pipe' });
  const second = await demoOrgCounts(client);

  const same = ['incidents', 'events', 'evidence', 'publications'].every(
    (key) => String(first[key]) === String(second[key]),
  );
  if (!same) {
    console.error('FAIL reset is not idempotent', { first, second });
    process.exit(1);
  }
  console.log('ok   reset is idempotent across two runs');

  const canary = await client.query(`SELECT count(*) AS count FROM "Organization" WHERE "id"=$1`, [
    CANARY_ORG,
  ]);
  if (String(canary.rows[0].count) !== '1') {
    console.error('FAIL unrelated tenant row was removed by demo:reset');
    process.exit(1);
  }
  console.log('ok   unrelated tenant rows survive demo:reset');
  if (BigInt(second.organizations) !== BigInt(first.organizations) + 1n) {
    console.error('FAIL unexpected organization count drift', { first, second });
    process.exit(1);
  }

  await client.query(`DELETE FROM "Organization" WHERE "id"=$1`, [CANARY_ORG]);
  console.log('ok   canary tenant cleaned up');
} finally {
  client.release();
  await pool.end();
}

console.log('==> full demo verification');
execFileSync('npm', ['run', 'demo:verify'], { env, stdio: 'inherit' });
console.log('Demo reset integration smoke passed.');
