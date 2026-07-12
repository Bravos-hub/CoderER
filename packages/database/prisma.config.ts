import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const datasourceUrl =
  process.env.DATABASE_URL ?? 'postgresql://codeer:codeer@127.0.0.1:5432/codeer';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: datasourceUrl },
});
