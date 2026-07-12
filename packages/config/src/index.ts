import { z } from 'zod';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const booleanFromEnvironment = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const apiSchema = baseSchema
  .extend({
    API_PORT: z.coerce.number().int().positive().max(65_535).default(4100),
    API_BODY_LIMIT: z
      .string()
      .regex(/^\d+(?:kb|mb)$/i)
      .default('1mb'),
    API_TRUST_PROXY: booleanFromEnvironment,
    API_AUTH_MODE: z.enum(['disabled', 'api-key']).default('disabled'),
    CODEER_API_KEY: z.string().min(32).max(512).optional(),
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
    if (config.NODE_ENV === 'production' && config.CORS_ALLOWED_ORIGINS.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'Production deployments must provide at least one trusted CORS origin',
      });
    }
  });

const workerSchema = baseSchema.extend({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(20).default(2),
  REPOSITORY_INTAKE_CONCURRENCY: z.coerce.number().int().positive().max(5).default(1),
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
  GITHUB_APP_ID: z.string().trim().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().trim().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY_FILE: z.string().trim().min(1).optional(),
  GITHUB_TOKEN: z.string().trim().min(1).optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
});

export const loadApiConfig = (env: NodeJS.ProcessEnv) => apiSchema.parse(env);
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => workerSchema.parse(env);
