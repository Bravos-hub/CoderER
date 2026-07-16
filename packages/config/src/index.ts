import path from 'node:path';
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

/**
 * Parses an optional environment string, treating an empty or whitespace-only
 * value as unset. This lets `.env.example` list optional variables as blank
 * without failing min-length validation during local development.
 */
const optionalEnvString = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(min).max(max).optional(),
  );

function containerImageRegistry(image: string): string {
  const first = image.split('/')[0] ?? '';
  if (
    !image.includes('/') ||
    (!first.includes('.') && !first.includes(':') && first !== 'localhost')
  ) {
    return 'docker.io';
  }
  return first.toLowerCase();
}

function validateSandboxImageRegistries(
  config: {
    SANDBOX_DEFAULT_IMAGE: string;
    SANDBOX_HELPER_IMAGE: string;
    SANDBOX_APPROVED_REGISTRIES: string[];
  },
  context: z.RefinementCtx,
): void {
  for (const [key, image] of [
    ['SANDBOX_DEFAULT_IMAGE', config.SANDBOX_DEFAULT_IMAGE],
    ['SANDBOX_HELPER_IMAGE', config.SANDBOX_HELPER_IMAGE],
  ] as const) {
    const registry = containerImageRegistry(image);
    if (!config.SANDBOX_APPROVED_REGISTRIES.includes(registry)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Sandbox image registry is not approved: ${registry}`,
      });
    }
  }
}

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

const aiSchema = z.object({
  OPENAI_API_KEY: optionalEnvString(20, 512),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_ORGANIZATION: optionalEnvString(1, 255),
  OPENAI_PROJECT: optionalEnvString(1, 255),
  AI_ALLOWED_MODELS: z
    .string()
    .default('gpt-5.6')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .refine((value) => value.length > 0 && value.length <= 20, 'Provide 1-20 approved AI models'),
  AI_DEFAULT_MODEL: z.string().trim().min(1).max(128).default('gpt-5.6'),
  AI_MODEL_PRICING_JSON: z
    .string()
    .default('{}')
    .transform((value, context) => {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        return z
          .record(
            z.string().min(1).max(128),
            z.object({
              inputUsdPerMillion: z.number().nonnegative().max(10_000),
              outputUsdPerMillion: z.number().nonnegative().max(10_000),
              cachedInputUsdPerMillion: z.number().nonnegative().max(10_000).default(0),
            }),
          )
          .parse(parsed);
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AI_MODEL_PRICING_JSON must be a valid model pricing map.',
        });
        return z.NEVER;
      }
    }),
  AI_INVESTIGATION_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  AI_INVESTIGATION_LEASE_MS: z.coerce
    .number()
    .int()
    .min(15_000)
    .max(10 * 60 * 1000)
    .default(90_000),
  AI_INVESTIGATION_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(60 * 60 * 1000)
    .default(60_000),
  AI_INVESTIGATION_STALE_AFTER_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
  AI_MAX_CONTEXT_ITEMS: z.coerce.number().int().min(10).max(10_000).default(500),
  AI_MAX_CONTEXT_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024)
    .max(100 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  AI_MAX_CONTEXT_ITEM_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(4 * 1024 * 1024)
    .default(256 * 1024),
  AI_MAX_MODEL_INVOCATIONS: z.coerce.number().int().min(1).max(100).default(20),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().min(0).max(1_000).default(100),
  AI_MAX_INPUT_TOKENS: z.coerce.number().int().min(1_000).max(5_000_000).default(200_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(500_000).default(30_000),
  AI_MAX_COST_USD: z.coerce.number().min(0.01).max(10_000).default(25),
  AI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(6 * 60 * 60 * 1000)
    .default(45 * 60 * 1000),
  AI_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(30),
  AI_STORE_PROVIDER_RESPONSES: booleanFromEnvironment('false'),
});

const recoveryPolicySchema = z.object({
  RECOVERY_ALLOWED_PATHS: z
    .string()
    .default('apps,packages')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .refine((value) => value.length > 0 && value.length <= 500, 'Provide 1-500 recovery paths'),
  RECOVERY_ALLOWED_EXTENSIONS: z
    .string()
    .default('.ts,.tsx,.js,.jsx,.json,.md,.css,.scss,.html,.yml,.yaml')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine(
      (value) => value.length > 0 && value.every((entry) => /^\.[a-z0-9]+$/.test(entry)),
      'Recovery extensions must be dot-prefixed alphanumeric values',
    ),
  RECOVERY_MAX_CHANGED_FILES: z.coerce.number().int().min(1).max(1_000).default(25),
  RECOVERY_MAX_CHANGED_LINES: z.coerce.number().int().min(1).max(100_000).default(1_000),
  RECOVERY_MAX_PATCH_HUNKS: z.coerce.number().int().min(1).max(10_000).default(200),
  RECOVERY_MAX_PATCH_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(100 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  RECOVERY_ALLOW_NEW_FILES: booleanFromEnvironment('true'),
  RECOVERY_ALLOW_DELETED_FILES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_GENERATED_FILES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_DEPENDENCY_CHANGES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_LOCKFILE_CHANGES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_WORKFLOW_CHANGES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_INFRASTRUCTURE_CHANGES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_MIGRATION_CHANGES: booleanFromEnvironment('false'),
  RECOVERY_ALLOW_SECURITY_SENSITIVE_CHANGES: booleanFromEnvironment('false'),
  RECOVERY_REQUIRED_PUBLICATION_APPROVALS: z.coerce.number().int().min(1).max(10).default(1),
  RECOVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
  RECOVERY_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
  RECOVERY_LEASE_MS: z.coerce
    .number()
    .int()
    .min(15_000)
    .max(10 * 60 * 1000)
    .default(90_000),
  RECOVERY_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(60 * 60 * 1000)
    .default(60_000),
  RECOVERY_STALE_AFTER_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
  RECOVERY_WORKTREE_ROOT: z.string().trim().min(1).max(2_048).default('/tmp/codeer-recoveries'),
});

const sandboxPolicySchema = z.object({
  SANDBOX_DEFAULT_IMAGE: z.string().trim().min(1).max(512).default('node:24-bookworm-slim'),
  SANDBOX_HELPER_IMAGE: z.string().trim().min(1).max(512).default('node:24-bookworm-slim'),
  SANDBOX_APPROVED_REGISTRIES: z
    .string()
    .default('docker.io,ghcr.io')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((value) => value.length > 0, 'At least one approved sandbox registry is required'),
  SANDBOX_INSTALL_NETWORK: optionalEnvString(1, 128),
  SANDBOX_INSTALL_ALLOWED_REGISTRIES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((value) => value.length <= 20, 'At most 20 installation registries are allowed'),
  SANDBOX_INSTALL_ALLOWED_DOMAINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((value) => value.length <= 100, 'At most 100 installation domains are allowed'),
  SANDBOX_ALLOW_INSTALL_SCRIPTS_OVERRIDE: booleanFromEnvironment('false'),
  SANDBOX_WORKSPACE_VOLUME_DRIVER: optionalEnvString(1, 128),
  SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION: optionalEnvString(1, 128),
  SANDBOX_CPU_CORES: z.coerce.number().positive().max(16).default(1),
  SANDBOX_MEMORY_BYTES: z.coerce
    .number()
    .int()
    .min(128 * 1024 * 1024)
    .max(32 * 1024 * 1024 * 1024)
    .default(1024 * 1024 * 1024),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(4096).default(256),
  SANDBOX_WORKSPACE_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(50 * 1024 * 1024 * 1024)
    .default(2 * 1024 * 1024 * 1024),
  SANDBOX_TEMP_BYTES: z.coerce
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(8 * 1024 * 1024 * 1024)
    .default(512 * 1024 * 1024),
  SANDBOX_COMMAND_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60 * 60 * 1000)
    .default(15 * 60 * 1000),
  SANDBOX_EXECUTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(6 * 60 * 60 * 1000)
    .default(45 * 60 * 1000),
  SANDBOX_MAX_COMMANDS: z.coerce.number().int().min(1).max(50).default(10),
  SANDBOX_MAX_LOG_BYTES: z.coerce
    .number()
    .int()
    .min(16 * 1024)
    .max(100 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  SANDBOX_MAX_ARTIFACT_BYTES: z.coerce
    .number()
    .int()
    .min(0)
    .max(1024 * 1024 * 1024)
    .default(64 * 1024 * 1024),
});

const apiSchema = baseSchema
  .merge(databaseSchema)
  .merge(tenancySchema)
  .merge(sandboxPolicySchema)
  .merge(aiSchema)
  .merge(recoveryPolicySchema)
  .extend({
    API_PORT: z.coerce.number().int().positive().max(65_535).default(4100),
    API_BODY_LIMIT: z
      .string()
      .regex(/^\d+(?:kb|mb)$/i)
      .default('1mb'),
    API_TRUST_PROXY: booleanFromEnvironment('false'),
    API_AUTH_MODE: z.enum(['disabled', 'api-key']).default('disabled'),
    CODEER_API_KEY: optionalEnvString(32, 512),
    API_REQUIRE_SIGNED_CONTEXT: booleanFromEnvironment('false'),
    REQUEST_CONTEXT_SIGNING_SECRET: optionalEnvString(32, 512),
    REQUEST_CONTEXT_SIGNING_SECRET_PREVIOUS: optionalEnvString(32, 512),
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
    validateSandboxImageRegistries(config, context);
    if (config.API_AUTH_MODE === 'api-key' && !config.CODEER_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEER_API_KEY'],
        message: 'CODEER_API_KEY is required when API_AUTH_MODE=api-key',
      });
    }
    if (config.NODE_ENV === 'production' && !config.OPENAI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'Production API requires OPENAI_API_KEY for investigation orchestration.',
      });
    }
    if (!config.AI_ALLOWED_MODELS.includes(config.AI_DEFAULT_MODEL)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_DEFAULT_MODEL'],
        message: 'AI_DEFAULT_MODEL must appear in AI_ALLOWED_MODELS.',
      });
    }
    if (config.NODE_ENV === 'production') {
      const missingPricing = config.AI_ALLOWED_MODELS.filter(
        (model) => !config.AI_MODEL_PRICING_JSON[model],
      );
      if (missingPricing.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_MODEL_PRICING_JSON'],
          message: `Production AI pricing is required for approved models: ${missingPricing.join(', ')}`,
        });
      }
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
    if (
      config.NODE_ENV === 'production' &&
      config.SANDBOX_INSTALL_NETWORK &&
      config.SANDBOX_INSTALL_ALLOWED_REGISTRIES.length === 0 &&
      config.SANDBOX_INSTALL_ALLOWED_DOMAINS.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_INSTALL_ALLOWED_DOMAINS'],
        message: 'A production installation network requires an explicit destination allowlist.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.SANDBOX_DEFAULT_IMAGE.includes('@sha256:')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DEFAULT_IMAGE'],
        message: 'Production API policy evaluation requires a digest-pinned sandbox image.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.SANDBOX_HELPER_IMAGE.includes('@sha256:')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_HELPER_IMAGE'],
        message: 'Production API policy evaluation requires a digest-pinned helper image.',
      });
    }
  });

const workerSchema = baseSchema
  .merge(databaseSchema)
  .merge(sandboxPolicySchema)
  .merge(aiSchema)
  .merge(recoveryPolicySchema)
  .extend({
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
    GITHUB_APP_ID: optionalEnvString(1, 255),
    GITHUB_APP_PRIVATE_KEY: optionalEnvString(1, 20000),
    GITHUB_APP_PRIVATE_KEY_FILE: optionalEnvString(1, 2048),
    GITHUB_TOKEN: optionalEnvString(1, 512),
    GITHUB_API_URL: z.string().url().default('https://api.github.com'),
    SANDBOX_EXECUTION_CONCURRENCY: z.coerce.number().int().positive().max(20).default(1),
    SANDBOX_EXECUTION_LEASE_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(10 * 60 * 1000)
      .default(60_000),
    SANDBOX_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(60 * 60 * 1000)
      .default(60_000),
    SANDBOX_STALE_AFTER_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60 * 1000)
      .default(60 * 60 * 1000),
    SANDBOX_DOCKER_HOST: optionalEnvString(1, 1024),
    SANDBOX_DOCKER_TLS_VERIFY: booleanFromEnvironment('false'),
    SANDBOX_DOCKER_CERT_PATH: optionalEnvString(1, 1024),
    SANDBOX_COMMAND_OUTPUT_LIMIT_BYTES: z.coerce
      .number()
      .int()
      .min(64 * 1024)
      .max(100 * 1024 * 1024)
      .default(16 * 1024 * 1024),
  })
  .superRefine((config, context) => {
    validateSandboxImageRegistries(config, context);
    if (config.NODE_ENV === 'production' && !config.OPENAI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'Production investigation workers require OPENAI_API_KEY.',
      });
    }
    if (!config.AI_ALLOWED_MODELS.includes(config.AI_DEFAULT_MODEL)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_DEFAULT_MODEL'],
        message: 'AI_DEFAULT_MODEL must appear in AI_ALLOWED_MODELS.',
      });
    }
    if (config.NODE_ENV === 'production') {
      const missingPricing = config.AI_ALLOWED_MODELS.filter(
        (model) => !config.AI_MODEL_PRICING_JSON[model],
      );
      if (missingPricing.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_MODEL_PRICING_JSON'],
          message: `Production AI pricing is required for approved models: ${missingPricing.join(', ')}`,
        });
      }
    }
    if (config.NODE_ENV === 'production' && config.DATABASE_URL === DEVELOPMENT_DATABASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production workers must not use development database credentials.',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.SANDBOX_DOCKER_HOST &&
      !/^(?:tcp|ssh):\/\//.test(config.SANDBOX_DOCKER_HOST)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DOCKER_HOST'],
        message: 'Production Docker endpoints must use tcp:// with TLS or ssh://.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.SANDBOX_DOCKER_HOST) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DOCKER_HOST'],
        message: 'Production sandbox workers must use a dedicated remote Docker host.',
      });
    }
    if (config.NODE_ENV === 'production' && config.SANDBOX_DOCKER_HOST?.startsWith('unix://')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DOCKER_HOST'],
        message: 'Production sandbox workers must not use the local Docker socket.',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.SANDBOX_DOCKER_HOST?.startsWith('tcp://') &&
      !config.SANDBOX_DOCKER_TLS_VERIFY
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DOCKER_TLS_VERIFY'],
        message: 'TCP Docker endpoints must use mutual TLS verification in production.',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.SANDBOX_DOCKER_TLS_VERIFY &&
      !config.SANDBOX_DOCKER_CERT_PATH
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DOCKER_CERT_PATH'],
        message: 'SANDBOX_DOCKER_CERT_PATH is required when Docker TLS verification is enabled.',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.SANDBOX_INSTALL_NETWORK &&
      config.SANDBOX_INSTALL_ALLOWED_REGISTRIES.length === 0 &&
      config.SANDBOX_INSTALL_ALLOWED_DOMAINS.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_INSTALL_ALLOWED_DOMAINS'],
        message: 'A production installation network requires an explicit destination allowlist.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.SANDBOX_DEFAULT_IMAGE.includes('@sha256:')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_DEFAULT_IMAGE'],
        message: 'Production sandbox images must be digest pinned.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.SANDBOX_HELPER_IMAGE.includes('@sha256:')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_HELPER_IMAGE'],
        message: 'Production helper images must be digest pinned.',
      });
    }
    if (config.RECOVERY_STALE_AFTER_MS < config.RECOVERY_LEASE_MS * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RECOVERY_STALE_AFTER_MS'],
        message: 'Recovery stale threshold must be at least two lease windows.',
      });
    }
    if (config.NODE_ENV === 'production' && !path.isAbsolute(config.RECOVERY_WORKTREE_ROOT)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RECOVERY_WORKTREE_ROOT'],
        message: 'Production recovery worktree root must be an absolute path.',
      });
    }
    if (
      path.resolve(config.RECOVERY_WORKTREE_ROOT) ===
        path.resolve(config.REPOSITORY_WORKSPACE_ROOT) ||
      path
        .resolve(config.RECOVERY_WORKTREE_ROOT)
        .startsWith(`${path.resolve(config.REPOSITORY_WORKSPACE_ROOT)}${path.sep}`)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RECOVERY_WORKTREE_ROOT'],
        message:
          'Recovery worktrees must use a separate root outside the repository intake workspace.',
      });
    }
    if (
      config.SANDBOX_STALE_AFTER_MS <=
      config.SANDBOX_EXECUTION_TIMEOUT_MS + config.SANDBOX_EXECUTION_LEASE_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_STALE_AFTER_MS'],
        message:
          'Sandbox stale-resource threshold must exceed the maximum execution timeout plus its lease window.',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      (!config.SANDBOX_WORKSPACE_VOLUME_DRIVER || !config.SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SANDBOX_WORKSPACE_VOLUME_DRIVER'],
        message: 'Production requires a quota-aware workspace volume driver and size option.',
      });
    }
  });

export type ApiConfig = z.infer<typeof apiSchema>;
export type WorkerConfig = z.infer<typeof workerSchema>;

export const loadApiConfig = (env: NodeJS.ProcessEnv) => apiSchema.parse(env);
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => workerSchema.parse(env);
export { DEFAULT_ORGANIZATION_ID, DEVELOPMENT_DATABASE_URL };
