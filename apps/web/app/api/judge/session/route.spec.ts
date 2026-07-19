import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, POST } from './route';
import { SESSION_COOKIE } from '../../../../lib/user-session';

const SECRET = 'development-user-session-secret-0123456789abcdef';

const JUDGE_ENV = {
  CODEER_JUDGE_ACCESS_ENABLED: 'true',
  CODEER_JUDGE_USERNAME: 'judge@example.com',
  CODEER_JUDGE_PASSWORD: 'correct-horse-battery-staple',
  CODEER_USER_SESSION_SECRET: SECRET,
  CODEER_ORGANIZATION_ID: '22222222-2222-4222-8222-222222222222',
} as const;

function stubJudgeEnv(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(JUDGE_ENV)) vi.stubEnv(key, value);
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

let ipCounter = 0;
function loginRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  ipCounter += 1;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost/api/judge/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
      'x-forwarded-for': `198.51.100.${ipCounter}`,
      ...headers,
    },
    body: payload,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('judge session route', () => {
  it('creates a bounded session and a no-store response for valid credentials', async () => {
    stubJudgeEnv();
    const response = await POST(
      loginRequest({ username: 'judge@example.com', password: 'correct-horse-battery-staple' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok: boolean; roles: string[] };
    expect(body.ok).toBe(true);
    expect(body.roles).toEqual(['INCIDENT_COMMANDER']);
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.value.length).toBeGreaterThan(0);
  });

  it('marks cookies Secure in production when the origin matches', async () => {
    stubJudgeEnv();
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST(
      loginRequest(
        { username: 'judge@example.com', password: 'correct-horse-battery-staple' },
        { host: 'localhost', origin: 'http://localhost' },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.cookies.get(SESSION_COOKIE)?.secure).toBe(true);
  });

  it('rejects cross-origin posts in production', async () => {
    stubJudgeEnv();
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST(
      loginRequest(
        { username: 'judge@example.com', password: 'correct-horse-battery-staple' },
        { host: 'demo.example.com', origin: 'https://evil.example.com' },
      ),
    );
    expect(response.status).toBe(403);
  });

  it('returns an identical 401 for invalid username and invalid password', async () => {
    stubJudgeEnv();
    const badUsername = await POST(
      loginRequest({ username: 'nobody@example.com', password: 'correct-horse-battery-staple' }),
    );
    const badPassword = await POST(
      loginRequest({ username: 'judge@example.com', password: 'wrong-password-value' }),
    );
    expect(badUsername.status).toBe(401);
    expect(badPassword.status).toBe(401);
    expect(await badUsername.json()).toEqual(await badPassword.json());
  });

  it('fails closed when judge access is disabled', async () => {
    stubJudgeEnv({ CODEER_JUDGE_ACCESS_ENABLED: 'false' });
    const response = await POST(
      loginRequest({ username: 'judge@example.com', password: 'correct-horse-battery-staple' }),
    );
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    stubJudgeEnv();
    const response = await POST(loginRequest({ username: 'x'.repeat(4_096), password: 'y' }));
    expect(response.status).toBe(413);
  });

  it('rate limits repeated failures from one IP', async () => {
    stubJudgeEnv();
    const attempt = () =>
      POST(
        loginRequest(
          { username: 'judge@example.com', password: 'wrong-password-value' },
          { 'x-forwarded-for': '203.0.113.9' },
        ),
      );
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);
  });

  it('never logs the submitted password', async () => {
    stubJudgeEnv();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await POST(loginRequest({ username: 'judge@example.com', password: 'wrong-password-value' }));
    await POST(
      loginRequest({ username: 'judge@example.com', password: 'correct-horse-battery-staple' }),
    );
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('judge_login_attempt');
    expect(logged).not.toContain('correct-horse-battery-staple');
    expect(logged).not.toContain('wrong-password-value');
  });

  it('clears the session cookie on logout', () => {
    const response = DELETE();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });
});
