import { describe, expect, it } from 'vitest';
import { ActorRole, ActorType, IncidentPermission } from '@codeer/contracts';
import {
  AuthorizationError,
  assertIncidentPermission,
  hasIncidentPermission,
  isTrustedContextFresh,
  signTrustedContext,
  verifyTrustedContextSignature,
} from './index.js';

const secret = 'context-signing-secret-with-at-least-32-characters';
const input = {
  method: 'POST',
  path: '/api/v1/incidents',
  requestId: 'request-12345678',
  correlationId: 'correlation-12345678',
  organizationId: '00000000-0000-4000-8000-000000000001',
  actorId: 'codeer-web-bff',
  actorType: ActorType.SERVICE,
  actorRoles: [ActorRole.SERVICE],
  timestamp: '2026-07-12T10:00:00.000Z',
} as const;

describe('trusted request context', () => {
  it('signs and verifies a canonical request context', () => {
    const signature = signTrustedContext(input, secret);
    expect(verifyTrustedContextSignature(input, secret, signature)).toBe(true);
  });

  it('accepts the previous secret during a bounded rotation window', () => {
    const previousSecret = 'previous-context-signing-secret-at-least-32-characters';
    const signature = signTrustedContext(input, previousSecret);
    expect(verifyTrustedContextSignature(input, [secret, previousSecret], signature)).toBe(true);
  });

  it('rejects a signature when tenant or path is modified', () => {
    const signature = signTrustedContext(input, secret);
    expect(
      verifyTrustedContextSignature(
        { ...input, organizationId: crypto.randomUUID() },
        secret,
        signature,
      ),
    ).toBe(false);
    expect(
      verifyTrustedContextSignature({ ...input, path: '/api/v1/admin' }, secret, signature),
    ).toBe(false);
  });

  it('enforces timestamp freshness with bounded clock skew', () => {
    const now = Date.parse('2026-07-12T10:04:00.000Z');
    expect(isTrustedContextFresh(input.timestamp, 300, now)).toBe(true);
    expect(isTrustedContextFresh(input.timestamp, 120, now)).toBe(false);
  });
});

describe('incident role authorization', () => {
  it('grants viewers read-only access', () => {
    expect(hasIncidentPermission([ActorRole.VIEWER], IncidentPermission.READ)).toBe(true);
    expect(hasIncidentPermission([ActorRole.VIEWER], IncidentPermission.CREATE)).toBe(false);
  });

  it('grants responders operational but not transition access', () => {
    expect(hasIncidentPermission([ActorRole.RESPONDER], IncidentPermission.ADD_EVIDENCE)).toBe(
      true,
    );
    expect(hasIncidentPermission([ActorRole.RESPONDER], IncidentPermission.TRANSITION)).toBe(false);
  });

  it('raises a typed error for denied operations', () => {
    expect(() =>
      assertIncidentPermission([ActorRole.VIEWER], IncidentPermission.REQUEST_TRIAGE),
    ).toThrow(AuthorizationError);
  });
});
