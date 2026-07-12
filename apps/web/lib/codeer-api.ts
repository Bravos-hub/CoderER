import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ActorRole, ActorType } from '@codeer/contracts';
import { signTrustedContext } from '@codeer/security';
import { resolveHumanActor, type HumanActorContext } from './user-session';

const apiUrl = process.env.CODEER_API_URL_INTERNAL ?? 'http://localhost:4100/api/v1';
const apiKey = process.env.CODEER_INTERNAL_API_KEY;
const organizationId = process.env.CODEER_ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000001';
const actorId = process.env.CODEER_BFF_ACTOR_ID ?? 'codeer-web-bff';
const contextSigningSecret = process.env.CODEER_CONTEXT_SIGNING_SECRET;

interface ApiActorContext {
  organizationId: string;
  actorId: string;
  actorType: ActorType;
  actorRoles: readonly ActorRole[];
}

const serviceActor: ApiActorContext = {
  organizationId,
  actorId,
  actorType: ActorType.SERVICE,
  actorRoles: [ActorRole.SERVICE],
};

export function codeerApiUrl(path: string): string {
  return `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function authenticatedApiFetch(
  actor: ApiActorContext,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = codeerApiUrl(path);
  const targetUrl = new URL(target);
  const requestId = randomUUID();
  const correlationId = requestId;
  const timestamp = new Date().toISOString();
  const method = (init.method ?? 'GET').toUpperCase();
  const signedPath = `${targetUrl.pathname}${targetUrl.search}`;
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`);
  headers.set('x-request-id', requestId);
  headers.set('x-correlation-id', correlationId);
  headers.set('x-codeer-organization-id', actor.organizationId);
  headers.set('x-codeer-actor-id', actor.actorId);
  headers.set('x-codeer-actor-type', actor.actorType);
  headers.set('x-codeer-actor-roles', actor.actorRoles.join(','));
  headers.set('x-codeer-context-timestamp', timestamp);

  if (contextSigningSecret) {
    headers.set(
      'x-codeer-context-signature',
      signTrustedContext(
        {
          method,
          path: signedPath,
          requestId,
          correlationId,
          organizationId: actor.organizationId,
          actorId: actor.actorId,
          actorType: actor.actorType,
          actorRoles: actor.actorRoles,
          timestamp,
        },
        contextSigningSecret,
      ),
    );
  }

  return await fetch(target, { ...init, method, headers });
}

export async function codeerApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return authenticatedApiFetch(serviceActor, path, init);
}

export async function codeerHumanApiFetch(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const actor: HumanActorContext = resolveHumanActor(request);
  return authenticatedApiFetch(actor, path, init);
}

export async function upstreamJson(response: Response, fallback: string): Promise<unknown> {
  return await response.json().catch(() => ({ message: fallback }));
}
