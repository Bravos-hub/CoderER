import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ActorRole, ActorType } from '@codeer/contracts';
import {
  isTrustedContextFresh,
  normalizeActorRoles,
  verifyTrustedContextSignature,
} from '@codeer/security';

const SAFE_CONTEXT_ID = /^[A-Za-z0-9._:@/-]{1,128}$/;

export interface CodeerRequestContext {
  requestId: string;
  correlationId: string;
  organizationId: string;
  actorId: string;
  actorType: ActorType;
  actorRoles: ActorRole[];
  trustedContext: boolean;
}

export interface RequestContextOptions {
  requireTenantContext: boolean;
  defaultOrganizationId: string;
  requireSignedContext: boolean;
  signingSecrets?: readonly string[] | undefined;
  signatureMaxAgeSeconds: number;
}

type ContextualRequest = Request & { codeerContext?: CodeerRequestContext };

function safeHeader(value: string | undefined): string | undefined {
  return value && SAFE_CONTEXT_ID.test(value) ? value : undefined;
}

function parseActorType(value: string | undefined): ActorType {
  return Object.values(ActorType).includes(value as ActorType)
    ? (value as ActorType)
    : ActorType.USER;
}

function parseActorRoles(value: string | undefined): ActorRole[] | undefined | null {
  if (!value) return undefined;
  const values = value
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  if (
    values.length === 0 ||
    values.length > 10 ||
    values.some((role) => !Object.values(ActorRole).includes(role as ActorRole))
  ) {
    return null;
  }
  return normalizeActorRoles(values as ActorRole[]);
}

function localDefaultRoles(actorType: ActorType): ActorRole[] {
  return actorType === ActorType.SERVICE || actorType === ActorType.SYSTEM
    ? [ActorRole.SERVICE]
    : [ActorRole.ORGANIZATION_OWNER];
}

function reject(response: Response, requestId: string, status: number, message: string): void {
  response.status(status).json({
    statusCode: status,
    error: status === 401 ? 'Unauthorized' : 'Bad Request',
    message,
    requestId,
  });
}

export function createRequestContextMiddleware(options: RequestContextOptions) {
  return (request: ContextualRequest, response: Response, next: NextFunction): void => {
    const requestId = safeHeader(request.header('x-request-id')) ?? randomUUID();
    const correlationId = safeHeader(request.header('x-correlation-id')) ?? requestId;
    response.locals.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-correlation-id', correlationId);

    const isHealthRequest = request.path.startsWith('/api/v1/health');
    if (isHealthRequest) {
      request.codeerContext = {
        requestId,
        correlationId,
        organizationId: options.defaultOrganizationId,
        actorId: 'codeer-health-check',
        actorType: ActorType.SYSTEM,
        actorRoles: [ActorRole.SERVICE],
        trustedContext: true,
      };
      next();
      return;
    }

    const suppliedOrganizationId = request.header('x-codeer-organization-id');
    const organizationId = suppliedOrganizationId ?? options.defaultOrganizationId;
    const actorId = safeHeader(request.header('x-codeer-actor-id')) ?? 'local-development-user';
    const selectedActorType = parseActorType(request.header('x-codeer-actor-type'));
    const parsedRoles = parseActorRoles(request.header('x-codeer-actor-roles'));

    if (parsedRoles === null) {
      reject(response, requestId, 400, 'x-codeer-actor-roles contains an unsupported role.');
      return;
    }
    if (options.requireTenantContext && !suppliedOrganizationId) {
      reject(response, requestId, 400, 'x-codeer-organization-id is required.');
      return;
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        organizationId,
      )
    ) {
      reject(response, requestId, 400, 'x-codeer-organization-id must be a UUID.');
      return;
    }

    const actorRoles = parsedRoles ?? localDefaultRoles(selectedActorType);
    const timestamp = request.header('x-codeer-context-timestamp');
    const signature = request.header('x-codeer-context-signature');
    const signatureInput = timestamp
      ? {
          method: request.method,
          path: request.originalUrl,
          requestId,
          correlationId,
          organizationId,
          actorId,
          actorType: selectedActorType,
          actorRoles,
          timestamp,
        }
      : undefined;
    const trustedContext = Boolean(
      signatureInput &&
      options.signingSecrets &&
      options.signingSecrets.length > 0 &&
      isTrustedContextFresh(timestamp ?? '', options.signatureMaxAgeSeconds) &&
      verifyTrustedContextSignature(signatureInput, options.signingSecrets, signature),
    );

    if (options.requireSignedContext && !trustedContext) {
      reject(response, requestId, 401, 'A valid, fresh signed identity context is required.');
      return;
    }

    request.codeerContext = {
      requestId,
      correlationId,
      organizationId,
      actorId,
      actorType: selectedActorType,
      actorRoles,
      trustedContext,
    };
    next();
  };
}

export function requestContext(request: Request): CodeerRequestContext {
  const contextualRequest = request as ContextualRequest;
  if (!contextualRequest.codeerContext) throw new Error('Request context middleware has not run');
  return contextualRequest.codeerContext;
}
