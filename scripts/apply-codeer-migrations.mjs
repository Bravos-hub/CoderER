import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');

const migrations = [
  {
    id: '20260712000100_sprint3_enterprise_incident_engine',
    file: '../packages/database/prisma/migrations/20260712000100_sprint3_enterprise_incident_engine/migration.sql',
    requiredTables: ['Organization', 'Incident', 'IncidentEvent', 'AuditLog', 'OutboxMessage'],
  },
  {
    id: '20260712000200_sprint4_hardened_sandbox',
    file: '../packages/database/prisma/migrations/20260712000200_sprint4_hardened_sandbox/migration.sql',
    requiredTables: [
      'SandboxExecution',
      'FailureReproduction',
      'SandboxPolicySnapshot',
      'SandboxCommand',
      'SandboxLogChunk',
      'SandboxArtifact',
      'SandboxCleanupRecord',
    ],
  },
  {
    id: '20260712000300_sprint5_codex_orchestration',
    file: '../packages/database/prisma/migrations/20260712000300_sprint5_codex_orchestration/migration.sql',
    requiredTables: [
      'OrganizationAiPolicy',
      'PromptTemplateVersion',
      'InvestigationRun',
      'InvestigationCheckpoint',
      'InvestigationEvent',
      'AgentRun',
      'ModelInvocation',
      'InvestigationToolCall',
      'InvestigationContextPackage',
      'InvestigationContextItem',
      'GuardrailDecision',
      'RootCauseHypothesis',
      'Diagnosis',
      'DiagnosisEvidenceLink',
      'TreatmentPlan',
      'TreatmentPlanStep',
      'PlanApproval',
      'AiUsageLedger',
      'EvaluationRun',
    ],
  },
  {
    id: '20260713000100_sprint6_controlled_recovery',
    file: '../packages/database/prisma/migrations/20260713000100_sprint6_controlled_recovery/migration.sql',
    requiredTables: [
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
    ],
  },
  {
    id: '20260713000100_sprint7_publication',
    file: '../packages/database/prisma/migrations/20260713000100_sprint7_publication/migration.sql',
    requiredTables: [
      'GithubInstallation',
      'RepositoryPublicationPolicy',
      'PublicationRun',
      'PublicationEvent',
      'PublishedCommit',
      'PullRequestRecord',
      'PublicationCheck',
      'PublicationReview',
      'PublicationReviewComment',
      'RevisionRequest',
      'MergeReadinessDecision',
      'MergeObservation',
      'PostMergeVerification',
      'IncidentClosureRecord',
      'GithubWebhookDelivery',
    ],
  },
  {
    id: '20260719000100_sprint8_command_center',
    file: '../packages/database/prisma/migrations/20260719000100_sprint8_command_center/migration.sql',
    requiredTables: ['OrganizationSetting'],
  },
  {
    id: '20260721000100_github_webhook_ingestion',
    file: '../packages/database/prisma/migrations/20260721000100_github_webhook_ingestion/migration.sql',
    // Function-only migration: CREATE OR REPLACE is idempotent, and an empty
    // requiredTables list must not trigger the discovered-baseline shortcut.
    alwaysApply: true,
    requiredTables: [],
  },
];

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function existingTables(client, names) {
  const result = await client.query(
    `SELECT relname FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname = ANY($1::text[])`,
    [names],
  );
  return new Set(result.rows.map((row) => String(row.relname)));
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: 'codeer-migration-runner',
});
const client = await pool.connect();

try {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['codeer-enterprise-migrations']);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "CodeerMigration" (
      "id" TEXT PRIMARY KEY,
      "checksum" CHAR(64) NOT NULL,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "executionMs" INTEGER NOT NULL,
      "discoveredBaseline" BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  for (const migration of migrations) {
    const url = new URL(migration.file, import.meta.url);
    const sql = await readFile(url, 'utf8');
    const digest = checksum(sql);
    const recorded = await client.query(`SELECT "checksum" FROM "CodeerMigration" WHERE "id"=$1`, [
      migration.id,
    ]);
    if (recorded.rowCount) {
      if (recorded.rows[0].checksum !== digest) {
        throw new Error(`Migration checksum mismatch: ${migration.id}`);
      }
      console.log(`Migration already recorded: ${migration.id}`);
      continue;
    }

    const present = await existingTables(client, migration.requiredTables);
    if (present.size > 0 && present.size !== migration.requiredTables.length) {
      const missing = migration.requiredTables.filter((name) => !present.has(name));
      throw new Error(
        `Partial migration detected for ${migration.id}; missing: ${missing.join(', ')}`,
      );
    }
    if (present.size === migration.requiredTables.length && !migration.alwaysApply) {
      await client.query(
        `INSERT INTO "CodeerMigration" ("id","checksum","executionMs","discoveredBaseline")
         VALUES ($1,$2,0,TRUE)`,
        [migration.id, digest],
      );
      console.log(`Recorded discovered migration baseline: ${migration.id}`);
      continue;
    }

    const startedAt = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(sql);
      const verified = await existingTables(client, migration.requiredTables);
      const missing = migration.requiredTables.filter((name) => !verified.has(name));
      if (missing.length) {
        throw new Error(`Migration verification failed; missing: ${missing.join(', ')}`);
      }
      await client.query(
        `INSERT INTO "CodeerMigration" ("id","checksum","executionMs") VALUES ($1,$2,$3)`,
        [migration.id, digest, Date.now() - startedAt],
      );
      await client.query('COMMIT');
      console.log(`Applied migration: ${migration.id}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client
    .query('SELECT pg_advisory_unlock(hashtext($1))', ['codeer-enterprise-migrations'])
    .catch(() => undefined);
  client.release();
  await pool.end();
}
