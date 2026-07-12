import { describe, expect, it } from 'vitest';
import { ActorRole } from '@codeer/contracts';
import { decodeUserSession, encodeUserSession, type CodeerUserSession } from './user-session';

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
