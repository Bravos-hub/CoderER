import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActorRole } from '@codeer/contracts';
import {
  createJudgeSession,
  decodeUserSession,
  encodeUserSession,
  HumanAuthenticationError,
  type CodeerUserSession,
} from './user-session';

const secret = 'development-user-session-secret-0123456789abcdef';
const session: CodeerUserSession = {
  version: 1 as const,
  sessionId: '11111111-1111-4111-8111-111111111111',
  userId: 'human-responder@example.com',
  organizationId: '22222222-2222-4222-8222-222222222222',
  roles: [ActorRole.INCIDENT_COMMANDER],
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_003_600,
};

describe('signed user sessions', () => {
  it('round-trips a bounded human identity', () => {
    const encoded = encodeUserSession(session, secret);
    expect(decodeUserSession(encoded, secret, 1_700_000_100_000)).toEqual(session);
  });

  it('rejects tampered and expired sessions', () => {
    const encoded = encodeUserSession(session, secret);
    const tampered = `${encoded.slice(0, -1)}x`;
    expect(() => decodeUserSession(tampered, secret, 1_700_000_100_000)).toThrow();
    expect(() => decodeUserSession(encoded, secret, 1_700_004_000_000)).toThrow(/expired/);
  });

  it('rejects service roles in human sessions', () => {
    const unsafeSession = { ...session, roles: [ActorRole.SERVICE] };
    expect(() => encodeUserSession(unsafeSession as CodeerUserSession, secret)).toThrow();
  });
});

const JUDGE_ENV = {
  CODEER_JUDGE_ACCESS_ENABLED: 'true',
  CODEER_JUDGE_USERNAME: 'judge@example.com',
  CODEER_JUDGE_PASSWORD: 'correct-horse-battery-staple',
  CODEER_USER_SESSION_SECRET: secret,
  CODEER_ORGANIZATION_ID: '22222222-2222-4222-8222-222222222222',
} as const;

function stubJudgeEnv(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries(JUDGE_ENV)) vi.stubEnv(key, value);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
}

describe('judge session creation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues an incident-commander-only session for valid credentials', () => {
    stubJudgeEnv();
    const { session: judgeSession, maxAgeSeconds } = createJudgeSession(
      'judge@example.com',
      'correct-horse-battery-staple',
    );
    expect(judgeSession.roles).toEqual([ActorRole.INCIDENT_COMMANDER]);
    expect(judgeSession.userId).toBe('judge@example.com');
    expect(maxAgeSeconds).toBe(8 * 60 * 60);
    expect(judgeSession.expiresAt - judgeSession.issuedAt).toBe(maxAgeSeconds);
  });

  it('normalizes surrounding whitespace in the username', () => {
    stubJudgeEnv();
    const { session: judgeSession } = createJudgeSession(
      '  judge@example.com  ',
      'correct-horse-battery-staple',
    );
    expect(judgeSession.userId).toBe('judge@example.com');
  });

  it('refuses when judge access is disabled', () => {
    stubJudgeEnv({ CODEER_JUDGE_ACCESS_ENABLED: 'false' });
    expect(() => createJudgeSession('judge@example.com', 'correct-horse-battery-staple')).toThrow(
      /not enabled/,
    );
  });

  it.each([
    ['missing username', { CODEER_JUDGE_USERNAME: undefined }],
    ['missing password', { CODEER_JUDGE_PASSWORD: undefined }],
    ['weak password', { CODEER_JUDGE_PASSWORD: 'short' }],
    ['missing secret', { CODEER_USER_SESSION_SECRET: undefined }],
    ['short secret', { CODEER_USER_SESSION_SECRET: 'too-short' }],
    ['invalid organization', { CODEER_ORGANIZATION_ID: 'not-a-uuid' }],
  ])('fails closed on %s', (_label, overrides) => {
    stubJudgeEnv(overrides);
    expect(() => createJudgeSession('judge@example.com', 'correct-horse-battery-staple')).toThrow(
      /not fully configured/,
    );
  });

  it('returns the same error for an invalid username and an invalid password', () => {
    stubJudgeEnv();
    let usernameError: unknown;
    let passwordError: unknown;
    try {
      createJudgeSession('nobody@example.com', 'correct-horse-battery-staple');
    } catch (error) {
      usernameError = error;
    }
    try {
      createJudgeSession('judge@example.com', 'wrong-password-value');
    } catch (error) {
      passwordError = error;
    }
    expect(usernameError).toBeInstanceOf(HumanAuthenticationError);
    expect(passwordError).toBeInstanceOf(HumanAuthenticationError);
    expect((usernameError as Error).message).toBe('Judge credentials are invalid.');
    expect((passwordError as Error).message).toBe('Judge credentials are invalid.');
  });

  it('clamps session lifetime to the 12 hour maximum', () => {
    stubJudgeEnv({ CODEER_JUDGE_SESSION_HOURS: '48' });
    const { maxAgeSeconds, session: judgeSession } = createJudgeSession(
      'judge@example.com',
      'correct-horse-battery-staple',
    );
    expect(maxAgeSeconds).toBe(12 * 60 * 60);
    expect(judgeSession.expiresAt - judgeSession.issuedAt).toBe(12 * 60 * 60);
  });

  it('produces sessions that survive encode/decode round-trip', () => {
    stubJudgeEnv();
    const { session: judgeSession } = createJudgeSession(
      'judge@example.com',
      'correct-horse-battery-staple',
    );
    const encoded = encodeUserSession(judgeSession, secret);
    expect(decodeUserSession(encoded, secret)).toEqual(judgeSession);
  });
});
