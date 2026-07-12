import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ActorRole, ActorType } from '@codeer/contracts';
import { signTrustedContext } from '@codeer/security';
import { createRequestContextMiddleware, requestContext } from './request-context.middleware.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const secret = 'request-context-signing-secret-at-least-thirty-two-characters';

function requestFor(headers: Record<string, string>, path = '/api/v1/incidents'): Request {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    method: 'GET',
    path,
    originalUrl: path,
    header(name: string) {
      return normalized[name.toLowerCase()];
    },
  } as unknown as Request;
}

function responseFor() {
  const body: { value?: unknown } = {};
  const status: { value?: number } = {};
  const response = {
    locals: {},
    setHeader: vi.fn(),
    status(code: number) {
      status.value = code;
      return response;
    },
    json(value: unknown) {
      body.value = value;
      return response;
    },
  } as unknown as Response;
  return { response, body, status };
}

function signedHeaders(timestamp = new Date().toISOString()): Record<string, string> {
  const input = {
    method: 'GET',
    path: '/api/v1/incidents',
    requestId: 'request-12345678',
    correlationId: 'correlation-12345678',
    organizationId,
    actorId: 'codeer-web-bff',
    actorType: ActorType.SERVICE,
    actorRoles: [ActorRole.SERVICE],
    timestamp,
  } as const;
  return {
    'x-request-id': input.requestId,
    'x-correlation-id': input.correlationId,
    'x-codeer-organization-id': organizationId,
    'x-codeer-actor-id': input.actorId,
    'x-codeer-actor-type': input.actorType,
    'x-codeer-actor-roles': input.actorRoles.join(','),
    'x-codeer-context-timestamp': timestamp,
    'x-codeer-context-signature': signTrustedContext(input, secret),
  };
}

const secureOptions = {
  requireTenantContext: true,
  defaultOrganizationId: organizationId,
  requireSignedContext: true,
  signingSecrets: [secret],
  signatureMaxAgeSeconds: 300,
};

describe('request context middleware', () => {
  it('accepts a fresh, correctly signed tenant and identity context', () => {
    const request = requestFor(signedHeaders());
    const { response, status } = responseFor();
    const next = vi.fn() as NextFunction;

    createRequestContextMiddleware(secureOptions)(request, response, next);

    expect(status.value).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(requestContext(request)).toMatchObject({
      organizationId,
      actorId: 'codeer-web-bff',
      actorRoles: [ActorRole.SERVICE],
      trustedContext: true,
    });
  });

  it('rejects tampered identity context', () => {
    const headers = signedHeaders();
    headers['x-codeer-actor-id'] = 'forged-actor';
    const request = requestFor(headers);
    const { response, status } = responseFor();
    const next = vi.fn() as NextFunction;

    createRequestContextMiddleware(secureOptions)(request, response, next);

    expect(status.value).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps liveness and readiness probes independent of tenant headers', () => {
    const request = requestFor({}, '/api/v1/health/ready');
    const { response, status } = responseFor();
    const next = vi.fn() as NextFunction;

    createRequestContextMiddleware(secureOptions)(request, response, next);

    expect(status.value).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(requestContext(request).actorType).toBe(ActorType.SYSTEM);
  });
});
