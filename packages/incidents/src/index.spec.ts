import { describe, expect, it } from 'vitest';
import {
  ActorType,
  EvidenceSensitivity,
  IncidentEventType,
  IncidentSeverity,
  IncidentStatus,
  RecoveryStage,
} from '@codeer/contracts';
import {
  allowedIncidentTransitions,
  assessSeverity,
  buildIncidentEventHash,
  calculateRepositoryHealth,
  digestPayload,
  evidenceSensitivityForPayload,
  redactSensitiveData,
  stageForIncidentStatus,
  verifyIncidentEventChain,
} from './index.js';

describe('incident domain policy', () => {
  it('classifies a production security and availability event as SEV-1', () => {
    const result = assessSeverity({
      impact: {
        availability: 5,
        affectedUsers: 10_000,
        revenueImpact: 4,
        dataIntegrity: 4,
        securityImpact: 5,
        environment: 'production',
      },
      signals: { securityExposure: true, productionUnavailable: true },
    });
    expect(result.severity).toBe(IncidentSeverity.SEV1);
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it('records explicit severity overrides without hiding the calculated severity', () => {
    const result = assessSeverity({
      explicitSeverity: IncidentSeverity.SEV2,
      explicitReason: 'Contractual critical-service classification.',
      impact: {
        availability: 1,
        affectedUsers: 10,
        revenueImpact: 0,
        dataIntegrity: 0,
        securityImpact: 0,
        environment: 'development',
      },
    });
    expect(result.severity).toBe(IncidentSeverity.SEV2);
    expect(result.calculatedSeverity).toBe(IncidentSeverity.SEV4);
    expect(result.overrideApplied).toBe(true);
  });

  it('enforces the recovery state machine', () => {
    expect(allowedIncidentTransitions(IncidentStatus.ADMITTED)).toContain(IncidentStatus.TRIAGING);
    expect(allowedIncidentTransitions(IncidentStatus.VERIFIED)).toEqual([]);
    expect(stageForIncidentStatus(IncidentStatus.RECOVERING)).toBe(RecoveryStage.RECOVER);
  });

  it('redacts secret-bearing keys and token-shaped values', () => {
    const result = redactSensitiveData({
      password: 'should-not-leak',
      log: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.12345',
      nested: { githubToken: 'ghp_' + 'abcdefghijklmnopqrstuvwxyz123456' },
    });
    expect(result.redacted).toBe(true);
    expect(result.redactionCount).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(result.value)).not.toContain('should-not-leak');
    expect(evidenceSensitivityForPayload(result.redacted)).toBe(EvidenceSensitivity.CONFIDENTIAL);
  });

  it('produces deterministic payload and event hashes', () => {
    expect(digestPayload({ b: 2, a: 1 })).toBe(digestPayload({ a: 1, b: 2 }));
    const input = {
      incidentId: 'ec76edcb-f166-4c39-997c-7ecf28bd42f1',
      sequence: 1,
      type: IncidentEventType.INCIDENT_ADMITTED,
      payload: { title: 'Build failed' },
      occurredAt: '2026-07-12T00:00:00.000Z',
      actorType: 'USER',
      actorId: 'f5663d64-fec4-4d8c-9976-a1aa64424e58',
    } as const;
    expect(buildIncidentEventHash(input)).toBe(buildIncidentEventHash(input));
  });

  it('detects tampering in an incident event chain', () => {
    const base = {
      id: 'cabbd4c0-9452-4f16-90be-ae3c1796639a',
      incidentId: 'ec76edcb-f166-4c39-997c-7ecf28bd42f1',
      sequence: 1,
      type: IncidentEventType.INCIDENT_ADMITTED,
      payload: { title: 'Build failed' },
      actorType: ActorType.USER,
      actorId: 'f5663d64-fec4-4d8c-9976-a1aa64424e58',
      requestId: 'request-12345678',
      correlationId: 'correlation-12345678',
      causationId: null,
      previousHash: null,
      occurredAt: '2026-07-12T00:00:00.000Z',
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const event = {
      ...base,
      eventHash: buildIncidentEventHash({
        ...base,
        actorType: base.actorType,
        previousHash: undefined,
        causationId: undefined,
      }),
    };
    expect(verifyIncidentEventChain([event])).toMatchObject({ valid: true, checkedEvents: 1 });
    expect(verifyIncidentEventChain([{ ...event, payload: { title: 'Tampered' } }])).toMatchObject({
      valid: false,
      brokenSequence: 1,
    });
  });

  it('calculates repository health with security and build weighted strongly', () => {
    const health = calculateRepositoryHealth({ buildFailure: true, securityExposure: true });
    expect(health.overallScore).toBeLessThan(65);
    expect(health.dimensions.security).toBe(20);
  });
});
