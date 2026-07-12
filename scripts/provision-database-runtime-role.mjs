import { Pool } from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUser = process.env.DATABASE_RUNTIME_USER ?? 'codeer_app';
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD;

if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
if (!runtimePassword || runtimePassword.length < 16) {
  throw new Error('DATABASE_RUNTIME_PASSWORD must contain at least 16 characters');
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeUser)) {
  throw new Error('DATABASE_RUNTIME_USER contains unsupported characters');
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const pool = new Pool({
  connectionString: adminUrl,
  max: 1,
  application_name: 'codeer-database-provisioner',
});
const client = await pool.connect();

try {
  const databaseResult = await client.query('SELECT current_database() AS name');
  const databaseName = databaseResult.rows[0]?.name;
  if (!databaseName) throw new Error('Unable to resolve the current database name');

  const role = quoteIdentifier(runtimeUser);
  const password = quoteLiteral(runtimePassword);
  const database = quoteIdentifier(String(databaseName));

  await client.query('BEGIN');
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [runtimeUser]);
  if (existing.rowCount === 0) {
    await client.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  }
  await client.query(
    `ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${password}`,
  );
  await client.query(`ALTER ROLE ${role} SET statement_timeout = '15s'`);
  await client.query(`ALTER ROLE ${role} SET lock_timeout = '5s'`);
  await client.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '30s'`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  );
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
  );
  await client.query('COMMIT');

  console.log(`Provisioned non-superuser runtime database role ${runtimeUser}.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
