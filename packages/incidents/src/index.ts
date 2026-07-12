import { createHash } from 'node:crypto';
import {
  EvidenceSensitivity,
  HealthStatus,
  IncidentSeverity,
  IncidentStatus,
  RecoveryStage,
  type IncidentEvent,
  type IncidentEventIntegrity,
  type IncidentEventType,
  type IncidentImpact,
  type RepositoryHealthDimensions,
  type SeverityAssessment,
} from '@codeer/contracts';

const SECRET_KEY_PATTERN =
  /(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|session|token)/i;
const SECRET_VALUE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

export interface RedactionResult<T = unknown> {
  value: T;
  redacted: boolean;
  redactionCount: number;
}

export interface SeverityAssessmentInput {
  impact?: IncidentImpact | undefined;
  explicitSeverity?: IncidentSeverity | undefined;
  explicitReason?: string | undefined;
  signals?: {
    securityExposure?: boolean | undefined;
    dataIntegrityRisk?: boolean | undefined;
    productionUnavailable?: boolean | undefined;
    deploymentBlocked?: boolean | undefined;
    authenticationBroken?: boolean | undefined;
    failingTests?: boolean | undefined;
    workaroundAvailable?: boolean | undefined;
    recurrenceCount?: number | undefined;
  };
}

export interface RepositoryHealthInput {
  buildFailure?: boolean | undefined;
  failingTests?: boolean | undefined;
  deploymentBlocked?: boolean | undefined;
  dependencyIssue?: boolean | undefined;
  securityExposure?: boolean | undefined;
  apiContractMismatch?: boolean | undefined;
  frontendFunctionalityFailure?: boolean | undefined;
}

export interface IncidentEventHashInput {
  incidentId: string;
  sequence: number;
  type: IncidentEventType;
  payload: unknown;
  occurredAt: string;
  actorType: string;
  actorId?: string | undefined;
  requestId?: string | undefined;
  correlationId?: string | undefined;
  causationId?: string | undefined;
  previousHash?: string | undefined;
}

const transitions: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  [IncidentStatus.ADMITTED]: [
    IncidentStatus.TRIAGING,
    IncidentStatus.CANCELLED,
    IncidentStatus.FAILED,
  ],
  [IncidentStatus.TRIAGING]: [
    IncidentStatus.INVESTIGATING,
    IncidentStatus.FAILED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.INVESTIGATING]: [
    IncidentStatus.AWAITING_APPROVAL,
    IncidentStatus.RECOVERING,
    IncidentStatus.FAILED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.AWAITING_APPROVAL]: [
    IncidentStatus.RECOVERING,
    IncidentStatus.CANCELLED,
    IncidentStatus.FAILED,
  ],
  [IncidentStatus.RECOVERING]: [
    IncidentStatus.VERIFYING,
    IncidentStatus.FAILED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.VERIFYING]: [
    IncidentStatus.VERIFIED,
    IncidentStatus.RECOVERING,
    IncidentStatus.FAILED,
  ],
  [IncidentStatus.VERIFIED]: [],
  [IncidentStatus.FAILED]: [IncidentStatus.TRIAGING, IncidentStatus.CANCELLED],
  [IncidentStatus.CANCELLED]: [],
};

const stageByStatus: Readonly<Record<IncidentStatus, RecoveryStage>> = {
  [IncidentStatus.ADMITTED]: RecoveryStage.ADMIT,
  [IncidentStatus.TRIAGING]: RecoveryStage.TRIAGE,
  [IncidentStatus.INVESTIGATING]: RecoveryStage.DIAGNOSE,
  [IncidentStatus.AWAITING_APPROVAL]: RecoveryStage.DIAGNOSE,
  [IncidentStatus.RECOVERING]: RecoveryStage.RECOVER,
  [IncidentStatus.VERIFYING]: RecoveryStage.VERIFY,
  [IncidentStatus.VERIFIED]: RecoveryStage.VERIFY,
  [IncidentStatus.FAILED]: RecoveryStage.DIAGNOSE,
  [IncidentStatus.CANCELLED]: RecoveryStage.ADMIT,
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function digestPayload(value: unknown): string {
  return sha256(canonicalJson(value));
}

function redactString(value: string): RedactionResult<string> {
  let output = value;
  let count = 0;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, () => {
      count += 1;
      return '[REDACTED]';
    });
  }
  return { value: output, redacted: count > 0, redactionCount: count };
}

export function redactSensitiveData<T>(input: T): RedactionResult<T> {
  let count = 0;

  const visit = (value: unknown, key?: string): unknown => {
    if (key && SECRET_KEY_PATTERN.test(key)) {
      count += 1;
      return '[REDACTED]';
    }
    if (typeof value === 'string') {
      const result = redactString(value);
      count += result.redactionCount;
      return result.value;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [
          nestedKey,
          visit(nestedValue, nestedKey),
        ]),
      );
    }
    return value;
  };

  return {
    value: visit(input) as T,
    redacted: count > 0,
    redactionCount: count,
  };
}

export function assertIncidentTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`Incident transition ${from} -> ${to} is not permitted`);
  }
}

export function allowedIncidentTransitions(status: IncidentStatus): readonly IncidentStatus[] {
  return transitions[status];
}

export function stageForIncidentStatus(status: IncidentStatus): RecoveryStage {
  return stageByStatus[status];
}

export function assessSeverity(input: SeverityAssessmentInput): SeverityAssessment {
  const impact = input.impact;
  const signals = input.signals ?? {};
  const factors: Record<string, number | boolean> = {};

  const availability = impact?.availability ?? 0;
  const affectedUsers = impact?.affectedUsers ?? 0;
  const revenue = impact?.revenueImpact ?? 0;
  const dataIntegrity = impact?.dataIntegrity ?? 0;
  const security = impact?.securityImpact ?? 0;
  const environment =
    impact?.environment === 'production' ? 10 : impact?.environment === 'staging' ? 4 : 1;
  const recurrence = Math.min(signals.recurrenceCount ?? 0, 10);

  let score =
    availability * 8 +
    Math.min(affectedUsers / 1000, 10) * 2 +
    revenue * 4 +
    dataIntegrity * 9 +
    security * 10 +
    environment +
    recurrence;

  if (signals.securityExposure) score += 25;
  if (signals.dataIntegrityRisk) score += 20;
  if (signals.productionUnavailable) score += 20;
  if (signals.authenticationBroken) score += 12;
  if (signals.deploymentBlocked) score += 8;
  if (signals.failingTests) score += 3;
  if (signals.workaroundAvailable) score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));
  factors.availability = availability;
  factors.affectedUsers = affectedUsers;
  factors.revenueImpact = revenue;
  factors.dataIntegrity = dataIntegrity;
  factors.securityImpact = security;
  factors.production = impact?.environment === 'production';
  factors.securityExposure = Boolean(signals.securityExposure);
  factors.dataIntegrityRisk = Boolean(signals.dataIntegrityRisk);
  factors.productionUnavailable = Boolean(signals.productionUnavailable);
  factors.workaroundAvailable = Boolean(signals.workaroundAvailable);

  const calculatedSeverity =
    score >= 85
      ? IncidentSeverity.SEV1
      : score >= 65
        ? IncidentSeverity.SEV2
        : score >= 35
          ? IncidentSeverity.SEV3
          : IncidentSeverity.SEV4;

  return {
    score,
    severity: input.explicitSeverity ?? calculatedSeverity,
    calculatedSeverity,
    overrideApplied: Boolean(input.explicitSeverity),
    rationale:
      input.explicitSeverity && input.explicitReason
        ? input.explicitReason
        : `Deterministic severity score ${score}/100 using policy codeer-severity-v1.`,
    factors,
    policyVersion: 'codeer-severity-v1',
  };
}

export function calculateRepositoryHealth(input: RepositoryHealthInput): {
  overallScore: number;
  status: HealthStatus;
  dimensions: RepositoryHealthDimensions;
  calculationVersion: string;
} {
  const dimensions: RepositoryHealthDimensions = {
    build: input.buildFailure ? 20 : 90,
    tests: input.failingTests ? 35 : 85,
    deploymentReadiness: input.deploymentBlocked ? 25 : 85,
    dependencies: input.dependencyIssue ? 45 : 80,
    security: input.securityExposure ? 20 : 85,
    apiConsistency: input.apiContractMismatch ? 35 : 85,
    frontendFunctionality: input.frontendFunctionalityFailure ? 40 : 85,
  };
  const weights: Record<keyof RepositoryHealthDimensions, number> = {
    build: 0.2,
    tests: 0.16,
    deploymentReadiness: 0.18,
    dependencies: 0.1,
    security: 0.18,
    apiConsistency: 0.1,
    frontendFunctionality: 0.08,
  };
  const overallScore = Math.round(
    (Object.keys(dimensions) as Array<keyof RepositoryHealthDimensions>).reduce(
      (total, key) => total + dimensions[key] * weights[key],
      0,
    ),
  );
  const status =
    overallScore < 40
      ? HealthStatus.CRITICAL
      : overallScore < 65
        ? HealthStatus.DEGRADED
        : overallScore < 85
          ? HealthStatus.AT_RISK
          : HealthStatus.HEALTHY;
  return { overallScore, status, dimensions, calculationVersion: 'codeer-health-v1' };
}

export function buildIncidentEventHash(input: IncidentEventHashInput): string {
  return digestPayload({
    actorId: input.actorId ?? null,
    actorType: input.actorType,
    causationId: input.causationId ?? null,
    correlationId: input.correlationId ?? null,
    incidentId: input.incidentId,
    occurredAt: input.occurredAt,
    payload: input.payload,
    previousHash: input.previousHash ?? null,
    requestId: input.requestId ?? null,
    sequence: input.sequence,
    type: input.type,
  });
}

export function verifyIncidentEventChain(events: readonly IncidentEvent[]): IncidentEventIntegrity {
  let previousHash: string | undefined;
  let expectedSequence = 1;

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.sequence !== expectedSequence) {
      return {
        valid: false,
        checkedEvents: expectedSequence - 1,
        brokenSequence: event.sequence,
        reason: `Expected event sequence ${expectedSequence} but received ${event.sequence}.`,
      };
    }
    if ((event.previousHash ?? undefined) !== previousHash) {
      return {
        valid: false,
        checkedEvents: expectedSequence - 1,
        brokenSequence: event.sequence,
        reason: 'Event previousHash does not match the prior event hash.',
      };
    }
    const expectedHash = buildIncidentEventHash({
      incidentId: event.incidentId,
      sequence: event.sequence,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
      actorType: event.actorType,
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      ...(event.causationId ? { causationId: event.causationId } : {}),
      ...(previousHash ? { previousHash } : {}),
    });
    if (expectedHash !== event.eventHash) {
      return {
        valid: false,
        checkedEvents: expectedSequence - 1,
        brokenSequence: event.sequence,
        reason: 'Event payload or metadata does not match the recorded event hash.',
      };
    }
    previousHash = event.eventHash;
    expectedSequence += 1;
  }

  return {
    valid: true,
    checkedEvents: events.length,
    brokenSequence: null,
    reason: null,
  };
}

export function evidenceSensitivityForPayload(redacted: boolean): EvidenceSensitivity {
  return redacted ? EvidenceSensitivity.CONFIDENTIAL : EvidenceSensitivity.INTERNAL;
}
