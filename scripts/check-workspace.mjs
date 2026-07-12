import { access } from 'node:fs/promises';

const requiredPaths = [
  'apps/web/package.json',
  'apps/api/package.json',
  'apps/worker/package.json',
  'packages/contracts/package.json',
  'packages/config/package.json',
  'packages/logger/package.json',
  'packages/incidents/package.json',
  'packages/security/package.json',
  'packages/database/package.json',
  'packages/github/package.json',
  'packages/repository/package.json',
  'packages/sandbox/package.json',
  'packages/ai/package.json',
  'packages/recovery/package.json',
  'docs/architecture/CONTROLLED_RECOVERY_PLANE.md',
  'packages/database/prisma/migrations/20260713000100_sprint6_controlled_recovery/migration.sql',
  'docker-compose.yml',
  '.github/workflows/ci.yml',
];

const missing = [];
for (const requiredPath of requiredPaths) {
  try {
    await access(requiredPath);
  } catch {
    missing.push(requiredPath);
  }
}

if (missing.length > 0) {
  console.error(`Workspace is incomplete. Missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`CodeER workspace check passed (${requiredPaths.length} required paths).`);
