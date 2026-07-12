import { Pool } from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUser = process.env.DATABASE_RUNTIME_USER ?? 'codeer_app';
const appPassword = process.env.DATABASE_RUNTIME_PASSWORD;
const workerUser = process.env.DATABASE_WORKER_USER ?? 'codeer_worker';
const workerPassword = process.env.DATABASE_WORKER_PASSWORD;
const workerGroup = 'codeer_worker_bypass';

if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
for (const [name, value] of [
  ['DATABASE_RUNTIME_PASSWORD', appPassword],
  ['DATABASE_WORKER_PASSWORD', workerPassword],
]) {
  if (!value || value.length < 16) throw new Error(`${name} must contain at least 16 characters`);
}
for (const value of [appUser, workerUser, workerGroup]) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`Database role contains unsupported characters: ${value}`);
  }
}
if (appUser === workerUser) throw new Error('API and worker database roles must be different');

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const pool = new Pool({
  connectionString: adminUrl,
  max: 1,
  application_name: 'codeer-role-provisioner',
});
const client = await pool.connect();

async function ensureLoginRole(user, password) {
  const role = quoteIdentifier(user);
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [user]);
  if (!existing.rowCount) {
    await client.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  }
  await client.query(
    `ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
  );
  await client.query(`ALTER ROLE ${role} SET statement_timeout='15s'`);
  await client.query(`ALTER ROLE ${role} SET lock_timeout='5s'`);
  await client.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout='30s'`);
}

try {
  const databaseResult = await client.query('SELECT current_database() AS name');
  const databaseName = databaseResult.rows[0]?.name;
  if (!databaseName) throw new Error('Unable to resolve the current database name');
  const database = quoteIdentifier(String(databaseName));
  const appRole = quoteIdentifier(appUser);
  const workerRole = quoteIdentifier(workerUser);
  const groupRole = quoteIdentifier(workerGroup);

  await client.query('BEGIN');
  const groupExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [workerGroup]);
  if (!groupExists.rowCount) {
    await client.query(
      `CREATE ROLE ${groupRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  }
  await ensureLoginRole(appUser, appPassword);
  await ensureLoginRole(workerUser, workerPassword);
  await client.query(`GRANT ${groupRole} TO ${workerRole}`);
  await client.query(`REVOKE ${groupRole} FROM ${appRole}`);

  for (const role of [appRole, workerRole]) {
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
  }
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}, ${workerRole}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appRole}, ${workerRole}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${appRole}, ${workerRole}`,
  );
  await client.query('COMMIT');
  console.log(
    `Provisioned API role ${appUser}, worker role ${workerUser}, and restricted worker capability group.`,
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
