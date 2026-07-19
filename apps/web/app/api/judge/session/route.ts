import { NextResponse, type NextRequest } from 'next/server';
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

function json(status: number, message: string) {
  return NextResponse.json({ message }, { status });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as LoginBody;
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json(400, 'Username and password are required.');
  }
  try {
    const { session, maxAgeSeconds } = createJudgeSession(body.username, body.password);
    const secret = process.env.CODEER_USER_SESSION_SECRET;
    if (!secret) return json(503, 'Judge access is not fully configured.');
    const response = NextResponse.json({
      ok: true,
      userId: session.userId,
      roles: session.roles,
      expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
    });
    response.cookies.set(SESSION_COOKIE, encodeUserSession(session, secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: maxAgeSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof HumanAuthenticationError) return json(401, error.message);
    return json(500, 'Judge login failed.');
  }
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
