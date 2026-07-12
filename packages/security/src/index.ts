import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ActorRole,
  IncidentPermission,
  RepositoryPermission,
  type ActorType,
} from '@codeer/contracts';

const SIGNATURE_VERSION = 'v1';
const MAX_CONTEXT_ROLES = 10;

export interface TrustedContextSignatureInput {
  method: string;
  path: string;
  requestId: string;
  correlationId: string;
  organizationId: string;
  actorId: string;
  actorType: ActorType;
  actorRoles: readonly ActorRole[];
  timestamp: string;
}

export type CodeerPermission = IncidentPermission | RepositoryPermission;

const allPermissions: readonly CodeerPermission[] = [
  ...Object.values(IncidentPermission),
  ...Object.values(RepositoryPermission),
];

const rolePermissions: Readonly<Record<ActorRole, readonly CodeerPermission[]>> = {
  [ActorRole.ORGANIZATION_OWNER]: allPermissions,
  [ActorRole.ORGANIZATION_ADMIN]: allPermissions,
  [ActorRole.INCIDENT_COMMANDER]: [
    IncidentPermission.READ,
    IncidentPermission.CREATE,
    IncidentPermission.ADD_EVIDENCE,
    IncidentPermission.REQUEST_TRIAGE,
    IncidentPermission.TRANSITION,
    IncidentPermission.READ_AUDIT,
    IncidentPermission.OVERRIDE_SEVERITY,
    IncidentPermission.MANAGE_RESTRICTED_EVIDENCE,
    RepositoryPermission.READ,
  ],
  [ActorRole.RESPONDER]: [
    IncidentPermission.READ,
    IncidentPermission.CREATE,
    IncidentPermission.ADD_EVIDENCE,
    IncidentPermission.REQUEST_TRIAGE,
    RepositoryPermission.READ,
  ],
  [ActorRole.VIEWER]: [IncidentPermission.READ, RepositoryPermission.READ],
  [ActorRole.SERVICE]: allPermissions,
};

export class AuthorizationError extends Error {
  readonly permission: CodeerPermission;

  constructor(permission: CodeerPermission) {
    super(`Actor is not authorized for ${permission}.`);
    this.name = 'AuthorizationError';
    this.permission = permission;
  }
}

export function normalizeActorRoles(roles: readonly ActorRole[]): ActorRole[] {
  return [...new Set(roles)].sort().slice(0, MAX_CONTEXT_ROLES);
}

export function contextSignaturePayload(input: TrustedContextSignatureInput): string {
  const roles = normalizeActorRoles(input.actorRoles).join(',');
  return [
    SIGNATURE_VERSION,
    input.method.toUpperCase(),
    input.path,
    input.requestId,
    input.correlationId,
    input.organizationId,
    input.actorId,
    input.actorType,
    roles,
    input.timestamp,
  ].join('\n');
}

export function signTrustedContext(input: TrustedContextSignatureInput, secret: string): string {
  if (secret.length < 32) throw new Error('Context signing secret must be at least 32 characters.');
  return createHmac('sha256', secret).update(contextSignaturePayload(input)).digest('base64url');
}

export function verifyTrustedContextSignature(
  input: TrustedContextSignatureInput,
  secrets: string | readonly string[],
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const candidate = Buffer.from(signature, 'utf8');
  const candidates = typeof secrets === 'string' ? [secrets] : secrets;
  return candidates.some((secret) => {
    if (secret.length < 32) return false;
    const expected = Buffer.from(signTrustedContext(input, secret), 'utf8');
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  });
}

export function isTrustedContextFresh(
  timestamp: string,
  maxAgeSeconds: number,
  now = Date.now(),
): boolean {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const skew = Math.abs(now - parsed);
  return skew <= maxAgeSeconds * 1_000;
}

export function hasCodeerPermission(
  roles: readonly ActorRole[],
  permission: CodeerPermission,
): boolean {
  return normalizeActorRoles(roles).some((role) => rolePermissions[role].includes(permission));
}

export function assertCodeerPermission(
  roles: readonly ActorRole[],
  permission: CodeerPermission,
): void {
  if (!hasCodeerPermission(roles, permission)) throw new AuthorizationError(permission);
}

export function hasIncidentPermission(
  roles: readonly ActorRole[],
  permission: IncidentPermission,
): boolean {
  return hasCodeerPermission(roles, permission);
}

export function assertIncidentPermission(
  roles: readonly ActorRole[],
  permission: IncidentPermission,
): void {
  assertCodeerPermission(roles, permission);
}

export function assertRepositoryPermission(
  roles: readonly ActorRole[],
  permission: RepositoryPermission,
): void {
  assertCodeerPermission(roles, permission);
}
