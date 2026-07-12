import { describe, expect, it } from 'vitest';
import { loadApiConfig, loadWorkerConfig } from './index.js';

const digest = 'a'.repeat(64);

function productionApiEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    OPENAI_API_KEY: 'test-openai-provider-key-abcdefghijklmnopqrstuvwxyz',
    AI_ALLOWED_MODELS: 'gpt-5.6',
    AI_DEFAULT_MODEL: 'gpt-5.6',
    AI_MODEL_PRICING_JSON:
      '{"gpt-5.6":{"inputUsdPerMillion":5,"outputUsdPerMillion":30,"cachedInputUsdPerMillion":0.5}}',

    API_AUTH_MODE: 'api-key',
    CODEER_API_KEY: 'api-key-with-more-than-thirty-two-characters',
    API_REQUIRE_TENANT_CONTEXT: 'true',
    API_REQUIRE_SIGNED_CONTEXT: 'true',
    REQUEST_CONTEXT_SIGNING_SECRET: 'context-secret-with-more-than-thirty-two-characters',
    REQUIRE_IDEMPOTENCY_KEYS: 'true',
    DATABASE_URL: 'postgresql://codeer_app:secure-password@database.internal:5432/codeer',
    CORS_ALLOWED_ORIGINS: 'https://codeer.example.com',
    SANDBOX_DEFAULT_IMAGE: `registry.example/codeer/node@sha256:${digest}`,
    SANDBOX_HELPER_IMAGE: `registry.example/codeer/helper@sha256:${digest}`,
    SANDBOX_APPROVED_REGISTRIES: 'registry.example',
  };
}

function productionWorkerEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    OPENAI_API_KEY: 'test-openai-provider-key-abcdefghijklmnopqrstuvwxyz',
    AI_ALLOWED_MODELS: 'gpt-5.6',
    AI_DEFAULT_MODEL: 'gpt-5.6',
    AI_MODEL_PRICING_JSON:
      '{"gpt-5.6":{"inputUsdPerMillion":5,"outputUsdPerMillion":30,"cachedInputUsdPerMillion":0.5}}',

    DATABASE_URL: 'postgresql://codeer_worker:secure-password@database.internal:5432/codeer',
    SANDBOX_DEFAULT_IMAGE: `registry.example/codeer/node@sha256:${digest}`,
    SANDBOX_HELPER_IMAGE: `registry.example/codeer/helper@sha256:${digest}`,
    SANDBOX_APPROVED_REGISTRIES: 'registry.example',
    SANDBOX_DOCKER_HOST: 'tcp://sandbox-daemon.internal:2376',
    SANDBOX_DOCKER_TLS_VERIFY: 'true',
    SANDBOX_DOCKER_CERT_PATH: '/run/secrets/docker-client',
    SANDBOX_WORKSPACE_VOLUME_DRIVER: 'quota-driver',
    SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION: 'size',
  };
}

describe('production sandbox configuration', () => {
  it('accepts a fail-closed production API policy configuration', () => {
    expect(loadApiConfig(productionApiEnvironment()).NODE_ENV).toBe('production');
  });

  it('rejects mutable sandbox images at the API policy boundary', () => {
    expect(() =>
      loadApiConfig({ ...productionApiEnvironment(), SANDBOX_DEFAULT_IMAGE: 'node:24-slim' }),
    ).toThrow(/digest-pinned sandbox image/i);
  });

  it('rejects helper images from an unapproved registry', () => {
    expect(() =>
      loadApiConfig({
        ...productionApiEnvironment(),
        SANDBOX_HELPER_IMAGE: `untrusted.example/codeer/helper@sha256:${digest}`,
      }),
    ).toThrow(/registry is not approved/i);
  });

  it('accepts a remote mutually authenticated worker execution boundary', () => {
    const config = loadWorkerConfig(productionWorkerEnvironment());
    expect(config.SANDBOX_DOCKER_TLS_VERIFY).toBe(true);
    expect(config.SANDBOX_DOCKER_HOST).toMatch(/^tcp:\/\//);
  });

  it('rejects local Docker sockets in production', () => {
    expect(() =>
      loadWorkerConfig({
        ...productionWorkerEnvironment(),
        SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock',
      }),
    ).toThrow(/local Docker socket|tcp:\/\/ with TLS or ssh:\/\//i);
  });

  it('rejects unauthenticated TCP Docker endpoints', () => {
    expect(() =>
      loadWorkerConfig({
        ...productionWorkerEnvironment(),
        SANDBOX_DOCKER_TLS_VERIFY: 'false',
        SANDBOX_DOCKER_CERT_PATH: undefined,
      }),
    ).toThrow(/mutual TLS/i);
  });

  it('rejects a stale-resource threshold that could delete an active execution', () => {
    expect(() =>
      loadWorkerConfig({
        ...productionWorkerEnvironment(),
        SANDBOX_EXECUTION_TIMEOUT_MS: '3600000',
        SANDBOX_EXECUTION_LEASE_MS: '60000',
        SANDBOX_STALE_AFTER_MS: '3600000',
      }),
    ).toThrow(/stale-resource threshold/i);
  });

  it('requires a quota-aware workspace volume in production', () => {
    expect(() =>
      loadWorkerConfig({
        ...productionWorkerEnvironment(),
        SANDBOX_WORKSPACE_VOLUME_DRIVER: undefined,
        SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION: undefined,
      }),
    ).toThrow(/quota-aware/i);
  });
});
