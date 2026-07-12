import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');

const migrationUrl = new URL(
  '../packages/database/prisma/migrations/20260712000100_sprint3_enterprise_incident_engine/migration.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: 'codeer-ci-migrate',
});

try {
  const existing = await pool.query(`SELECT to_regclass('public."Incident"') AS "incidentTable"`);
  if (existing.rows[0]?.incidentTable) {
    console.log('Sprint 3 incident schema already exists; migration smoke step skipped.');
  } else {
    await pool.query(sql);
    console.log('Sprint 3 enterprise incident migration applied.');
  }
} finally {
  await pool.end();
}
