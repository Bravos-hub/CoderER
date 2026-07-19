import { createHash, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { judgeLoginLimiter } from '../../../../lib/judge-login-limiter';
import {
  createJudgeSession,
  encodeUserSession,
  HumanAuthenticationError,
  SESSION_COOKIE,
} from '../../../../lib/user-session';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

const MAX_BODY_BYTES = 2_048;
const NO_STORE = { 'cache-control': 'no-store' };

function json(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers: NO_STORE });
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * Emits one structured audit record per login attempt. The submitted password
 * must never appear here; only the outcome, a request correlation id, a hashed
 * client IP and the authenticated actor id on success.
 */
function audit(entry: {
  requestId: string;
  outcome: 'success' | 'invalid_credentials' | 'misconfigured' | 'rate_limited' | 'rejected';
  ip: string;
  actorId?: string;
}): void {
  console.info(
    JSON.stringify({
      event: 'judge_login_attempt',
      timestamp: new Date().toISOString(),
      requestId: entry.requestId,
      outcome: entry.outcome,
      ipHash: hashIp(entry.ip),
      actorId: entry.actorId,
    }),
  );
}

function assertSameOrigin(request: NextRequest): void {
  if (process.env.NODE_ENV !== 'production') return;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) throw new HumanAuthenticationError('Judge login rejected.');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HumanAuthenticationError('Judge login rejected.');
  }
  if (originHost !== host) throw new HumanAuthenticationError('Judge login rejected.');
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const ip = clientIp(request);
  try {
    assertSameOrigin(request);
  } catch {
    audit({ requestId, outcome: 'rejected', ip });
    return json(403, 'Judge login rejected.');
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    audit({ requestId, outcome: 'rejected', ip });
    return json(413, 'Judge login payload is too large.');
  }

  if (judgeLoginLimiter.isLimited(ip)) {
    audit({ requestId, outcome: 'rate_limited', ip });
    return json(429, 'Too many judge login attempts. Try again later.');
  }

  const body = (await request.json().catch(() => ({}))) as LoginBody;
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json(400, 'Username and password are required.');
  }
  try {
    const { session, maxAgeSeconds } = createJudgeSession(body.username, body.password);
    const secret = process.env.CODEER_USER_SESSION_SECRET;
    if (!secret) return json(503, 'Judge access is not fully configured.');
    judgeLoginLimiter.recordSuccess(ip);
    audit({ requestId, outcome: 'success', ip, actorId: session.userId });
    const response = NextResponse.json(
      {
        ok: true,
        userId: session.userId,
        roles: session.roles,
        expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
      },
      { headers: NO_STORE },
    );
    response.cookies.set(SESSION_COOKIE, encodeUserSession(session, secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: maxAgeSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof HumanAuthenticationError) {
      if (error.message === 'Judge credentials are invalid.') {
        judgeLoginLimiter.recordFailure(ip);
        audit({ requestId, outcome: 'invalid_credentials', ip });
      } else {
        audit({ requestId, outcome: 'misconfigured', ip });
      }
      return json(401, error.message);
    }
    return json(500, 'Judge login failed.');
  }
}

export function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
