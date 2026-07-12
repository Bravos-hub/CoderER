import { z } from 'zod';

const DEVELOPMENT_DATABASE_URL =
  'postgresql://codeer:development-only@localhost:5432/codeer?schema=public';
const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const booleanFromEnvironment = (defaultValue: 'true' | 'false' = 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const databaseSchema = z.object({
  DATABASE_URL: z.string().url().default(DEVELOPMENT_DATABASE_URL),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(50).default(0),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
});

const tenancySchema = z.object({
  API_REQUIRE_TENANT_CONTEXT: booleanFromEnvironment('false'),
  DEFAULT_ORGANIZATION_ID: z.string().uuid().default(DEFAULT_ORGANIZATION_ID),
  DEFAULT_ORGANIZATION_SLUG: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .default('local-development'),
  DEFAULT_ORGANIZATION_NAME: z.string().trim().min(1).max(160).default('Local Development'),
  REQUIRE_IDEMPOTENCY_KEYS: booleanFromEnvironment('false'),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
});

const apiSchema = baseSchema
  .merge(databaseSchema)
  .merge(tenancySchema)
  .extend({
    API_PORT: z.coerce.number().int().positive().max(65_535).default(4100),
    API_BODY_LIMIT: z
      .string()
      .regex(/^\d+(?:kb|mb)$/i)
      .default('1mb'),
    API_TRUST_PROXY: booleanFromEnvironment('false'),
    API_AUTH_MODE: z.enum(['disabled', 'api-key']).default('disabled'),
    CODEER_API_KEY: z.string().min(32).max(512).optional(),
    API_REQUIRE_SIGNED_CONTEXT: booleanFromEnvironment('false'),
    REQUEST_CONTEXT_SIGNING_SECRET: z.string().min(32).max(512).optional(),
    REQUEST_CONTEXT_SIGNING_SECRET_PREVIOUS: z.string().min(32).max(512).optional(),
    REQUEST_CONTEXT_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    RATE_LIMIT_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).max(10_000).default(120),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
  })
  .superRefine((config, context) => {
    if (config.API_AUTH_MODE === 'api-key' && !config.CODEER_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEER_API_KEY'],
        message: 'CODEER_API_KEY is required when API_AUTH_MODE=api-key',
      });
    }
    if (config.NODE_ENV === 'production' && config.API_AUTH_MODE === 'disabled') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_AUTH_MODE'],
        message: 'Production deployments must enable API authentication',
      });
    }
    if (config.API_REQUIRE_SIGNED_CONTEXT && !config.REQUEST_CONTEXT_SIGNING_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REQUEST_CONTEXT_SIGNING_SECRET'],
        message: 'REQUEST_CONTEXT_SIGNING_SECRET is required for signed request context',
      });
    }
    if (config.NODE_ENV === 'production' && !config.API_REQUIRE_SIGNED_CONTEXT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_REQUIRE_SIGNED_CONTEXT'],
        message: 'Production deployments must require signed identity context',
      });
    }
    if (config.NODE_ENV === 'production' && !config.API_REQUIRE_TENANT_CONTEXT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_REQUIRE_TENANT_CONTEXT'],
        message: 'Production deployments must require authenticated tenant context',
      });
    }
    if (config.NODE_ENV === 'production' && !config.REQUIRE_IDEMPOTENCY_KEYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REQUIRE_IDEMPOTENCY_KEYS'],
        message: 'Production write APIs must require idempotency keys',
      });
    }
    if (config.NODE_ENV === 'production' && config.DATABASE_URL === DEVELOPMENT_DATABASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production deployments must not use development database credentials',
      });
    }
    if (config.NODE_ENV === 'production' && config.CORS_ALLOWED_ORIGINS.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'Production deployments must provide at least one trusted CORS origin',
      });
    }
  });

const workerSchema = baseSchema.merge(databaseSchema).extend({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(2),
  REPOSITORY_INTAKE_CONCURRENCY: z.coerce.number().int().positive().max(10).default(1),
  INCIDENT_TRIAGE_CONCURRENCY: z.coerce.number().int().positive().max(50).default(4),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  OUTBOX_LOCK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  REPOSITORY_WORKSPACE_ROOT: z.string().min(1).default('/tmp/codeer-workspaces'),
  REPOSITORY_CLONE_DEPTH: z.coerce.number().int().min(1).max(1_000).default(1),
  MAX_REPOSITORY_FILES: z.coerce.number().int().min(100).max(2_000_000).default(100_000),
  MAX_REPOSITORY_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(100 * 1024 * 1024 * 1024)
    .default(2 * 1024 * 1024 * 1024),
  MAX_GITHUB_BRANCHES: z.coerce.number().int().min(1).max(5_000).default(500),
  DEFAULT_ORGANIZATION_ID: z.string().uuid().default(DEFAULT_ORGANIZATION_ID),
  DEFAULT_ORGANIZATION_SLUG: z.string().min(1).default('local-development'),
  DEFAULT_ORGANIZATION_NAME: z.string().min(1).default('Local Development'),
  GITHUB_APP_ID: z.string().trim().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().trim().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY_FILE: z.string().trim().min(1).optional(),
  GITHUB_TOKEN: z.string().trim().min(1).optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
});

export const loadApiConfig = (env: NodeJS.ProcessEnv) => apiSchema.parse(env);
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => workerSchema.parse(env);
export { DEFAULT_ORGANIZATION_ID, DEVELOPMENT_DATABASE_URL };
