import 'dotenv/config';
import { Pool } from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_WORKER_URL;
const appUser = process.env.DATABASE_RUNTIME_USER ?? 'codeer_app';
const workerUser = process.env.DATABASE_WORKER_USER ?? 'codeer_worker';
const workerGroup = 'codeer_worker_bypass';

if (!adminUrl || !appUrl || !workerUrl) {
  throw new Error('DATABASE_ADMIN_URL, DATABASE_URL and DATABASE_WORKER_URL are required.');
}

const admin = new Pool({
  connectionString: adminUrl,
  max: 1,
  application_name: 'role-boundary-admin',
});
const app = new Pool({ connectionString: appUrl, max: 1, application_name: 'role-boundary-api' });
const worker = new Pool({
  connectionString: workerUrl,
  max: 1,
  application_name: 'role-boundary-worker',
});

try {
  const roles = await admin.query(
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin
       FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [[appUser, workerUser, workerGroup]],
  );
  if (roles.rowCount !== 3) throw new Error('Expected API, worker and worker-capability roles.');
  for (const role of roles.rows) {
    if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls) {
      throw new Error(`Unsafe database privilege detected on ${role.rolname}.`);
    }
  }
  const group = roles.rows.find((entry) => entry.rolname === workerGroup);
  if (!group || group.rolcanlogin) throw new Error('Worker capability role must be NOLOGIN.');

  const appClient = await app.connect();
  const workerClient = await worker.connect();
  try {
    const appIdentity = await appClient.query(
      `SELECT current_user AS user,
              pg_has_role(current_user, $1, 'member') AS member,
              set_config('app.codeer_worker_bypass','true',true) AS setting,
              codeer_worker_bypass_rls() AS bypass`,
      [workerGroup],
    );
    if (
      appIdentity.rows[0]?.user !== appUser ||
      appIdentity.rows[0]?.member ||
      appIdentity.rows[0]?.bypass
    ) {
      throw new Error('API role obtained worker RLS bypass capability.');
    }

    const workerWithoutSetting = await workerClient.query(
      `SELECT current_user AS user,
              pg_has_role(current_user, $1, 'member') AS member,
              codeer_worker_bypass_rls() AS bypass`,
      [workerGroup],
    );
    if (
      workerWithoutSetting.rows[0]?.user !== workerUser ||
      !workerWithoutSetting.rows[0]?.member ||
      workerWithoutSetting.rows[0]?.bypass
    ) {
      throw new Error('Worker capability must require an explicit transaction-local setting.');
    }
    await workerClient.query('BEGIN');
    await workerClient.query(`SELECT set_config('app.codeer_worker_bypass','true',true)`);
    const workerWithSetting = await workerClient.query(
      `SELECT codeer_worker_bypass_rls() AS bypass`,
    );
    await workerClient.query('ROLLBACK');
    if (!workerWithSetting.rows[0]?.bypass) {
      throw new Error('Worker role could not activate its guarded RLS capability.');
    }
  } finally {
    appClient.release();
    workerClient.release();
  }

  const recoveryTables = [
    'OrganizationRecoveryPolicy',
    'RecoveryRun',
    'RecoveryCheckpoint',
    'RecoveryEvent',
    'RecoveryWorktree',
    'RecoveryAgentRun',
    'RecoveryPatchVersion',
    'RecoveryPatchFile',
    'RecoveryPatchHunk',
    'RecoveryPatchPolicyDecision',
    'RecoverySecurityReview',
    'RecoveryVerificationRun',
    'RecoveryVerificationCheck',
    'RecoveryPublicationApproval',
    'RecoveryPullRequestPackage',
    'RecoveryCleanupRecord',
  ];
  const rls = await admin.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,
    [recoveryTables],
  );
  if (rls.rowCount !== recoveryTables.length) {
    throw new Error('One or more controlled-recovery tables are missing.');
  }
  for (const table of rls.rows) {
    if (!table.relrowsecurity || !table.relforcerowsecurity) {
      throw new Error(`Controlled-recovery table ${table.relname} does not force RLS.`);
    }
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      apiRole: appUser,
      workerRole: workerUser,
      capabilityRole: workerGroup,
      apiBypass: false,
      workerRequiresExplicitSetting: true,
      recoveryTablesForcedRls: recoveryTables.length,
    }),
  );
} finally {
  await Promise.all([admin.end(), app.end(), worker.end()]);
}
