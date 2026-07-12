import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ActorRole,
  ActorType,
  EvidenceKind,
  EvidenceSensitivity,
  IncidentDetailSchema,
  IncidentEventSchema,
  IncidentEventType,
  IncidentListSchema,
  IncidentSchema,
  IncidentStatus,
  IncidentTriageResultSchema,
  OutboxStatus,
  RecoveryStage,
  RepositoryHealthSnapshotSchema,
  SeverityAssessmentSchema,
  type CreateEvidenceInput,
  type CreateIncidentInput,
  type Incident,
  type IncidentDetail,
  type IncidentEvent,
  type IncidentList,
  type IncidentListQuery,
  type IncidentSeverity,
  type IncidentSignals,
  type IncidentTriageJob,
  type IncidentTriageResult,
  type RepositoryHealthSnapshot,
  type RepositoryIntakeJob,
  type RepositoryIntakeResult,
  type SeverityAssessment,
  type TransitionIncidentInput,
} from '@codeer/contracts';
import {
  assessSeverity,
  assertIncidentTransition,
  buildIncidentEventHash,
  calculateRepositoryHealth,
  canonicalJson,
  digestPayload,
  redactSensitiveData,
  sha256,
  stageForIncidentStatus,
  verifyIncidentEventChain,
} from '@codeer/incidents';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';

export interface StoreActorContext {
  organizationId: string;
  actorId: string;
  actorType: ActorType;
  actorRoles: ActorRole[];
  requestId: string;
  correlationId: string;
}

export interface OrganizationDefaults {
  id: string;
  slug: string;
  name: string;
}

export interface CreateIncidentCommand {
  context: StoreActorContext;
  input: CreateIncidentInput;
  idempotencyKey?: string | undefined;
  idempotencyTtlSeconds: number;
  organizationDefaults: OrganizationDefaults;
}

export interface OutboxRecord {
  id: string;
  organizationId: string;
  topic: string;
  partitionKey: string;
  deduplicationKey: string;
  payload: unknown;
  attempts: number;
}

interface IncidentRow {
  id: string;
  organizationId: string;
  repositoryId: string;
  shortCode: string;
  title: string;
  description: string;
  severity: string;
  severityScore: number;
  severityReason: string;
  status: string;
  stage: string;
  source: string;
  externalReference: string | null;
  labels: string[];
  version: number;
  reportedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
  impact?: unknown;
  signals?: unknown;
}

interface EventRow {
  id: string;
  incidentId: string;
  sequence: number;
  type: string;
  payload: unknown;
  actorType: string;
  actorId: string | null;
  requestId: string | null;
  correlationId: string | null;
  causationId: string | null;
  previousHash: string | null;
  eventHash: string;
  occurredAt: Date;
  createdAt: Date;
}

interface EvidenceRow {
  id: string;
  organizationId: string;
  incidentId: string;
  sessionId: string | null;
  kind: string;
  source: string;
  sensitivity: string;
  title: string;
  summary: string;
  payload: unknown;
  byteSize: number;
  digest: string;
  redacted: boolean;
  redactionCount: number;
  origin: string | null;
  observedAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
}

interface SeverityRow {
  score: number;
  severity: string;
  calculatedSeverity: string;
  overrideApplied: boolean;
  rationale: string;
  factors: Record<string, number | boolean | string>;
  policyVersion: string;
}

interface HealthRow {
  id: string;
  organizationId: string;
  repositoryId: string;
  incidentId: string | null;
  overallScore: number;
  status: string;
  dimensions: Record<string, number>;
  evidenceCount: number;
  calculationVersion: string;
  createdAt: Date;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key has already been used with a different request.');
    this.name = 'IdempotencyConflictError';
  }
}

export class OptimisticConcurrencyError extends Error {
  constructor() {
    super('The incident changed since it was read. Refresh and retry the operation.');
    this.name = 'OptimisticConcurrencyError';
  }
}

export class TenantResourceNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found in the active organization.`);
    this.name = 'TenantResourceNotFoundError';
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function mapIncident(row: IncidentRow): Incident {
  return IncidentSchema.parse({
    ...row,
    severity: row.severity,
    status: row.status,
    stage: row.stage,
    source: row.source,
    reportedAt: iso(row.reportedAt),
    acknowledgedAt: row.acknowledgedAt ? iso(row.acknowledgedAt) : null,
    resolvedAt: row.resolvedAt ? iso(row.resolvedAt) : null,
    lastActivityAt: iso(row.lastActivityAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

function mapEvent(row: EventRow): IncidentEvent {
  return IncidentEventSchema.parse({
    ...row,
    occurredAt: iso(row.occurredAt),
    createdAt: iso(row.createdAt),
  });
}

function mapEvidence(row: EvidenceRow) {
  return {
    ...row,
    observedAt: iso(row.observedAt),
    expiresAt: row.expiresAt ? iso(row.expiresAt) : undefined,
    createdAt: iso(row.createdAt),
  };
}

function mapSeverity(row: SeverityRow): SeverityAssessment {
  return SeverityAssessmentSchema.parse(row);
}

function mapHealth(row: HealthRow): RepositoryHealthSnapshot {
  return RepositoryHealthSnapshotSchema.parse({
    ...row,
    createdAt: iso(row.createdAt),
  });
}

function incidentShortCode(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `ER-${date}-${randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;
}

function encodeCursor(incident: Incident): string {
  return Buffer.from(
    JSON.stringify({ lastActivityAt: incident.lastActivityAt, id: incident.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string): { lastActivityAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.lastActivityAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.lastActivityAt)) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }
    return { lastActivityAt: parsed.lastActivityAt, id: parsed.id };
  } catch {
    throw new Error('Incident cursor is invalid');
  }
}

async function ensureOrganization(
  client: PoolClient,
  defaults: OrganizationDefaults,
): Promise<void> {
  await client.query(
    `INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT ("id") DO NOTHING`,
    [defaults.id, defaults.slug, defaults.name],
  );
}

async function appendIncidentEvent(
  client: PoolClient,
  command: {
    incidentId: string;
    type: IncidentEventType;
    payload: unknown;
    actorType: ActorType;
    actorId?: string | undefined;
    requestId?: string | undefined;
    correlationId?: string | undefined;
    causationId?: string | undefined;
    occurredAt?: Date | undefined;
  },
): Promise<IncidentEvent> {
  const latest = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence", "eventHash"
       FROM "IncidentEvent"
      WHERE "incidentId" = $1
      ORDER BY "sequence" DESC
      LIMIT 1
      FOR UPDATE`,
    [command.incidentId],
  );
  const sequence = (latest?.sequence ?? 0) + 1;
  const occurredAt = command.occurredAt ?? new Date();
  const eventHash = buildIncidentEventHash({
    incidentId: command.incidentId,
    sequence,
    type: command.type,
    payload: command.payload,
    occurredAt: occurredAt.toISOString(),
    actorType: command.actorType,
    ...(command.actorId ? { actorId: command.actorId } : {}),
    ...(command.requestId ? { requestId: command.requestId } : {}),
    ...(command.correlationId ? { correlationId: command.correlationId } : {}),
    ...(command.causationId ? { causationId: command.causationId } : {}),
    ...(latest?.eventHash ? { previousHash: latest.eventHash } : {}),
  });
  const id = randomUUID();
  const row = await queryOne<EventRow>(
    client,
    `INSERT INTO "IncidentEvent" (
       "id", "incidentId", "sequence", "type", "payload", "actorType", "actorId",
       "requestId", "correlationId", "causationId", "previousHash", "eventHash",
       "occurredAt", "createdAt"
     ) VALUES (
       $1, $2, $3, $4::"IncidentEventType", $5::jsonb, $6::"ActorType", $7,
       $8, $9, $10, $11, $12, $13, NOW()
     ) RETURNING *`,
    [
      id,
      command.incidentId,
      sequence,
      command.type,
      canonicalJson(command.payload),
      command.actorType,
      command.actorId ?? null,
      command.requestId ?? null,
      command.correlationId ?? null,
      command.causationId ?? null,
      latest?.eventHash ?? null,
      eventHash,
      occurredAt,
    ],
  );
  if (!row) throw new Error('Incident event insert returned no row');
  return mapEvent(row);
}

async function appendAuditLog(
  client: PoolClient,
  command: {
    context: StoreActorContext;
    incidentId?: string | undefined;
    action: string;
    resourceType: string;
    resourceId: string;
    outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE' | undefined;
    reason?: string | undefined;
    metadata?: unknown;
  },
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    command.context.organizationId,
  ]);
  const latest = await queryOne<{ auditHash: string }>(
    client,
    `SELECT "auditHash" FROM "AuditLog"
      WHERE "organizationId" = $1
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1`,
    [command.context.organizationId],
  );
  const id = randomUUID();
  const createdAt = new Date();
  const metadata = command.metadata ?? {};
  const auditHash = digestPayload({
    id,
    organizationId: command.context.organizationId,
    incidentId: command.incidentId ?? null,
    action: command.action,
    resourceType: command.resourceType,
    resourceId: command.resourceId,
    actorType: command.context.actorType,
    actorId: command.context.actorId,
    outcome: command.outcome ?? 'SUCCESS',
    requestId: command.context.requestId,
    correlationId: command.context.correlationId,
    reason: command.reason ?? null,
    metadata,
    previousHash: latest?.auditHash ?? null,
    createdAt: createdAt.toISOString(),
  });
  await client.query(
    `INSERT INTO "AuditLog" (
       "id", "organizationId", "incidentId", "action", "resourceType", "resourceId",
       "actorType", "actorId", "outcome", "requestId", "correlationId", "reason",
       "metadata", "previousHash", "auditHash", "createdAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::"ActorType", $8, $9::"AuditOutcome", $10, $11,
       $12, $13::jsonb, $14, $15, $16
     )`,
    [
      id,
      command.context.organizationId,
      command.incidentId ?? null,
      command.action,
      command.resourceType,
      command.resourceId,
      command.context.actorType,
      command.context.actorId,
      command.outcome ?? 'SUCCESS',
      command.context.requestId,
      command.context.correlationId,
      command.reason ?? null,
      canonicalJson(metadata),
      latest?.auditHash ?? null,
      auditHash,
      createdAt,
    ],
  );
}

async function insertOutbox(
  client: PoolClient,
  command: {
    organizationId: string;
    topic: string;
    partitionKey: string;
    deduplicationKey: string;
    payload: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "OutboxMessage" (
       "id", "organizationId", "topic", "partitionKey", "deduplicationKey", "payload",
       "status", "attempts", "availableAt", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())
     ON CONFLICT ("deduplicationKey") DO NOTHING`,
    [
      randomUUID(),
      command.organizationId,
      command.topic,
      command.partitionKey,
      command.deduplicationKey,
      canonicalJson(command.payload),
    ],
  );
}

export class IncidentStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async createIncident(command: CreateIncidentCommand): Promise<Incident> {
    const requestHash = sha256(canonicalJson(command.input));
    return await withTransaction(
      async (client) => {
        await ensureOrganization(client, command.organizationDefaults);

        if (command.idempotencyKey) {
          const previous = await queryOne<{
            requestHash: string;
            response: Incident;
            expiresAt: Date;
          }>(
            client,
            `SELECT "requestHash", "response", "expiresAt"
               FROM "IdempotencyRecord"
              WHERE "organizationId" = $1 AND "scope" = 'incident.create' AND "key" = $2
              FOR UPDATE`,
            [command.context.organizationId, command.idempotencyKey],
          );
          if (previous && previous.expiresAt > new Date()) {
            if (previous.requestHash !== requestHash) throw new IdempotencyConflictError();
            return IncidentSchema.parse(previous.response);
          }
        }

        const repository = await queryOne<{ id: string }>(
          client,
          `SELECT "id" FROM "Repository"
            WHERE "id" = $1 AND "organizationId" = $2`,
          [command.input.repositoryId, command.context.organizationId],
        );
        if (!repository) throw new TenantResourceNotFoundError('Repository');

        const assessment = assessSeverity({
          ...(command.input.impact ? { impact: command.input.impact } : {}),
          ...(command.input.severity ? { explicitSeverity: command.input.severity } : {}),
          ...(command.input.severityOverrideReason
            ? { explicitReason: command.input.severityOverrideReason }
            : {}),
          ...(command.input.signals ? { signals: command.input.signals } : {}),
        });
        const now = new Date();
        const incidentId = randomUUID();
        const row = await queryOne<IncidentRow>(
          client,
          `INSERT INTO "Incident" (
             "id", "organizationId", "repositoryId", "shortCode", "title", "description",
             "severity", "severityScore", "severityReason", "status", "stage", "source",
             "externalReference", "labels", "version", "impact", "signals", "reportedAt",
             "lastActivityAt", "createdAt", "updatedAt"
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7::"IncidentSeverity", $8, $9,
             'ADMITTED', 'ADMIT', $10::"IncidentSource", $11, $12, 1, $13::jsonb, $14::jsonb,
             $15, $16, NOW(), NOW()
           ) RETURNING *`,
          [
            incidentId,
            command.context.organizationId,
            command.input.repositoryId,
            incidentShortCode(now),
            command.input.title,
            command.input.description,
            assessment.severity,
            assessment.score,
            assessment.rationale,
            command.input.source,
            command.input.externalReference ?? null,
            command.input.labels,
            command.input.impact ? canonicalJson(command.input.impact) : null,
            command.input.signals ? canonicalJson(command.input.signals) : null,
            command.input.reportedAt ? new Date(command.input.reportedAt) : now,
            now,
          ],
        );
        if (!row) throw new Error('Incident insert returned no row');

        await client.query(
          `INSERT INTO "SeverityAssessment" (
             "id", "incidentId", "score", "severity", "calculatedSeverity", "overrideApplied",
             "rationale", "factors", "policyVersion", "createdByType", "createdById", "createdAt"
           ) VALUES (
             $1, $2, $3, $4::"IncidentSeverity", $5::"IncidentSeverity", $6, $7, $8::jsonb,
             $9, $10::"ActorType", $11, NOW()
           )`,
          [
            randomUUID(),
            incidentId,
            assessment.score,
            assessment.severity,
            assessment.calculatedSeverity,
            assessment.overrideApplied,
            assessment.rationale,
            canonicalJson(assessment.factors),
            assessment.policyVersion,
            command.context.actorType,
            command.context.actorId,
          ],
        );

        await appendIncidentEvent(client, {
          incidentId,
          type: IncidentEventType.INCIDENT_ADMITTED,
          payload: {
            shortCode: row.shortCode,
            repositoryId: row.repositoryId,
            severity: assessment.severity,
            source: command.input.source,
          },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
          occurredAt: now,
        });

        const triagePayload: IncidentTriageJob = {
          incidentId,
          organizationId: command.context.organizationId,
          requestedAt: now.toISOString(),
          requestedBy: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
          ...(command.input.signals ? { signals: command.input.signals } : {}),
          attempt: 1,
        };
        await insertOutbox(client, {
          organizationId: command.context.organizationId,
          topic: 'incident.triage.requested',
          partitionKey: incidentId,
          deduplicationKey: `incident.triage:${incidentId}:1`,
          payload: triagePayload,
        });
        await appendIncidentEvent(client, {
          incidentId,
          type: IncidentEventType.TRIAGE_REQUESTED,
          payload: { outboxDeduplicationKey: `incident.triage:${incidentId}:1` },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
          occurredAt: now,
        });
        await appendAuditLog(client, {
          context: command.context,
          incidentId,
          action: 'incident.create',
          resourceType: 'Incident',
          resourceId: incidentId,
          metadata: { repositoryId: row.repositoryId, severity: row.severity },
        });

        const incident = mapIncident(row);
        if (command.idempotencyKey) {
          await client.query(
            `INSERT INTO "IdempotencyRecord" (
               "id", "organizationId", "scope", "key", "requestHash", "response",
               "statusCode", "resourceId", "expiresAt", "createdAt"
             ) VALUES ($1, $2, 'incident.create', $3, $4, $5::jsonb, 201, $6,
               NOW() + ($7 * INTERVAL '1 second'), NOW())
             ON CONFLICT ("organizationId", "scope", "key") DO UPDATE SET
               "requestHash" = EXCLUDED."requestHash",
               "response" = EXCLUDED."response",
               "statusCode" = EXCLUDED."statusCode",
               "resourceId" = EXCLUDED."resourceId",
               "expiresAt" = EXCLUDED."expiresAt"`,
            [
              randomUUID(),
              command.context.organizationId,
              command.idempotencyKey,
              requestHash,
              canonicalJson(incident),
              incidentId,
              command.idempotencyTtlSeconds,
            ],
          );
        }
        return incident;
      },
      {
        isolationLevel: 'SERIALIZABLE',
        maxRetries: 5,
        tenantOrganizationId: command.context.organizationId,
      },
      this.pool,
    );
  }

  async listIncidents(organizationId: string, query: IncidentListQuery): Promise<IncidentList> {
    const values: unknown[] = [organizationId];
    const clauses = ['"organizationId" = $1'];
    if (query.repositoryId) {
      values.push(query.repositoryId);
      clauses.push(`"repositoryId" = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      clauses.push(`"status" = $${values.length}::"IncidentStatus"`);
    }
    if (query.severity) {
      values.push(query.severity);
      clauses.push(`"severity" = $${values.length}::"IncidentSeverity"`);
    }
    if (query.source) {
      values.push(query.source);
      clauses.push(`"source" = $${values.length}::"IncidentSource"`);
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      values.push(cursor.lastActivityAt, cursor.id);
      clauses.push(
        `("lastActivityAt", "id") < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
      );
    }
    values.push(query.limit + 1);
    return await withTransaction(
      async (client) => {
        const rows = await queryMany<IncidentRow>(
          client,
          `SELECT * FROM "Incident"
            WHERE ${clauses.join(' AND ')}
            ORDER BY "lastActivityAt" DESC, "id" DESC
            LIMIT $${values.length}`,
          values,
        );
        const mapped = rows.map(mapIncident);
        const hasMore = mapped.length > query.limit;
        const items = hasMore ? mapped.slice(0, query.limit) : mapped;
        const last = items.at(-1);
        return IncidentListSchema.parse({
          items,
          nextCursor: hasMore && last ? encodeCursor(last) : null,
        });
      },
      { isolationLevel: 'READ COMMITTED', tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async getIncidentDetail(organizationId: string, incidentId: string): Promise<IncidentDetail> {
    return await withTransaction(
      async (client) => {
        const incidentRow = await queryOne<IncidentRow>(
          client,
          `SELECT * FROM "Incident" WHERE "id" = $1 AND "organizationId" = $2`,
          [incidentId, organizationId],
        );
        if (!incidentRow) throw new TenantResourceNotFoundError('Incident');
        const [eventRows, evidenceRows, severityRow, healthRow] = await Promise.all([
          queryMany<EventRow>(
            client,
            `SELECT * FROM "IncidentEvent" WHERE "incidentId" = $1 ORDER BY "sequence" ASC LIMIT 500`,
            [incidentId],
          ),
          queryMany<EvidenceRow>(
            client,
            `SELECT * FROM "Evidence" WHERE "incidentId" = $1 AND "organizationId" = $2
              ORDER BY "observedAt" DESC LIMIT 200`,
            [incidentId, organizationId],
          ),
          queryOne<SeverityRow>(
            client,
            `SELECT "score", "severity", "calculatedSeverity", "overrideApplied", "rationale",
                    "factors", "policyVersion"
               FROM "SeverityAssessment" WHERE "incidentId" = $1
               ORDER BY "createdAt" DESC LIMIT 1`,
            [incidentId],
          ),
          queryOne<HealthRow>(
            client,
            `SELECT * FROM "RepositoryHealthSnapshot" WHERE "incidentId" = $1
              ORDER BY "createdAt" DESC LIMIT 1`,
            [incidentId],
          ),
        ]);
        const timeline = eventRows.map(mapEvent);
        return IncidentDetailSchema.parse({
          incident: mapIncident(incidentRow),
          latestSeverityAssessment: severityRow ? mapSeverity(severityRow) : null,
          latestHealthSnapshot: healthRow ? mapHealth(healthRow) : null,
          evidence: evidenceRows.map(mapEvidence),
          timeline,
          timelineIntegrity: verifyIncidentEventChain(timeline),
        });
      },
      { isolationLevel: 'REPEATABLE READ', tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async addEvidence(context: StoreActorContext, incidentId: string, input: CreateEvidenceInput) {
    return await withTransaction(
      async (client) => {
        const incident = await queryOne<{ id: string }>(
          client,
          `SELECT "id" FROM "Incident" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`,
          [incidentId, context.organizationId],
        );
        if (!incident) throw new TenantResourceNotFoundError('Incident');
        const redaction = redactSensitiveData(input.payload);
        const payload = redaction.value;
        const digest = digestPayload(payload);
        const byteSize = Buffer.byteLength(canonicalJson(payload), 'utf8');
        const id = randomUUID();
        const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
        let row = await queryOne<EvidenceRow>(
          client,
          `INSERT INTO "Evidence" (
             "id", "organizationId", "incidentId", "kind", "source", "sensitivity", "title",
             "summary", "payload", "byteSize", "digest", "redacted", "redactionCount", "origin",
             "observedAt", "expiresAt", "createdAt"
           ) VALUES (
             $1, $2, $3, $4::"EvidenceKind", $5::"EvidenceSource", $6::"EvidenceSensitivity",
             $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, NOW()
           )
           ON CONFLICT ("incidentId", "digest", "kind") DO NOTHING
           RETURNING *`,
          [
            id,
            context.organizationId,
            incidentId,
            input.kind,
            input.source,
            redaction.redacted ? EvidenceSensitivity.CONFIDENTIAL : input.sensitivity,
            input.title,
            input.summary,
            canonicalJson(payload),
            byteSize,
            digest,
            redaction.redacted,
            redaction.redactionCount,
            input.origin ?? null,
            observedAt,
            input.expiresAt ? new Date(input.expiresAt) : null,
          ],
        );
        row ??= await queryOne<EvidenceRow>(
          client,
          `SELECT * FROM "Evidence"
            WHERE "incidentId" = $1 AND "digest" = $2 AND "kind" = $3::"EvidenceKind"`,
          [incidentId, digest, input.kind],
        );
        if (!row) throw new Error('Evidence insert or lookup returned no row');
        await appendIncidentEvent(client, {
          incidentId,
          type: IncidentEventType.EVIDENCE_RECORDED,
          payload: {
            evidenceId: row.id,
            kind: row.kind,
            digest: row.digest,
            redacted: row.redacted,
          },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          occurredAt: observedAt,
        });
        await client.query(
          `UPDATE "Incident" SET "lastActivityAt" = NOW(), "updatedAt" = NOW(), "version" = "version" + 1
            WHERE "id" = $1`,
          [incidentId],
        );
        await appendAuditLog(client, {
          context,
          incidentId,
          action: 'evidence.create',
          resourceType: 'Evidence',
          resourceId: row.id,
          metadata: { kind: row.kind, sensitivity: row.sensitivity, redacted: row.redacted },
        });
        return mapEvidence(row);
      },
      {
        isolationLevel: 'SERIALIZABLE',
        maxRetries: 5,
        tenantOrganizationId: context.organizationId,
      },
      this.pool,
    );
  }

  async transitionIncident(
    context: StoreActorContext,
    incidentId: string,
    input: TransitionIncidentInput,
  ): Promise<Incident> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<IncidentRow>(
          client,
          `SELECT * FROM "Incident" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`,
          [incidentId, context.organizationId],
        );
        if (!row) throw new TenantResourceNotFoundError('Incident');
        if (row.version !== input.expectedVersion) throw new OptimisticConcurrencyError();
        assertIncidentTransition(row.status as IncidentStatus, input.toStatus);
        const stage = stageForIncidentStatus(input.toStatus);
        const updated = await queryOne<IncidentRow>(
          client,
          `UPDATE "Incident" SET
             "status" = $1::"IncidentStatus", "stage" = $2::"RecoveryStage",
             "version" = "version" + 1, "lastActivityAt" = NOW(), "updatedAt" = NOW(),
             "acknowledgedAt" = CASE WHEN $1::"IncidentStatus" = 'INVESTIGATING' AND "acknowledgedAt" IS NULL THEN NOW() ELSE "acknowledgedAt" END,
             "resolvedAt" = CASE WHEN $1::"IncidentStatus" = 'VERIFIED' THEN NOW() ELSE "resolvedAt" END
           WHERE "id" = $3 AND "version" = $4
           RETURNING *`,
          [input.toStatus, stage, incidentId, input.expectedVersion],
        );
        if (!updated) throw new OptimisticConcurrencyError();
        await appendIncidentEvent(client, {
          incidentId,
          type: IncidentEventType.STATUS_CHANGED,
          payload: { from: row.status, to: input.toStatus, reason: input.reason },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        await appendAuditLog(client, {
          context,
          incidentId,
          action: 'incident.transition',
          resourceType: 'Incident',
          resourceId: incidentId,
          reason: input.reason,
          metadata: {
            from: row.status,
            to: input.toStatus,
            expectedVersion: input.expectedVersion,
          },
        });
        return mapIncident(updated);
      },
      {
        isolationLevel: 'SERIALIZABLE',
        maxRetries: 5,
        tenantOrganizationId: context.organizationId,
      },
      this.pool,
    );
  }

  async requestTriage(
    context: StoreActorContext,
    incidentId: string,
    signals: IncidentSignals | undefined,
    force: boolean,
  ): Promise<Incident> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<IncidentRow>(
          client,
          `SELECT * FROM "Incident" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`,
          [incidentId, context.organizationId],
        );
        if (!row) throw new TenantResourceNotFoundError('Incident');
        if (
          !force &&
          [IncidentStatus.TRIAGING, IncidentStatus.INVESTIGATING].includes(
            row.status as IncidentStatus,
          )
        ) {
          return mapIncident(row);
        }
        if (
          [IncidentStatus.VERIFIED, IncidentStatus.CANCELLED].includes(row.status as IncidentStatus)
        ) {
          throw new Error(`Cannot triage an incident in ${row.status} state`);
        }
        const nextVersion = row.version + 1;
        const payload: IncidentTriageJob = {
          incidentId,
          organizationId: context.organizationId,
          requestedAt: new Date().toISOString(),
          requestedBy: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          ...(signals ? { signals } : {}),
          attempt: 1,
        };
        await insertOutbox(client, {
          organizationId: context.organizationId,
          topic: 'incident.triage.requested',
          partitionKey: incidentId,
          deduplicationKey: `incident.triage:${incidentId}:${nextVersion}`,
          payload,
        });
        await appendIncidentEvent(client, {
          incidentId,
          type: IncidentEventType.TRIAGE_REQUESTED,
          payload: { force, requestedVersion: nextVersion },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        const updated = await queryOne<IncidentRow>(
          client,
          `UPDATE "Incident" SET "lastActivityAt" = NOW(), "updatedAt" = NOW(), "version" = $2,
             "signals" = COALESCE($3::jsonb, "signals")
            WHERE "id" = $1 RETURNING *`,
          [incidentId, nextVersion, signals ? canonicalJson(signals) : null],
        );
        if (!updated) throw new Error('Incident triage request update returned no row');
        await appendAuditLog(client, {
          context,
          incidentId,
          action: 'incident.triage.request',
          resourceType: 'Incident',
          resourceId: incidentId,
          metadata: { force, version: nextVersion },
        });
        return mapIncident(updated);
      },
      {
        isolationLevel: 'SERIALIZABLE',
        maxRetries: 5,
        tenantOrganizationId: context.organizationId,
      },
      this.pool,
    );
  }

  async processTriage(job: IncidentTriageJob): Promise<IncidentTriageResult> {
    return await withTransaction(
      async (client) => {
        const incident = await queryOne<IncidentRow>(
          client,
          `SELECT * FROM "Incident" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`,
          [job.incidentId, job.organizationId],
        );
        if (!incident) throw new TenantResourceNotFoundError('Incident');
        const context: StoreActorContext = {
          organizationId: job.organizationId,
          actorId: 'incident-triage-worker',
          actorType: ActorType.SERVICE,
          actorRoles: [ActorRole.SERVICE],
          requestId: job.requestId,
          correlationId: job.correlationId,
        };

        const persistedStatus = incident.status as IncidentStatus;
        if (
          persistedStatus === IncidentStatus.VERIFIED ||
          persistedStatus === IncidentStatus.CANCELLED
        ) {
          throw new Error(`Incident ${incident.id} is terminal and cannot be triaged`);
        }

        await client.query(
          `UPDATE "Incident" SET "status" = 'TRIAGING', "stage" = 'TRIAGE',
             "lastActivityAt" = NOW(), "updatedAt" = NOW(), "version" = "version" + 1
            WHERE "id" = $1`,
          [incident.id],
        );
        await appendIncidentEvent(client, {
          incidentId: incident.id,
          type: IncidentEventType.TRIAGE_STARTED,
          payload: { attempt: job.attempt, worker: 'incident-triage-worker' },
          actorType: ActorType.SERVICE,
          actorId: 'incident-triage-worker',
          requestId: job.requestId,
          correlationId: job.correlationId,
        });

        const signals = job.signals ?? ((incident.signals ?? {}) as IncidentSignals);
        const rawEvidence = {
          errorMessage: signals.errorMessage ?? incident.description,
          failingCommand: signals.failingCommand,
          logExcerpt: signals.logExcerpt,
          ciRunUrl: signals.ciRunUrl,
          repositoryId: incident.repositoryId,
          reportedAt: incident.reportedAt.toISOString(),
        };
        const redaction = redactSensitiveData(rawEvidence);
        const evidencePayload = redaction.value;
        const evidenceDigest = digestPayload(evidencePayload);
        const evidenceId = randomUUID();
        let evidenceRow = await queryOne<EvidenceRow>(
          client,
          `INSERT INTO "Evidence" (
             "id", "organizationId", "incidentId", "kind", "source", "sensitivity", "title",
             "summary", "payload", "byteSize", "digest", "redacted", "redactionCount",
             "collectionMethod", "observedAt", "createdAt"
           ) VALUES (
             $1, $2, $3, 'ERROR', 'SYSTEM', $4::"EvidenceSensitivity", $5, $6,
             $7::jsonb, $8, $9, $10, $11, 'incident-triage-v1', NOW(), NOW()
           )
           ON CONFLICT ("incidentId", "digest", "kind") DO NOTHING
           RETURNING *`,
          [
            evidenceId,
            incident.organizationId,
            incident.id,
            redaction.redacted ? EvidenceSensitivity.CONFIDENTIAL : EvidenceSensitivity.INTERNAL,
            'Initial failure signal',
            'Normalized and redacted failure evidence collected during triage.',
            canonicalJson(evidencePayload),
            Buffer.byteLength(canonicalJson(evidencePayload), 'utf8'),
            evidenceDigest,
            redaction.redacted,
            redaction.redactionCount,
          ],
        );
        evidenceRow ??= await queryOne<EvidenceRow>(
          client,
          `SELECT * FROM "Evidence"
            WHERE "incidentId" = $1 AND "digest" = $2 AND "kind" = 'ERROR'`,
          [incident.id, evidenceDigest],
        );
        if (!evidenceRow) throw new Error('Triage evidence insert or lookup returned no row');
        await appendIncidentEvent(client, {
          incidentId: incident.id,
          type: IncidentEventType.EVIDENCE_RECORDED,
          payload: {
            evidenceId: evidenceRow.id,
            kind: EvidenceKind.ERROR,
            digest: evidenceRow.digest,
            redacted: evidenceRow.redacted,
          },
          actorType: ActorType.SERVICE,
          actorId: 'incident-triage-worker',
          requestId: job.requestId,
          correlationId: job.correlationId,
        });

        const previousAssessment = await queryOne<{
          severity: string;
          overrideApplied: boolean;
          rationale: string;
        }>(
          client,
          `SELECT "severity", "overrideApplied", "rationale"
             FROM "SeverityAssessment"
            WHERE "incidentId" = $1
            ORDER BY "createdAt" DESC
            LIMIT 1`,
          [incident.id],
        );
        const assessment = assessSeverity({
          impact: incident.impact as CreateIncidentInput['impact'],
          ...(previousAssessment?.overrideApplied
            ? {
                explicitSeverity: previousAssessment.severity as IncidentSeverity,
                explicitReason: previousAssessment.rationale,
              }
            : {}),
          signals,
        });
        await client.query(
          `INSERT INTO "SeverityAssessment" (
             "id", "incidentId", "score", "severity", "calculatedSeverity", "overrideApplied",
             "rationale", "factors", "policyVersion", "createdByType", "createdById", "createdAt"
           ) VALUES ($1, $2, $3, $4::"IncidentSeverity", $5::"IncidentSeverity", $6,
             $7, $8::jsonb, $9, 'SERVICE', 'incident-triage-worker', NOW())`,
          [
            randomUUID(),
            incident.id,
            assessment.score,
            assessment.severity,
            assessment.calculatedSeverity,
            assessment.overrideApplied,
            assessment.rationale,
            canonicalJson(assessment.factors),
            assessment.policyVersion,
          ],
        );
        await appendIncidentEvent(client, {
          incidentId: incident.id,
          type: IncidentEventType.SEVERITY_ASSESSED,
          payload: assessment,
          actorType: ActorType.SERVICE,
          actorId: 'incident-triage-worker',
          requestId: job.requestId,
          correlationId: job.correlationId,
        });

        const health = calculateRepositoryHealth({
          buildFailure: Boolean(
            signals.failingCommand || /build/i.test(signals.errorMessage ?? ''),
          ),
          failingTests: signals.failingTests,
          deploymentBlocked: signals.deploymentBlocked,
          dependencyIssue: signals.dependencyIssue,
          securityExposure: signals.securityExposure,
          apiContractMismatch: signals.apiContractMismatch,
          frontendFunctionalityFailure: signals.frontendFunctionalityFailure,
        });
        const healthId = randomUUID();
        const healthRow = await queryOne<HealthRow>(
          client,
          `INSERT INTO "RepositoryHealthSnapshot" (
             "id", "organizationId", "repositoryId", "incidentId", "overallScore", "status",
             "dimensions", "evidenceCount", "calculationVersion", "createdAt"
           ) VALUES ($1, $2, $3, $4, $5, $6::"HealthStatus", $7::jsonb, 1, $8, NOW())
           RETURNING *`,
          [
            healthId,
            incident.organizationId,
            incident.repositoryId,
            incident.id,
            health.overallScore,
            health.status,
            canonicalJson(health.dimensions),
            health.calculationVersion,
          ],
        );
        if (!healthRow) throw new Error('Health snapshot insert returned no row');
        await appendIncidentEvent(client, {
          incidentId: incident.id,
          type: IncidentEventType.HEALTH_SNAPSHOT_RECORDED,
          payload: {
            healthSnapshotId: healthId,
            overallScore: health.overallScore,
            status: health.status,
          },
          actorType: ActorType.SERVICE,
          actorId: 'incident-triage-worker',
          requestId: job.requestId,
          correlationId: job.correlationId,
        });

        await client.query(
          `UPDATE "Incident" SET
             "severity" = $1::"IncidentSeverity", "severityScore" = $2, "severityReason" = $3,
             "status" = 'INVESTIGATING', "stage" = 'DIAGNOSE',
             "acknowledgedAt" = COALESCE("acknowledgedAt", NOW()),
             "lastActivityAt" = NOW(), "updatedAt" = NOW(), "version" = "version" + 1
            WHERE "id" = $4`,
          [assessment.severity, assessment.score, assessment.rationale, incident.id],
        );
        await appendIncidentEvent(client, {
          incidentId: incident.id,
          type: IncidentEventType.TRIAGE_COMPLETED,
          payload: {
            severity: assessment.severity,
            severityScore: assessment.score,
            repositoryHealth: health.overallScore,
            nextStage: RecoveryStage.DIAGNOSE,
          },
          actorType: ActorType.SERVICE,
          actorId: 'incident-triage-worker',
          requestId: job.requestId,
          correlationId: job.correlationId,
        });
        await appendAuditLog(client, {
          context,
          incidentId: incident.id,
          action: 'incident.triage.complete',
          resourceType: 'Incident',
          resourceId: incident.id,
          metadata: {
            severity: assessment.severity,
            severityScore: assessment.score,
            healthScore: health.overallScore,
            evidenceId: evidenceRow.id,
          },
        });

        return IncidentTriageResultSchema.parse({
          incidentId: incident.id,
          status: IncidentStatus.INVESTIGATING,
          stage: RecoveryStage.DIAGNOSE,
          severityAssessment: assessment,
          healthSnapshot: mapHealth(healthRow),
          evidenceIds: [evidenceRow.id],
          completedAt: new Date().toISOString(),
        });
      },
      {
        isolationLevel: 'SERIALIZABLE',
        maxRetries: 5,
        statementTimeoutMs: 30_000,
        tenantOrganizationId: job.organizationId,
      },
      this.pool,
    );
  }

  async latestRepositoryHealth(
    organizationId: string,
    repositoryId: string,
  ): Promise<RepositoryHealthSnapshot | undefined> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<HealthRow>(
          client,
          `SELECT h.* FROM "RepositoryHealthSnapshot" h
            JOIN "Repository" r ON r."id" = h."repositoryId"
           WHERE h."repositoryId" = $1 AND r."organizationId" = $2
           ORDER BY h."createdAt" DESC LIMIT 1`,
          [repositoryId, organizationId],
        );
        return row ? mapHealth(row) : undefined;
      },
      { isolationLevel: 'READ COMMITTED', tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async claimOutboxBatch(
    workerId: string,
    batchSize: number,
    lockTimeoutMs: number,
  ): Promise<OutboxRecord[]> {
    return await withTransaction(
      async (client) => {
        const rows = await queryMany<OutboxRecord>(
          client,
          `WITH candidates AS (
             SELECT "id" FROM "OutboxMessage"
              WHERE (
                "status" IN ('PENDING', 'FAILED')
                OR ("status" = 'PROCESSING' AND "lockedAt" < NOW() - ($3 * INTERVAL '1 millisecond'))
              )
                AND "availableAt" <= NOW()
              ORDER BY "createdAt" ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED
           )
           UPDATE "OutboxMessage" o
              SET "status" = 'PROCESSING', "lockedAt" = NOW(), "lockedBy" = $2,
                  "attempts" = "attempts" + 1, "updatedAt" = NOW()
             FROM candidates c
            WHERE o."id" = c."id"
           RETURNING o."id", o."organizationId", o."topic", o."partitionKey",
                     o."deduplicationKey", o."payload", o."attempts"`,
          [batchSize, workerId, lockTimeoutMs],
        );
        return rows;
      },
      { isolationLevel: 'READ COMMITTED', maxRetries: 3, workerBypassRls: true },
      this.pool,
    );
  }

  async markOutboxPublished(id: string): Promise<void> {
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE "OutboxMessage" SET "status" = 'PUBLISHED', "publishedAt" = NOW(),
             "lockedAt" = NULL, "lockedBy" = NULL, "lastError" = NULL, "lastErrorCode" = NULL,
             "updatedAt" = NOW() WHERE "id" = $1`,
          [id],
        );
      },
      { isolationLevel: 'READ COMMITTED', workerBypassRls: true },
      this.pool,
    );
  }

  async persistRepositoryIntake(
    job: RepositoryIntakeJob,
    result: RepositoryIntakeResult,
    organizationDefaults: OrganizationDefaults,
  ): Promise<string> {
    return await withTransaction(
      async (client) => {
        await ensureOrganization(client, organizationDefaults);
        const repository = await queryOne<{ id: string }>(
          client,
          `INSERT INTO "Repository" (
             "id", "organizationId", "provider", "providerRepoId", "installationId", "owner",
             "name", "fullName", "visibility", "defaultBranch", "cloneUrl", "htmlUrl", "headSha",
             "lastIntakeAt", "createdAt", "updatedAt"
           ) VALUES (
             $1, $2, 'GITHUB', $3, $4, $5, $6, $7, $8::"RepositoryVisibility", $9, $10, $11,
             $12, NOW(), NOW(), NOW()
           )
           ON CONFLICT ("organizationId", "provider", "providerRepoId") DO UPDATE SET
             "installationId" = EXCLUDED."installationId", "owner" = EXCLUDED."owner",
             "name" = EXCLUDED."name", "fullName" = EXCLUDED."fullName",
             "visibility" = EXCLUDED."visibility", "defaultBranch" = EXCLUDED."defaultBranch",
             "cloneUrl" = EXCLUDED."cloneUrl", "htmlUrl" = EXCLUDED."htmlUrl",
             "headSha" = EXCLUDED."headSha", "lastIntakeAt" = NOW(), "updatedAt" = NOW()
           RETURNING "id"`,
          [
            randomUUID(),
            job.organizationId,
            result.repository.providerRepositoryId,
            job.installationId ? String(job.installationId) : null,
            result.repository.owner,
            result.repository.name,
            result.repository.fullName,
            result.repository.visibility,
            result.repository.defaultBranch,
            `https://github.com/${result.repository.fullName}.git`,
            result.repository.htmlUrl,
            result.repository.headSha,
          ],
        );
        if (!repository) throw new Error('Repository upsert returned no row');
        await client.query(
          `INSERT INTO "RepositoryIntake" (
             "id", "organizationId", "repositoryId", "requestedBy", "requestedUrl",
             "requestedBranch", "selectedBaseBranch", "status", "progress", "requestId",
             "requestedAt", "completedAt", "updatedAt"
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'READY', 100, $8, $9, NOW(), NOW())
           ON CONFLICT ("id") DO UPDATE SET
             "repositoryId" = EXCLUDED."repositoryId", "status" = 'READY', "progress" = 100,
             "selectedBaseBranch" = EXCLUDED."selectedBaseBranch", "completedAt" = NOW(),
             "updatedAt" = NOW()`,
          [
            job.intakeId,
            job.organizationId,
            repository.id,
            job.requestedBy,
            job.repositoryUrl,
            job.baseBranch ?? null,
            result.repository.selectedBaseBranch,
            job.requestId,
            new Date(job.requestedAt),
          ],
        );
        await client.query(
          `INSERT INTO "RepositoryWorktree" (
             "id", "repositoryId", "intakeId", "branchName", "baseBranch", "baseSha",
             "relativePath", "status", "createdAt"
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NOW())
           ON CONFLICT ("intakeId") DO UPDATE SET
             "branchName" = EXCLUDED."branchName", "baseBranch" = EXCLUDED."baseBranch",
             "baseSha" = EXCLUDED."baseSha", "relativePath" = EXCLUDED."relativePath",
             "status" = 'ACTIVE'`,
          [
            result.worktree.id,
            repository.id,
            job.intakeId,
            result.worktree.branchName,
            result.repository.selectedBaseBranch,
            result.worktree.baseSha,
            result.worktree.relativePath,
          ],
        );
        return repository.id;
      },
      { isolationLevel: 'SERIALIZABLE', maxRetries: 5, tenantOrganizationId: job.organizationId },
      this.pool,
    );
  }

  async markOutboxFailed(
    id: string,
    error: unknown,
    attempts: number,
    maxAttempts: number,
  ): Promise<void> {
    const status = attempts >= maxAttempts ? OutboxStatus.DEAD_LETTER : OutboxStatus.FAILED;
    const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    const message =
      error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown publish error';
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code).slice(0, 100)
        : null;
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE "OutboxMessage" SET "status" = $2::"OutboxStatus",
             "availableAt" = NOW() + ($3 * INTERVAL '1 second'), "lockedAt" = NULL,
             "lockedBy" = NULL, "lastError" = $4, "lastErrorCode" = $5, "updatedAt" = NOW()
           WHERE "id" = $1`,
          [id, status, delaySeconds, message, code],
        );
      },
      { isolationLevel: 'READ COMMITTED', workerBypassRls: true },
      this.pool,
    );
  }
}
