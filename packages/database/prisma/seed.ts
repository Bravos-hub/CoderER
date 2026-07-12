import { randomUUID } from 'node:crypto';
import { closeDatabase, databasePool, withTransaction } from '../src/index.js';

const organizationId =
  process.env.DEFAULT_ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000001';
const slug = process.env.DEFAULT_ORGANIZATION_SLUG ?? 'local-development';
const name = process.env.DEFAULT_ORGANIZATION_NAME ?? 'Local Development';

const pool = databasePool();
await withTransaction(
  async (client) => {
    await client.query(
      `INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT ("id") DO UPDATE SET
         "slug" = EXCLUDED."slug", "name" = EXCLUDED."name", "updatedAt" = NOW()`,
      [organizationId, slug, name],
    );

    if (process.env.SEED_DEMO_REPOSITORY === 'true') {
      await client.query(
        `INSERT INTO "Repository" (
           "id", "organizationId", "provider", "providerRepoId", "owner", "name", "fullName",
           "visibility", "defaultBranch", "cloneUrl", "htmlUrl", "createdAt", "updatedAt"
         ) VALUES ($1, $2, 'GITHUB', 'local-demo', 'Bravos-hub', 'CoderER', 'Bravos-hub/CoderER',
           'PUBLIC', 'main', 'https://github.com/Bravos-hub/CoderER.git',
           'https://github.com/Bravos-hub/CoderER', NOW(), NOW())
         ON CONFLICT ("organizationId", "provider", "providerRepoId") DO NOTHING`,
        [randomUUID(), organizationId],
      );
    }
  },
  { tenantOrganizationId: organizationId },
  pool,
);

await closeDatabase();
