import { readFile } from 'node:fs/promises';

const schemaPath = 'packages/database/prisma/schema.prisma';
const migrationPath =
  'packages/database/prisma/migrations/20260713000100_sprint6_controlled_recovery/migration.sql';

const tables = [
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

const immutableTables = tables.filter(
  (table) => !['RecoveryRun', 'RecoveryWorktree'].includes(table),
);

const [schema, migration] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(migrationPath, 'utf8'),
]);

const failures = [];
for (const table of tables) {
  if (!new RegExp(`model\\s+${table}\\s+\\{`).test(schema)) {
    failures.push(`Prisma model missing: ${table}`);
  }
  if (!migration.includes(`CREATE TABLE "${table}"`)) {
    failures.push(`Migration table missing: ${table}`);
  }
}

for (const table of immutableTables) {
  if (!migration.includes(`CREATE TRIGGER "${table}_immutable"`)) {
    failures.push(`Immutable trigger missing: ${table}`);
  }
}

const rlsEnableCount = (migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length;
const rlsForceCount = (migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length;
if (rlsEnableCount < 4 || rlsForceCount < 4) {
  failures.push('Recovery migration does not contain the expected forced-RLS setup blocks.');
}

for (const required of [
  'RecoveryRun',
  'RecoveryPatchFile_tenant_policy',
  'RecoveryPatchHunk_tenant_policy',
  'RecoveryVerificationCheck_tenant_policy',
]) {
  if (!migration.includes(required)) failures.push(`RLS policy missing: ${required}`);
}

if (/TODO|FIXME|\.\.\./.test(migration)) {
  failures.push('Recovery migration contains an unfinished marker.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: 'passed',
      models: tables.length,
      migrationTables: tables.length,
      immutableTriggers: immutableTables.length,
      forcedRlsStatements: rlsForceCount,
    },
    null,
    2,
  ),
);
