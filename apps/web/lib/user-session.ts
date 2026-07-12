import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ActorRole, ActorType } from '@codeer/contracts';

const SESSION_COOKIE = 'codeer_user_session';
const MAX_SESSION_SECONDS = 12 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

const HumanRoleSchema = z.enum([
  ActorRole.ORGANIZATION_OWNER,
  ActorRole.ORGANIZATION_ADMIN,
  ActorRole.INCIDENT_COMMANDER,
  ActorRole.RESPONDER,
  ActorRole.VIEWER,
]);

const UserSessionSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().uuid(),
    userId: z.string().regex(/^[A-Za-z0-9._:@/-]{1,128}$/),
    organizationId: z.string().uuid(),
    roles: z.array(HumanRoleSchema).min(1).max(10),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    if (value.expiresAt <= value.issuedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Session expiry must follow issuance.',
      });
    }
    if (value.expiresAt - value.issuedAt > MAX_SESSION_SECONDS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Session lifetime exceeds the maximum.',
      });
    }
  });

export type CodeerUserSession = z.infer<typeof UserSessionSchema>;

export interface HumanActorContext {
  organizationId: string;
  actorId: string;
  actorType: ActorType.USER;
  actorRoles: ActorRole[];
}

export class HumanAuthenticationError extends Error {
  constructor(message = 'A valid authenticated user session is required for this action.') {
    super(message);
    this.name = 'HumanAuthenticationError';
  }
}

function sessionSecret(): string | undefined {
  return process.env.CODEER_USER_SESSION_SECRET;
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeUserSession(session: CodeerUserSession, secret: string): string {
  if (secret.length < 32) throw new Error('User session secret must be at least 32 characters.');
  const parsed = UserSessionSchema.parse(session);
  const payload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function decodeUserSession(
  value: string,
  secret: string,
  now = Date.now(),
): CodeerUserSession {
  if (secret.length < 32) throw new HumanAuthenticationError();
  const [payload, suppliedSignature, extra] = value.split('.');
  if (!payload || !suppliedSignature || extra) throw new HumanAuthenticationError();
  const expected = Buffer.from(signature(payload, secret), 'utf8');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new HumanAuthenticationError();
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new HumanAuthenticationError();
  }
  const session = UserSessionSchema.parse(decoded);
  const nowSeconds = Math.floor(now / 1_000);
  if (session.issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || session.expiresAt <= nowSeconds) {
    throw new HumanAuthenticationError(
      'The authenticated user session is expired or not yet valid.',
    );
  }
  return session;
}

function developmentActor(): HumanActorContext | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  const actorId = process.env.CODEER_DEVELOPMENT_USER_ID;
  const organizationId = process.env.CODEER_ORGANIZATION_ID;
  if (!actorId || !organizationId) return undefined;
  const rawRoles = (process.env.CODEER_DEVELOPMENT_USER_ROLES ?? ActorRole.ORGANIZATION_OWNER)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roles = z.array(HumanRoleSchema).min(1).max(10).parse(rawRoles);
  return { organizationId, actorId, actorType: ActorType.USER, actorRoles: roles };
}

export function resolveHumanActor(request: NextRequest): HumanActorContext {
  const secret = sessionSecret();
  const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
  if (secret && rawSession) {
    const session = decodeUserSession(rawSession, secret);
    return {
      organizationId: session.organizationId,
      actorId: session.userId,
      actorType: ActorType.USER,
      actorRoles: session.roles,
    };
  }
  const fallback = developmentActor();
  if (fallback) return fallback;
  throw new HumanAuthenticationError();
}
