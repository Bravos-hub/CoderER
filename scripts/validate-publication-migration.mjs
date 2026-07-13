import { readFile } from 'node:fs/promises';

const path = new URL(
  '../packages/database/prisma/migrations/20260713000100_sprint7_publication/migration.sql',
  import.meta.url,
);
const sql = await readFile(path, 'utf8');
const required = [
  'CREATE TABLE "PublicationRun"',
  'CREATE TABLE "GithubWebhookDelivery"',
  'CREATE TABLE "MergeReadinessDecision"',
  'CREATE TABLE "PostMergeVerification"',
  'CREATE TABLE "IncidentClosureRecord"',
  'FORCE ROW LEVEL SECURITY',
  'codeer_reject_immutable_mutation',
  'allowForcePush" = FALSE',
  'allowAutomaticMerge" = FALSE',
];
const missing = required.filter((token) => !sql.includes(token));
if (missing.length) {
  console.error(`Sprint 7 publication migration is missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('Sprint 7 publication migration static validation passed.');
