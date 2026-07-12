import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma loads this config even for offline commands such as `generate` and
// `validate`. Keep those commands usable in a fresh checkout while allowing
// every database command to override the URL through the environment.
const datasourceUrl =
  process.env.DATABASE_URL ?? 'postgresql://codeer:codeer@127.0.0.1:5432/codeer';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: datasourceUrl },
});
