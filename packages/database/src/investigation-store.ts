import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  AgentRunStatus,
  GuardrailOutcome,
  InvestigationAgentKind,
  ModelInvocationStatus,
  ToolCallStatus,
} from '@codeer/contracts';
import {
  ActorRole,
  ActorType,
  AiPolicySchema,
  AiProvider,
  CitationSourceType,
  IncidentEventType,
  INVESTIGATION_OUTBOX_TOPIC,
  InvestigationEventSchema,
  InvestigationJobSchema,
  InvestigationSchema,
  InvestigationStatus,
  PlanApprovalDecision,
  TreatmentPlanSchema,
  TreatmentPlanStatus,
  type AiPolicy,
  type Diagnosis,
  type Investigation,
  type InvestigationCitation,
  type InvestigationEvent,
  type InvestigationJob,
  type InvestigationListQuery,
  type InvestigationToolCall,
  type PlanApprovalDecision as PlanDecision,
  type StartInvestigationInput,
  type TreatmentPlan,
} from '@codeer/contracts';
import {
  AI_POLICY_VERSION,
  PROMPT_TEMPLATE_VERSION,
  assertInvestigationTransition,
  type ContextSource,
  type InvestigationContextPackage,
  type ModelUsage,
  type ToolCallAudit,
} from '@codeer/ai';
import { buildIncidentEventHash, canonicalJson, digestPayload } from '@codeer/incidents';
import { sha256Hex } from '@codeer/security';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';
import {
  IdempotencyConflictError,
  OptimisticConcurrencyError,
  TenantResourceNotFoundError,
  type StoreActorContext,
} from './incident-store.js';

export interface CreateInvestigationCommand {
  context: StoreActorContext;
  incidentId: string;
  input: StartInvestigationInput;
  policy: AiPolicy;
  idempotencyKey?: string;
  idempotencyTtlSeconds: number;
}

export interface InvestigationSourceBundle {
  worktreeRelativePath: string;
  repositoryId: string;
  repositoryFullName: string;
  sources: ContextSource[];
}

export interface InvestigationEnvelope {
  id: string;
  organizationId: string;
  incidentId: string;
  reproductionId: string;
  requestedBy: string;
  input: StartInvestigationInput;
  policy: AiPolicy;
  policyId: string;
  promptTemplateVersion: string;
  cancellationRequestedAt: string | null;
  currentCheckpoint: number;
}

interface InvestigationRow {
  id: string;
  organizationId: string;
  incidentId: string;
  reproductionId: string;
  status: string;
  policyVersion: string;
  promptTemplateVersion: string;
  requestedBy: string;
  input: StartInvestigationInput;
  contextHash: string | null;
  currentCheckpoint: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancellationRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: string | number;
  createdAt: Date;
  updatedAt: Date;
}

interface TreatmentPlanRow {
  id: string;
  organizationId: string;
  incidentId: string;
  investigationId: string;
  diagnosisId: string;
  version: number;
  status: string;
  goal: string;
  risk: string;
  verificationMatrix: unknown;
  rollbackStrategy: string;
  compatibilityImpact: string;
  migrationImpact: string;
  knownLimitations: unknown;
  requiredApprovals: number;
  schemaVersion: string;
  contentHash: string;
  createdAt: Date;
  sequence: number | null;
  title: string | null;
  objective: string | null;
  affectedComponents: string[] | null;
  scopeRestrictions: unknown;
  stepRisk: string | null;
  securityConsiderations: unknown;
  verificationCommands: unknown;
  expectedResults: unknown;
  rollbackProcedure: string | null;
  citations: unknown;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapInvestigation(row: InvestigationRow): Investigation {
  return InvestigationSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    incidentId: row.incidentId,
    reproductionId: row.reproductionId,
    status: row.status,
    policyVersion: row.policyVersion,
    promptTemplateVersion: row.promptTemplateVersion,
    contextHash: row.contextHash,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: iso(row.leaseExpiresAt),
    cancellationRequestedAt: iso(row.cancellationRequestedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    estimatedCostUsd: Number(row.estimatedCostUsd),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function appendIncidentEvent(
  client: PoolClient,
  command: {
    incidentId: string;
    type: IncidentEventType;
    payload: unknown;
    actorType: ActorType;
    actorId: string;
    requestId: string;
    correlationId: string;
  },
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.incidentId]);
  const latest = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence", "eventHash" FROM "IncidentEvent"
       WHERE "incidentId"=$1 ORDER BY "sequence" DESC LIMIT 1 FOR UPDATE`,
    [command.incidentId],
  );
  const id = randomUUID();
  const sequence = (latest?.sequence ?? 0) + 1;
  const occurredAt = new Date();
  const eventHash = buildIncidentEventHash({
    incidentId: command.incidentId,
    sequence,
    type: command.type,
    payload: command.payload,
    occurredAt: occurredAt.toISOString(),
    actorType: command.actorType,
    actorId: command.actorId,
    requestId: command.requestId,
    correlationId: command.correlationId,
    ...(latest?.eventHash ? { previousHash: latest.eventHash } : {}),
  });
  await client.query(
    `INSERT INTO "IncidentEvent" (
      "id","incidentId","sequence","type","payload","actorType","actorId",
      "requestId","correlationId","previousHash","eventHash","occurredAt","createdAt"
    ) VALUES ($1,$2,$3,$4::"IncidentEventType",$5::jsonb,$6::"ActorType",$7,$8,$9,$10,$11,$12,NOW())`,
    [
      id,
      command.incidentId,
      sequence,
      command.type,
      canonicalJson(command.payload),
      command.actorType,
      command.actorId,
      command.requestId,
      command.correlationId,
      latest?.eventHash ?? null,
      eventHash,
      occurredAt,
    ],
  );
}

async function appendAudit(
  client: PoolClient,
  context: StoreActorContext,
  incidentId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: unknown,
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE' = 'SUCCESS',
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    context.organizationId,
  ]);
  const latest = await queryOne<{ auditHash: string }>(
    client,
    `SELECT "auditHash" FROM "AuditLog" WHERE "organizationId"=$1
      ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
    [context.organizationId],
  );
  const id = randomUUID();
  const createdAt = new Date();
  const auditHash = digestPayload({
    id,
    organizationId: context.organizationId,
    incidentId,
    action,
    resourceType,
    resourceId,
    actorType: context.actorType,
    actorId: context.actorId,
    outcome,
    requestId: context.requestId,
    correlationId: context.correlationId,
    metadata,
    previousHash: latest?.auditHash ?? null,
    createdAt: createdAt.toISOString(),
  });
  await client.query(
    `INSERT INTO "AuditLog" (
      "id","organizationId","incidentId","action","resourceType","resourceId",
      "actorType","actorId","outcome","requestId","correlationId","metadata",
      "previousHash","auditHash","createdAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::"ActorType",$8,$9::"AuditOutcome",$10,$11,$12::jsonb,$13,$14,$15)`,
    [
      id,
      context.organizationId,
      incidentId,
      action,
      resourceType,
      resourceId,
      context.actorType,
      context.actorId,
      outcome,
      context.requestId,
      context.correlationId,
      canonicalJson(metadata),
      latest?.auditHash ?? null,
      auditHash,
      createdAt,
    ],
  );
}

async function appendInvestigationEvent(
  client: PoolClient,
  command: {
    investigationId: string;
    type: string;
    payload: unknown;
    actorType: ActorType;
    actorId?: string | null;
    requestId?: string | null;
    correlationId?: string | null;
  },
): Promise<InvestigationEvent> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    command.investigationId,
  ]);
  const latest = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence","eventHash" FROM "InvestigationEvent"
      WHERE "investigationId"=$1 ORDER BY "sequence" DESC LIMIT 1 FOR UPDATE`,
    [command.investigationId],
  );
  const id = randomUUID();
  const sequence = (latest?.sequence ?? 0) + 1;
  const occurredAt = new Date();
  const eventHash = digestPayload({
    id,
    investigationId: command.investigationId,
    sequence,
    type: command.type,
    payload: command.payload,
    actorType: command.actorType,
    actorId: command.actorId ?? null,
    requestId: command.requestId ?? null,
    correlationId: command.correlationId ?? null,
    previousHash: latest?.eventHash ?? null,
    occurredAt: occurredAt.toISOString(),
  });
  await client.query(
    `INSERT INTO "InvestigationEvent" (
      "id","investigationId","sequence","type","payload","previousHash","eventHash",
      "actorType","actorId","requestId","correlationId","occurredAt","createdAt"
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::"ActorType",$9,$10,$11,$12,NOW())`,
    [
      id,
      command.investigationId,
      sequence,
      command.type,
      canonicalJson(command.payload),
      latest?.eventHash ?? null,
      eventHash,
      command.actorType,
      command.actorId ?? null,
      command.requestId ?? null,
      command.correlationId ?? null,
      occurredAt,
    ],
  );
  return InvestigationEventSchema.parse({
    id,
    investigationId: command.investigationId,
    sequence,
    type: command.type,
    payload: command.payload,
    previousHash: latest?.eventHash ?? null,
    eventHash,
    occurredAt: occurredAt.toISOString(),
  });
}

function parseCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof value.createdAt !== 'string' || typeof value.id !== 'string') throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new Error('Investigation cursor is invalid.');
  }
}

function encodeCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(row), 'utf8').toString('base64url');
}

async function assertInvestigationLease(
  client: PoolClient,
  organizationId: string,
  investigationId: string,
  leaseOwner: string,
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    client,
    `SELECT "id" FROM "InvestigationRun"
      WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3
        AND "leaseExpiresAt">NOW() FOR UPDATE`,
    [investigationId, organizationId, leaseOwner],
  );
  if (!row) throw new Error('Investigation execution lease was lost.');
}

export class InvestigationStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async createInvestigation(command: CreateInvestigationCommand): Promise<Investigation> {
    const requestHash = digestPayload({ incidentId: command.incidentId, input: command.input });
    return await withTransaction(
      async (client) => {
        if (command.idempotencyKey) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `${command.context.organizationId}:investigation.create:${command.idempotencyKey}`,
          ]);
          const previous = await queryOne<{
            requestHash: string;
            response: Investigation;
            expiresAt: Date;
          }>(
            client,
            `SELECT "requestHash","response","expiresAt" FROM "IdempotencyRecord"
              WHERE "organizationId"=$1 AND "scope"='investigation.create' AND "key"=$2`,
            [command.context.organizationId, command.idempotencyKey],
          );
          if (previous && previous.expiresAt > new Date()) {
            if (previous.requestHash !== requestHash) throw new IdempotencyConflictError();
            return InvestigationSchema.parse(previous.response);
          }
        }

        const reproduction = await queryOne<{
          id: string;
          status: string;
          result: string | null;
          incidentId: string;
        }>(
          client,
          `SELECT r."id",r."status",r."result",r."incidentId"
             FROM "FailureReproduction" r
             JOIN "Incident" i ON i."id"=r."incidentId"
            WHERE r."id"=$1 AND r."incidentId"=$2 AND r."organizationId"=$3
              AND i."organizationId"=$3 FOR UPDATE OF i`,
          [command.input.reproductionId, command.incidentId, command.context.organizationId],
        );
        if (!reproduction) throw new TenantResourceNotFoundError('Failure reproduction');
        if (reproduction.status !== 'COMPLETED' || reproduction.result !== 'REPRODUCED') {
          throw new Error('Investigation requires a completed, reproduced failure.');
        }

        const running = await queryOne<{ count: string }>(
          client,
          `SELECT COUNT(*)::text AS count FROM "InvestigationRun"
            WHERE "organizationId"=$1 AND "status" NOT IN (
              'APPROVED','REJECTED','POLICY_BLOCKED','INSUFFICIENT_EVIDENCE','CANCELLED',
              'TIMED_OUT','MODEL_FAILED','TOOL_FAILED','BUDGET_EXCEEDED','SECURITY_REJECTED'
            )`,
          [command.context.organizationId],
        );
        if (Number(running?.count ?? 0) >= command.policy.maximumConcurrentInvestigations) {
          throw new Error('Organization investigation concurrency limit was reached.');
        }

        const policyId = await this.upsertPolicyInTransaction(
          client,
          command.context.organizationId,
          command.context.actorId,
          command.policy,
        );
        const id = randomUUID();
        await client.query(
          `INSERT INTO "InvestigationRun" (
            "id","organizationId","incidentId","reproductionId","aiPolicyId","status",
            "promptTemplateVersion","requestedBy","input","totalInputTokens","totalOutputTokens",
            "estimatedCostUsd","createdAt","updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6,$7,$8::jsonb,0,0,0,NOW(),NOW())`,
          [
            id,
            command.context.organizationId,
            command.incidentId,
            command.input.reproductionId,
            policyId,
            PROMPT_TEMPLATE_VERSION,
            command.context.actorId,
            canonicalJson(command.input),
          ],
        );

        const job: InvestigationJob = InvestigationJobSchema.parse({
          investigationId: id,
          incidentId: command.incidentId,
          organizationId: command.context.organizationId,
          reproductionId: command.input.reproductionId,
          requestedBy: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
          requestedAt: new Date().toISOString(),
          attempt: 1,
        });
        await client.query(
          `INSERT INTO "OutboxMessage" (
            "id","organizationId","topic","partitionKey","deduplicationKey","payload",
            "status","attempts","availableAt","createdAt","updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,NOW(),NOW(),NOW())
          ON CONFLICT ("deduplicationKey") DO NOTHING`,
          [
            randomUUID(),
            command.context.organizationId,
            INVESTIGATION_OUTBOX_TOPIC,
            id,
            `investigation.execute:${id}:1`,
            canonicalJson(job),
          ],
        );
        await appendInvestigationEvent(client, {
          investigationId: id,
          type: 'INVESTIGATION_REQUESTED',
          payload: {
            reproductionId: command.input.reproductionId,
            policyVersion: command.policy.policyVersion,
            promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
          },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        await appendIncidentEvent(client, {
          incidentId: command.incidentId,
          type: IncidentEventType.INVESTIGATION_REQUESTED,
          payload: { investigationId: id, reproductionId: command.input.reproductionId },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        await appendAudit(
          client,
          command.context,
          command.incidentId,
          'investigation.request',
          'InvestigationRun',
          id,
          {
            reproductionId: command.input.reproductionId,
            policyVersion: command.policy.policyVersion,
          },
        );
        const response = await this.getInvestigationInTransaction(
          client,
          command.context.organizationId,
          id,
        );
        if (command.idempotencyKey) {
          await client.query(
            `INSERT INTO "IdempotencyRecord" (
              "id","organizationId","scope","key","requestHash","response","statusCode",
              "resourceId","expiresAt","createdAt"
            ) VALUES ($1,$2,'investigation.create',$3,$4,$5::jsonb,202,$6,NOW()+($7*INTERVAL '1 second'),NOW())
            ON CONFLICT ("organizationId","scope","key") DO UPDATE SET
              "requestHash"=EXCLUDED."requestHash","response"=EXCLUDED."response",
              "resourceId"=EXCLUDED."resourceId","expiresAt"=EXCLUDED."expiresAt"`,
            [
              randomUUID(),
              command.context.organizationId,
              command.idempotencyKey,
              requestHash,
              canonicalJson(response),
              id,
              command.idempotencyTtlSeconds,
            ],
          );
        }
        return response;
      },
      {
        tenantOrganizationId: command.context.organizationId,
        isolationLevel: 'SERIALIZABLE',
      },
      this.pool,
    );
  }

  async listInvestigations(
    organizationId: string,
    incidentId: string,
    query: InvestigationListQuery,
  ): Promise<{ items: Investigation[]; nextCursor: string | null }> {
    return await withTransaction(
      async (client) => {
        const cursor = query.cursor ? parseCursor(query.cursor) : undefined;
        const values: unknown[] = [organizationId, incidentId, query.limit + 1];
        let cursorSql = '';
        if (cursor) {
          values.push(cursor.createdAt, cursor.id);
          cursorSql = `AND ("createdAt","id") < ($4::timestamptz,$5::uuid)`;
        }
        if (query.status) values.push(query.status);
        const statusPosition = query.status ? values.length : 0;
        const rows = await queryMany<InvestigationRow>(
          client,
          `SELECT r.*,p."policyVersion" FROM "InvestigationRun" r
             JOIN "OrganizationAiPolicy" p ON p."id"=r."aiPolicyId"
            WHERE r."organizationId"=$1 AND r."incidentId"=$2
              ${cursorSql}
              ${query.status ? `AND r."status"=$${statusPosition}::"InvestigationStatus"` : ''}
            ORDER BY r."createdAt" DESC,r."id" DESC LIMIT $3`,
          values,
        );
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit).map(mapInvestigation);
        const last = page.at(-1);
        return {
          items: page,
          nextCursor:
            hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listOrganizationInvestigations(
    organizationId: string,
    query: InvestigationListQuery,
  ): Promise<{ items: Investigation[]; nextCursor: null }> {
    return await withTransaction(
      async (client) => {
        const values: unknown[] = [organizationId, query.limit];
        const statusSql = query.status ? `AND r."status"=$3::"InvestigationStatus"` : '';
        if (query.status) values.push(query.status);
        const rows = await queryMany<InvestigationRow>(
          client,
          `SELECT r.*,p."policyVersion" FROM "InvestigationRun" r
             JOIN "OrganizationAiPolicy" p ON p."id"=r."aiPolicyId"
            WHERE r."organizationId"=$1 ${statusSql}
            ORDER BY r."createdAt" DESC,r."id" DESC LIMIT $2`,
          values,
        );
        return { items: rows.map(mapInvestigation), nextCursor: null };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async getInvestigation(organizationId: string, investigationId: string): Promise<Investigation> {
    return await withTransaction(
      (client) => this.getInvestigationInTransaction(client, organizationId, investigationId),
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listEvents(
    organizationId: string,
    investigationId: string,
    afterSequence = 0,
    limit = 100,
  ): Promise<InvestigationEvent[]> {
    return await withTransaction(
      async (client) => {
        await this.assertTenantInvestigation(client, organizationId, investigationId);
        const rows = await queryMany<{
          id: string;
          investigationId: string;
          sequence: number;
          type: string;
          payload: Record<string, unknown>;
          previousHash: string | null;
          eventHash: string;
          occurredAt: Date;
        }>(
          client,
          `SELECT "id","investigationId","sequence","type","payload","previousHash","eventHash","occurredAt"
             FROM "InvestigationEvent" WHERE "investigationId"=$1 AND "sequence">$2
             ORDER BY "sequence" LIMIT $3`,
          [investigationId, afterSequence, Math.min(Math.max(limit, 1), 500)],
        );
        return rows.map((row) =>
          InvestigationEventSchema.parse({
            ...row,
            occurredAt: row.occurredAt.toISOString(),
          }),
        );
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listToolCalls(
    organizationId: string,
    investigationId: string,
    limit = 100,
  ): Promise<InvestigationToolCall[]> {
    return await withTransaction(
      async (client) => {
        await this.assertTenantInvestigation(client, organizationId, investigationId);
        const rows = await queryMany<{
          id: string;
          investigationId: string;
          agentKind: InvestigationAgentKind;
          toolName: string;
          status: ToolCallStatus;
          inputHash: string;
          outputHash: string | null;
          deniedReason: string | null;
          durationMs: number | null;
          createdAt: Date;
        }>(
          client,
          `SELECT t."id",t."investigationId",a."agentKind",t."toolName",t."status",
                  t."inputHash",t."outputHash",t."deniedReason",t."durationMs",t."createdAt"
             FROM "InvestigationToolCall" t JOIN "AgentRun" a ON a."id"=t."agentRunId"
            WHERE t."organizationId"=$1 AND t."investigationId"=$2
            ORDER BY t."createdAt" DESC LIMIT $3`,
          [organizationId, investigationId, Math.min(Math.max(limit, 1), 500)],
        );
        return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async requestCancellation(
    context: StoreActorContext,
    investigationId: string,
  ): Promise<Investigation> {
    return await withTransaction(
      async (client) => {
        const row = await this.getInvestigationRow(
          client,
          context.organizationId,
          investigationId,
          true,
        );
        if (!row) throw new TenantResourceNotFoundError('Investigation');
        if (
          [
            InvestigationStatus.APPROVED,
            InvestigationStatus.REJECTED,
            InvestigationStatus.CANCELLED,
            InvestigationStatus.POLICY_BLOCKED,
            InvestigationStatus.SECURITY_REJECTED,
          ].includes(row.status as InvestigationStatus)
        ) {
          return mapInvestigation(row);
        }
        await client.query(
          `UPDATE "InvestigationRun" SET "cancellationRequestedAt"=COALESCE("cancellationRequestedAt",NOW()),
             "updatedAt"=NOW() WHERE "id"=$1 AND "organizationId"=$2`,
          [investigationId, context.organizationId],
        );
        await appendInvestigationEvent(client, {
          investigationId,
          type: 'INVESTIGATION_CANCELLATION_REQUESTED',
          payload: {},
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        await appendAudit(
          client,
          context,
          row.incidentId,
          'investigation.cancel.request',
          'InvestigationRun',
          investigationId,
          {},
        );
        return await this.getInvestigationInTransaction(
          client,
          context.organizationId,
          investigationId,
        );
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async resumeInvestigation(
    context: StoreActorContext,
    investigationId: string,
  ): Promise<Investigation> {
    return await withTransaction(
      async (client) => {
        const row = await this.getInvestigationRow(
          client,
          context.organizationId,
          investigationId,
          true,
        );
        if (!row) throw new TenantResourceNotFoundError('Investigation');
        const retryable = new Set([
          InvestigationStatus.INSUFFICIENT_EVIDENCE,
          InvestigationStatus.TIMED_OUT,
          InvestigationStatus.MODEL_FAILED,
          InvestigationStatus.TOOL_FAILED,
          InvestigationStatus.REVISION_REQUESTED,
        ]);
        if (!retryable.has(row.status as InvestigationStatus)) {
          throw new Error(`Investigation in ${row.status} cannot be resumed.`);
        }
        assertInvestigationTransition(
          row.status as InvestigationStatus,
          InvestigationStatus.POLICY_CHECK,
        );
        await client.query(
          `UPDATE "InvestigationRun" SET "status"='REQUESTED',"leaseOwner"=NULL,
             "leaseExpiresAt"=NULL,"cancellationRequestedAt"=NULL,"errorCode"=NULL,
             "errorMessage"=NULL,"completedAt"=NULL,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [investigationId, context.organizationId],
        );
        const nextAttempt = row.currentCheckpoint + 1;
        const job = InvestigationJobSchema.parse({
          investigationId,
          incidentId: row.incidentId,
          organizationId: row.organizationId,
          reproductionId: row.reproductionId,
          requestedBy: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          requestedAt: new Date().toISOString(),
          attempt: Math.max(1, nextAttempt),
        });
        await client.query(
          `INSERT INTO "OutboxMessage" (
             "id","organizationId","topic","partitionKey","deduplicationKey","payload",
             "status","attempts","availableAt","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,NOW(),NOW(),NOW())
           ON CONFLICT ("deduplicationKey") DO NOTHING`,
          [
            randomUUID(),
            context.organizationId,
            INVESTIGATION_OUTBOX_TOPIC,
            investigationId,
            `investigation.execute:${investigationId}:${nextAttempt}`,
            canonicalJson(job),
          ],
        );
        await appendInvestigationEvent(client, {
          investigationId,
          type: 'INVESTIGATION_RESUMED',
          payload: { attempt: nextAttempt },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        return await this.getInvestigationInTransaction(
          client,
          context.organizationId,
          investigationId,
        );
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async acquireLease(
    investigationId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<InvestigationEnvelope | null> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{
          id: string;
          organizationId: string;
          incidentId: string;
          reproductionId: string;
          requestedBy: string;
          input: StartInvestigationInput;
          currentCheckpoint: number;
          cancellationRequestedAt: Date | null;
          aiPolicyId: string;
          promptTemplateVersion: string;
        }>(
          client,
          `UPDATE "InvestigationRun" SET "leaseOwner"=$2,
             "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),"heartbeatAt"=NOW(),
             "startedAt"=COALESCE("startedAt",NOW()),"updatedAt"=NOW()
            WHERE "id"=$1 AND ("leaseOwner" IS NULL OR "leaseExpiresAt"<NOW() OR "leaseOwner"=$2)
              AND "status" NOT IN ('APPROVED','REJECTED','POLICY_BLOCKED','CANCELLED','BUDGET_EXCEEDED','SECURITY_REJECTED')
            RETURNING "id","organizationId","incidentId","reproductionId","requestedBy","input",
                      "currentCheckpoint","cancellationRequestedAt","aiPolicyId","promptTemplateVersion"`,
          [investigationId, workerId, Math.min(Math.max(leaseSeconds, 15), 900)],
        );
        if (!row) return null;
        const policyRow = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM "OrganizationAiPolicy" WHERE "id"=$1`,
          [row.aiPolicyId],
        );
        if (!policyRow) throw new Error('Investigation AI policy snapshot was not found.');
        return {
          id: row.id,
          organizationId: row.organizationId,
          incidentId: row.incidentId,
          reproductionId: row.reproductionId,
          requestedBy: row.requestedBy,
          input: row.input,
          policy: this.mapPolicy(policyRow),
          policyId: row.aiPolicyId,
          promptTemplateVersion: row.promptTemplateVersion,
          cancellationRequestedAt: iso(row.cancellationRequestedAt),
          currentCheckpoint: row.currentCheckpoint,
        };
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async heartbeat(
    organizationId: string,
    investigationId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<{ cancellationRequested: boolean }> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{ cancellationRequestedAt: Date | null }>(
          client,
          `UPDATE "InvestigationRun" SET "leaseExpiresAt"=NOW()+($4*INTERVAL '1 second'),
             "heartbeatAt"=NOW(),"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3 AND "leaseExpiresAt">NOW()
            RETURNING "cancellationRequestedAt"`,
          [investigationId, organizationId, workerId, Math.min(Math.max(leaseSeconds, 15), 900)],
        );
        if (!row) throw new Error('Investigation execution lease was lost.');
        return { cancellationRequested: Boolean(row.cancellationRequestedAt) };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async checkpoint(
    organizationId: string,
    investigationId: string,
    workerId: string,
    nextStatus: InvestigationStatus,
    state: unknown,
    eventType: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertInvestigationLease(client, organizationId, investigationId, workerId);
        const current = await queryOne<{ status: InvestigationStatus; currentCheckpoint: number }>(
          client,
          `SELECT "status","currentCheckpoint" FROM "InvestigationRun"
            WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [investigationId, organizationId],
        );
        if (!current) throw new TenantResourceNotFoundError('Investigation');
        assertInvestigationTransition(current.status, nextStatus);
        const sequence = current.currentCheckpoint + 1;
        const stateHash = digestPayload({ investigationId, sequence, nextStatus, state });
        await client.query(
          `INSERT INTO "InvestigationCheckpoint" (
            "id","investigationId","sequence","stage","state","stateHash","leaseOwner","occurredAt","createdAt"
          ) VALUES ($1,$2,$3,$4::"InvestigationStatus",$5::jsonb,$6,$7,NOW(),NOW())`,
          [
            randomUUID(),
            investigationId,
            sequence,
            nextStatus,
            canonicalJson(state),
            stateHash,
            workerId,
          ],
        );
        await client.query(
          `UPDATE "InvestigationRun" SET "status"=$3::"InvestigationStatus",
             "currentCheckpoint"=$4,"updatedAt"=NOW() WHERE "id"=$1 AND "organizationId"=$2`,
          [investigationId, organizationId, nextStatus, sequence],
        );
        await appendInvestigationEvent(client, {
          investigationId,
          type: eventType,
          payload: { checkpoint: sequence, status: nextStatus, stateHash },
          actorType: ActorType.SERVICE,
          actorId: workerId,
        });
      },
      { tenantOrganizationId: organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async recordContextPackage(
    organizationId: string,
    investigationId: string,
    workerId: string,
    context: InvestigationContextPackage,
    retentionDays: number,
  ): Promise<string> {
    return await withTransaction(
      async (client) => {
        await assertInvestigationLease(client, organizationId, investigationId, workerId);
        const id = randomUUID();
        const redactions = context.items.reduce((sum, item) => sum + item.redactionCount, 0);
        const suspicious = context.items.reduce(
          (sum, item) => sum + item.suspiciousInstructionCount,
          0,
        );
        const inserted = await queryOne<{ id: string }>(
          client,
          `INSERT INTO "InvestigationContextPackage" (
             "id","organizationId","investigationId","schemaVersion","contentHash","totalBytes",
             "truncated","redactionCount","suspiciousInstructionCount","retentionUntil","createdAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+($10*INTERVAL '1 day'),NOW())
           ON CONFLICT ("investigationId","contentHash") DO UPDATE SET "contentHash"=EXCLUDED."contentHash"
           RETURNING "id"`,
          [
            id,
            organizationId,
            investigationId,
            context.schemaVersion,
            context.contentHash,
            context.totalBytes,
            context.truncated,
            redactions,
            suspicious,
            Math.min(Math.max(retentionDays, 1), 3650),
          ],
        );
        const packageId = inserted?.id ?? id;
        for (const item of context.items) {
          await client.query(
            `INSERT INTO "InvestigationContextItem" (
              "id","contextPackageId","sourceType","sourceId","label","digest","path",
              "lineStart","lineEnd","sensitivity","byteSize","redactionCount",
              "suspiciousInstructionCount","content","createdAt"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
            ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              packageId,
              item.sourceType,
              item.sourceId,
              item.label,
              item.digest,
              item.path ?? null,
              item.lineStart ?? null,
              item.lineEnd ?? null,
              item.sensitivity ?? null,
              item.byteSize,
              item.redactionCount,
              item.suspiciousInstructionCount,
              canonicalJson(item.content),
            ],
          );
        }
        await client.query(
          `UPDATE "InvestigationRun" SET "contextHash"=$3,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [investigationId, organizationId, context.contentHash],
        );
        return packageId;
      },
      { tenantOrganizationId: organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async startAgentRun(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    agentKind: InvestigationAgentKind;
    model: string;
    promptTemplateVersion: string;
    inputHash: string;
  }): Promise<{ agentRunId: string; promptTemplateVersionId: string }> {
    return await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        const prompt = await queryOne<{ id: string }>(
          client,
          `SELECT "id" FROM "PromptTemplateVersion"
            WHERE "name"='codeer-investigation' AND "version"=$1 AND "agentKind"=$2::"InvestigationAgentKind"
            ORDER BY "createdAt" DESC LIMIT 1`,
          [command.promptTemplateVersion, command.agentKind],
        );
        if (!prompt)
          throw new Error(`Prompt template ${command.promptTemplateVersion} is missing.`);
        const id = randomUUID();
        await client.query(
          `INSERT INTO "AgentRun" (
             "id","investigationId","agentKind","status","model","promptTemplateVersionId",
             "inputHash","startedAt","createdAt","updatedAt"
           ) VALUES ($1,$2,$3::"InvestigationAgentKind",'RUNNING',$4,$5,$6,NOW(),NOW(),NOW())`,
          [
            id,
            command.investigationId,
            command.agentKind,
            command.model,
            prompt.id,
            command.inputHash,
          ],
        );
        return { agentRunId: id, promptTemplateVersionId: prompt.id };
      },
      { tenantOrganizationId: command.organizationId },
      this.pool,
    );
  }

  async finishAgentRun(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    agentRunId: string;
    status: AgentRunStatus;
    outputHash?: string;
    summary?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        await client.query(
          `UPDATE "AgentRun" SET "status"=$4::"AgentRunStatus","outputHash"=$5,
             "conciseDecisionSummary"=$6,"errorCode"=$7,"errorMessage"=$8,
             "completedAt"=NOW(),"updatedAt"=NOW()
            WHERE "id"=$1 AND "investigationId"=$2
              AND EXISTS (SELECT 1 FROM "InvestigationRun" r WHERE r."id"=$2 AND r."organizationId"=$3)`,
          [
            command.agentRunId,
            command.investigationId,
            command.organizationId,
            command.status,
            command.outputHash ?? null,
            command.summary?.slice(0, 8_000) ?? null,
            command.errorCode ?? null,
            command.errorMessage?.slice(0, 2_000) ?? null,
          ],
        );
      },
      { tenantOrganizationId: command.organizationId },
      this.pool,
    );
  }

  async recordModelInvocation(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    agentRunId: string;
    model: string;
    status: ModelInvocationStatus;
    providerRequestId?: string;
    providerResponseId?: string;
    instructionsHash: string;
    inputHash: string;
    outputHash?: string;
    schemaName: string;
    schemaVersion: string;
    usage?: ModelUsage;
    estimatedCostUsd?: number;
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<string> {
    return await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        const id = randomUUID();
        const usage = command.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        };
        await client.query(
          `INSERT INTO "ModelInvocation" (
            "id","organizationId","investigationId","agentRunId","provider","model","status",
            "providerRequestId","providerResponseId","instructionsHash","inputHash","outputHash",
            "schemaName","schemaVersion","inputTokens","cachedInputTokens","outputTokens",
            "reasoningTokens","estimatedCostUsd","durationMs","errorCode","errorMessage",
            "startedAt","completedAt","createdAt"
          ) VALUES ($1,$2,$3,$4,'OPENAI',$5,$6::"ModelInvocationStatus",$7,$8,$9,$10,$11,$12,$13,
                    $14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW(),NOW())`,
          [
            id,
            command.organizationId,
            command.investigationId,
            command.agentRunId,
            command.model,
            command.status,
            command.providerRequestId ?? null,
            command.providerResponseId ?? null,
            command.instructionsHash,
            command.inputHash,
            command.outputHash ?? null,
            command.schemaName,
            command.schemaVersion,
            usage.inputTokens,
            usage.cachedInputTokens,
            usage.outputTokens,
            usage.reasoningTokens,
            command.estimatedCostUsd ?? 0,
            command.durationMs ?? null,
            command.errorCode ?? null,
            command.errorMessage?.slice(0, 2_000) ?? null,
          ],
        );
        await client.query(
          `INSERT INTO "AiUsageLedger" (
             "id","organizationId","investigationId","modelInvocationId","provider","model",
             "inputTokens","cachedInputTokens","outputTokens","reasoningTokens","estimatedCostUsd",
             "occurredAt","createdAt"
           ) VALUES ($1,$2,$3,$4,'OPENAI',$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
          [
            randomUUID(),
            command.organizationId,
            command.investigationId,
            id,
            command.model,
            usage.inputTokens,
            usage.cachedInputTokens,
            usage.outputTokens,
            usage.reasoningTokens,
            command.estimatedCostUsd ?? 0,
          ],
        );
        await client.query(
          `UPDATE "InvestigationRun" SET
             "totalInputTokens"="totalInputTokens"+$3,
             "totalOutputTokens"="totalOutputTokens"+$4,
             "estimatedCostUsd"="estimatedCostUsd"+$5,
             "updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [
            command.investigationId,
            command.organizationId,
            usage.inputTokens,
            usage.outputTokens,
            command.estimatedCostUsd ?? 0,
          ],
        );
        return id;
      },
      { tenantOrganizationId: command.organizationId },
      this.pool,
    );
  }

  async recordToolCall(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    agentRunId: string;
    audit: ToolCallAudit;
    inputSummary: unknown;
    outputSummary?: unknown;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        await client.query(
          `INSERT INTO "InvestigationToolCall" (
            "id","organizationId","investigationId","agentRunId","toolName","status","inputHash",
            "outputHash","inputSummary","outputSummary","deniedReason","durationMs","leaseOwner",
            "createdAt","completedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6::"ToolCallStatus",$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,NOW(),NOW())`,
          [
            command.audit.id,
            command.organizationId,
            command.investigationId,
            command.agentRunId,
            command.audit.toolName,
            command.audit.status,
            command.audit.inputHash,
            command.audit.outputHash,
            canonicalJson(command.inputSummary),
            canonicalJson(command.outputSummary ?? null),
            command.audit.deniedReason,
            command.audit.durationMs,
            command.workerId,
          ],
        );
      },
      { tenantOrganizationId: command.organizationId },
      this.pool,
    );
  }

  async recordGuardrail(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    agentRunId?: string;
    category: string;
    outcome: GuardrailOutcome;
    reason: string;
    policyVersion: string;
    inputHash: string;
    details: unknown;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        const id = randomUUID();
        const decisionHash = digestPayload({ ...command, id });
        await client.query(
          `INSERT INTO "GuardrailDecision" (
            "id","investigationId","agentRunId","category","outcome","reason","policyVersion",
            "inputHash","details","decisionHash","createdAt"
          ) VALUES ($1,$2,$3,$4,$5::"GuardrailOutcome",$6,$7,$8,$9::jsonb,$10,NOW())`,
          [
            id,
            command.investigationId,
            command.agentRunId ?? null,
            command.category,
            command.outcome,
            command.reason,
            command.policyVersion,
            command.inputHash,
            canonicalJson(command.details),
            decisionHash,
          ],
        );
      },
      { tenantOrganizationId: command.organizationId },
      this.pool,
    );
  }

  async saveDiagnosisAndPlan(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    diagnosis: Diagnosis;
    plan: TreatmentPlan;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        const run = await queryOne<{ incidentId: string }>(
          client,
          `SELECT "incidentId" FROM "InvestigationRun"
            WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [command.investigationId, command.organizationId],
        );
        if (!run) throw new TenantResourceNotFoundError('Investigation');
        await client.query(
          `INSERT INTO "Diagnosis" (
            "id","organizationId","incidentId","investigationId","summary","failureMechanism",
            "blastRadius","securityImpact","confidence","confidenceBand","unknowns","citations",
            "schemaVersion","contentHash","createdAt"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,NOW())`,
          [
            command.diagnosis.id,
            command.organizationId,
            run.incidentId,
            command.investigationId,
            command.diagnosis.summary,
            command.diagnosis.failureMechanism,
            command.diagnosis.blastRadius,
            command.diagnosis.securityImpact,
            command.diagnosis.confidence,
            command.diagnosis.confidenceBand,
            canonicalJson(command.diagnosis.unknowns),
            canonicalJson(command.diagnosis.citations),
            command.diagnosis.schemaVersion,
            command.diagnosis.contentHash,
          ],
        );
        for (const hypothesis of command.diagnosis.hypotheses) {
          await client.query(
            `INSERT INTO "RootCauseHypothesis" (
              "id","investigationId","disposition","title","mechanism","confidence",
              "supportingEvidence","contradictingEvidence","missingEvidence","assumptions",
              "contentHash","createdAt"
            ) VALUES ($1,$2,$3::"HypothesisDisposition",$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,NOW())`,
            [
              hypothesis.id,
              command.investigationId,
              hypothesis.disposition,
              hypothesis.title,
              hypothesis.mechanism,
              hypothesis.confidence,
              canonicalJson(hypothesis.supportingEvidence),
              canonicalJson(hypothesis.contradictingEvidence),
              canonicalJson(hypothesis.missingEvidence),
              canonicalJson(hypothesis.assumptions),
              sha256Hex(canonicalJson(hypothesis)),
            ],
          );
        }
        const uniqueCitations = new Map<string, InvestigationCitation>();
        for (const citation of [
          ...command.diagnosis.citations,
          ...command.diagnosis.hypotheses.flatMap((hypothesis) => [
            ...hypothesis.supportingEvidence,
            ...hypothesis.contradictingEvidence,
          ]),
        ]) {
          const key = canonicalJson(citation);
          uniqueCitations.set(key, citation);
        }
        for (const citation of uniqueCitations.values()) {
          await client.query(
            `INSERT INTO "DiagnosisEvidenceLink" (
              "id","diagnosisId","sourceType","sourceId","digest","path","lineStart","lineEnd","label","createdAt"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              command.diagnosis.id,
              citation.sourceType,
              citation.sourceId,
              citation.digest,
              citation.path ?? null,
              citation.lineStart ?? null,
              citation.lineEnd ?? null,
              citation.label,
            ],
          );
        }
        await client.query(
          `INSERT INTO "TreatmentPlan" (
            "id","organizationId","incidentId","investigationId","diagnosisId","version","status",
            "goal","risk","verificationMatrix","rollbackStrategy","compatibilityImpact","migrationImpact",
            "knownLimitations","requiredApprovals","schemaVersion","contentHash","createdAt","updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::"TreatmentPlanStatus",$8,$9::"RiskLevel",$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,$17,NOW(),NOW())`,
          [
            command.plan.id,
            command.organizationId,
            run.incidentId,
            command.investigationId,
            command.diagnosis.id,
            command.plan.version,
            command.plan.status,
            command.plan.goal,
            command.plan.risk,
            canonicalJson(command.plan.verificationMatrix),
            command.plan.rollbackStrategy,
            command.plan.compatibilityImpact,
            command.plan.migrationImpact,
            canonicalJson(command.plan.knownLimitations),
            command.plan.requiredApprovals,
            command.plan.schemaVersion,
            command.plan.contentHash,
          ],
        );
        for (const step of command.plan.steps) {
          await client.query(
            `INSERT INTO "TreatmentPlanStep" (
              "id","planId","sequence","title","objective","affectedComponents","scopeRestrictions",
              "risk","securityConsiderations","verificationCommands","expectedResults","rollbackProcedure",
              "citations","createdAt"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::"RiskLevel",$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,NOW())`,
            [
              randomUUID(),
              command.plan.id,
              step.sequence,
              step.title,
              step.objective,
              step.affectedComponents,
              canonicalJson(step.scopeRestrictions),
              step.risk,
              canonicalJson(step.securityConsiderations),
              canonicalJson(step.verificationCommands),
              canonicalJson(step.expectedResults),
              step.rollbackProcedure,
              canonicalJson(step.citations),
            ],
          );
        }
        await client.query(
          `UPDATE "InvestigationRun" SET "status"='AWAITING_APPROVAL',"completedAt"=NOW(),
             "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [command.investigationId, command.organizationId],
        );
        await appendInvestigationEvent(client, {
          investigationId: command.investigationId,
          type: 'TREATMENT_PLAN_PROPOSED',
          payload: {
            diagnosisId: command.diagnosis.id,
            treatmentPlanId: command.plan.id,
            contentHash: command.plan.contentHash,
          },
          actorType: ActorType.AGENT,
          actorId: command.workerId,
        });
        await appendIncidentEvent(client, {
          incidentId: run.incidentId,
          type: IncidentEventType.DIAGNOSIS_PUBLISHED,
          payload: {
            investigationId: command.investigationId,
            diagnosisId: command.diagnosis.id,
            treatmentPlanId: command.plan.id,
          },
          actorType: ActorType.AGENT,
          actorId: command.workerId,
          requestId: `worker:${command.workerId}`,
          correlationId: command.investigationId,
        });
      },
      { tenantOrganizationId: command.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async getDiagnosis(organizationId: string, investigationId: string): Promise<Diagnosis | null> {
    return await withTransaction(
      async (client) => {
        await this.assertTenantInvestigation(client, organizationId, investigationId);
        const row = await queryOne<{
          id: string;
          investigationId: string;
          summary: string;
          failureMechanism: string;
          blastRadius: string;
          securityImpact: string;
          confidence: number;
          confidenceBand: string;
          unknowns: string[];
          citations: InvestigationCitation[];
          schemaVersion: string;
          contentHash: string;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","investigationId","summary","failureMechanism","blastRadius","securityImpact",
                  "confidence","confidenceBand","unknowns","citations","schemaVersion","contentHash","createdAt"
             FROM "Diagnosis" WHERE "investigationId"=$1 AND "organizationId"=$2`,
          [investigationId, organizationId],
        );
        if (!row) return null;
        const hypotheses = await queryMany<{
          id: string;
          disposition: string;
          title: string;
          mechanism: string;
          confidence: number;
          supportingEvidence: InvestigationCitation[];
          contradictingEvidence: InvestigationCitation[];
          missingEvidence: string[];
          assumptions: string[];
        }>(
          client,
          `SELECT "id","disposition","title","mechanism","confidence","supportingEvidence",
                  "contradictingEvidence","missingEvidence","assumptions"
             FROM "RootCauseHypothesis" WHERE "investigationId"=$1
             ORDER BY CASE "disposition" WHEN 'PRIMARY' THEN 0 WHEN 'ALTERNATIVE' THEN 1 ELSE 2 END,
                      "confidence" DESC`,
          [investigationId],
        );
        return {
          ...row,
          hypotheses,
          confidenceBand: row.confidenceBand as Diagnosis['confidenceBand'],
          createdAt: row.createdAt.toISOString(),
        } as Diagnosis;
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listTreatmentPlans(
    organizationId: string,
    investigationId: string,
  ): Promise<TreatmentPlan[]> {
    return await withTransaction(
      async (client) => {
        await this.assertTenantInvestigation(client, organizationId, investigationId);
        const rows = await queryMany<TreatmentPlanRow>(
          client,
          `SELECT p.*,s."sequence",s."title",s."objective",s."affectedComponents",
                  s."scopeRestrictions",s."risk" AS "stepRisk",s."securityConsiderations",
                  s."verificationCommands",s."expectedResults",s."rollbackProcedure",s."citations"
             FROM "TreatmentPlan" p LEFT JOIN "TreatmentPlanStep" s ON s."planId"=p."id"
            WHERE p."organizationId"=$1 AND p."investigationId"=$2
            ORDER BY p."version" DESC,s."sequence"`,
          [organizationId, investigationId],
        );
        const grouped = new Map<string, TreatmentPlanRow[]>();
        for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
        return [...grouped.values()].map((group) => {
          const first = group[0]!;
          return TreatmentPlanSchema.parse({
            id: first.id,
            investigationId: first.investigationId,
            diagnosisId: first.diagnosisId,
            version: first.version,
            status: first.status,
            goal: first.goal,
            risk: first.risk,
            steps: group
              .filter((row) => row.sequence !== null)
              .map((row) => ({
                sequence: row.sequence,
                title: row.title,
                objective: row.objective,
                affectedComponents: row.affectedComponents,
                scopeRestrictions: row.scopeRestrictions,
                risk: row.stepRisk,
                securityConsiderations: row.securityConsiderations,
                verificationCommands: row.verificationCommands,
                expectedResults: row.expectedResults,
                rollbackProcedure: row.rollbackProcedure,
                citations: row.citations,
              })),
            verificationMatrix: first.verificationMatrix,
            rollbackStrategy: first.rollbackStrategy,
            compatibilityImpact: first.compatibilityImpact,
            migrationImpact: first.migrationImpact,
            knownLimitations: first.knownLimitations,
            requiredApprovals: first.requiredApprovals,
            schemaVersion: first.schemaVersion,
            contentHash: first.contentHash,
            createdAt: first.createdAt.toISOString(),
          });
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async decideTreatmentPlan(command: {
    context: StoreActorContext;
    planId: string;
    decision: PlanDecision;
    comment: string;
    expectedVersion: number;
  }): Promise<TreatmentPlan> {
    if (
      command.context.actorType !== ActorType.USER ||
      command.context.actorRoles.includes(ActorRole.SERVICE)
    ) {
      throw new Error('Treatment-plan decisions require an authenticated human user.');
    }
    return await withTransaction(
      async (client) => {
        const plan = await queryOne<{
          id: string;
          organizationId: string;
          incidentId: string;
          investigationId: string;
          version: number;
          status: TreatmentPlanStatus;
          requiredApprovals: number;
        }>(
          client,
          `SELECT "id","organizationId","incidentId","investigationId","version","status","requiredApprovals"
             FROM "TreatmentPlan" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [command.planId, command.context.organizationId],
        );
        if (!plan) throw new TenantResourceNotFoundError('Treatment plan');
        if (plan.version !== command.expectedVersion) throw new OptimisticConcurrencyError();
        if (plan.status !== TreatmentPlanStatus.AWAITING_APPROVAL) {
          throw new Error(`Treatment plan in ${plan.status} cannot be decided.`);
        }
        const decisionHash = digestPayload({
          planId: plan.id,
          decision: command.decision,
          comment: command.comment,
          actorId: command.context.actorId,
          planVersion: plan.version,
          createdAt: new Date().toISOString(),
        });
        const insertedApproval = await queryOne<{ id: string }>(
          client,
          `INSERT INTO "PlanApproval" (
            "id","organizationId","planId","decision","comment","actorId","actorType",
            "actorRoles","planVersion","requestId","correlationId","decisionHash","createdAt"
          ) VALUES ($1,$2,$3,$4::"PlanApprovalDecision",$5,$6,$7::"ActorType",$8,$9,$10,$11,$12,NOW())
          ON CONFLICT ("planId","planVersion","actorId","decision") DO NOTHING
          RETURNING "id"`,
          [
            randomUUID(),
            command.context.organizationId,
            plan.id,
            command.decision,
            command.comment,
            command.context.actorId,
            command.context.actorType,
            command.context.actorRoles,
            plan.version,
            command.context.requestId,
            command.context.correlationId,
            decisionHash,
          ],
        );
        if (!insertedApproval) {
          const plans = await this.listTreatmentPlansInTransaction(
            client,
            command.context.organizationId,
            plan.investigationId,
          );
          const current = plans.find((candidate) => candidate.id === plan.id);
          if (!current)
            throw new Error('Treatment plan could not be loaded after duplicate decision.');
          return current;
        }

        const approvalCountRow = await queryOne<{ count: string }>(
          client,
          `SELECT COUNT(DISTINCT "actorId")::text AS "count"
             FROM "PlanApproval"
            WHERE "planId"=$1 AND "planVersion"=$2
              AND "decision"='APPROVE'::"PlanApprovalDecision"`,
          [plan.id, plan.version],
        );
        const approvalCount = Number(approvalCountRow?.count ?? '0');
        const approvalThresholdReached =
          command.decision === PlanApprovalDecision.APPROVE &&
          approvalCount >= plan.requiredApprovals;
        const nextStatus =
          command.decision === PlanApprovalDecision.APPROVE
            ? approvalThresholdReached
              ? TreatmentPlanStatus.APPROVED
              : TreatmentPlanStatus.AWAITING_APPROVAL
            : command.decision === PlanApprovalDecision.REJECT
              ? TreatmentPlanStatus.REJECTED
              : TreatmentPlanStatus.REVISION_REQUESTED;
        await client.query(
          `UPDATE "TreatmentPlan" SET "status"=$3::"TreatmentPlanStatus","updatedAt"=NOW()
             WHERE "id"=$1 AND "organizationId"=$2`,
          [plan.id, command.context.organizationId, nextStatus],
        );
        const investigationStatus =
          command.decision === PlanApprovalDecision.APPROVE
            ? approvalThresholdReached
              ? InvestigationStatus.APPROVED
              : InvestigationStatus.AWAITING_APPROVAL
            : command.decision === PlanApprovalDecision.REJECT
              ? InvestigationStatus.REJECTED
              : InvestigationStatus.REVISION_REQUESTED;
        await client.query(
          `UPDATE "InvestigationRun" SET "status"=$3::"InvestigationStatus","updatedAt"=NOW()
             WHERE "id"=$1 AND "organizationId"=$2`,
          [plan.investigationId, command.context.organizationId, investigationStatus],
        );
        const eventType =
          command.decision === PlanApprovalDecision.APPROVE
            ? approvalThresholdReached
              ? IncidentEventType.TREATMENT_PLAN_APPROVED
              : IncidentEventType.TREATMENT_PLAN_APPROVAL_RECORDED
            : command.decision === PlanApprovalDecision.REJECT
              ? IncidentEventType.TREATMENT_PLAN_REJECTED
              : IncidentEventType.TREATMENT_PLAN_REVISION_REQUESTED;
        const decisionEventPayload = {
          planId: plan.id,
          investigationId: plan.investigationId,
          version: plan.version,
          decision: command.decision,
          approvalCount,
          requiredApprovals: plan.requiredApprovals,
          approvalThresholdReached,
        };
        await appendIncidentEvent(client, {
          incidentId: plan.incidentId,
          type: eventType,
          payload: decisionEventPayload,
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        await appendInvestigationEvent(client, {
          investigationId: plan.investigationId,
          type: eventType,
          payload: { ...decisionEventPayload, comment: command.comment },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        await appendAudit(
          client,
          command.context,
          plan.incidentId,
          `treatment-plan.${command.decision.toLowerCase()}`,
          'TreatmentPlan',
          plan.id,
          {
            version: plan.version,
            decisionHash,
            approvalCount,
            requiredApprovals: plan.requiredApprovals,
            approvalThresholdReached,
          },
        );
        const plans = await this.listTreatmentPlansInTransaction(
          client,
          command.context.organizationId,
          plan.investigationId,
        );
        const updated = plans.find((candidate) => candidate.id === plan.id);
        if (!updated) throw new Error('Updated treatment plan could not be loaded.');
        return updated;
      },
      { tenantOrganizationId: command.context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async failInvestigation(command: {
    organizationId: string;
    investigationId: string;
    workerId: string;
    status: InvestigationStatus;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertInvestigationLease(
          client,
          command.organizationId,
          command.investigationId,
          command.workerId,
        );
        await client.query(
          `UPDATE "InvestigationRun" SET "status"=$3::"InvestigationStatus","errorCode"=$4,
             "errorMessage"=$5,"completedAt"=NOW(),"leaseOwner"=NULL,"leaseExpiresAt"=NULL,
             "updatedAt"=NOW() WHERE "id"=$1 AND "organizationId"=$2`,
          [
            command.investigationId,
            command.organizationId,
            command.status,
            command.errorCode.slice(0, 128),
            command.errorMessage.slice(0, 2_000),
          ],
        );
        await appendInvestigationEvent(client, {
          investigationId: command.investigationId,
          type: 'INVESTIGATION_FAILED',
          payload: { status: command.status, errorCode: command.errorCode },
          actorType: ActorType.SERVICE,
          actorId: command.workerId,
        });
      },
      { tenantOrganizationId: command.organizationId },
      this.pool,
    );
  }

  async latestContextPackage(
    organizationId: string,
    investigationId: string,
  ): Promise<InvestigationContextPackage | null> {
    return await withTransaction(
      async (client) => {
        const pkg = await queryOne<{
          id: string;
          schemaVersion: string;
          contentHash: string;
          totalBytes: number;
          truncated: boolean;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","schemaVersion","contentHash","totalBytes","truncated","createdAt"
             FROM "InvestigationContextPackage" WHERE "organizationId"=$1 AND "investigationId"=$2
             ORDER BY "createdAt" DESC LIMIT 1`,
          [organizationId, investigationId],
        );
        if (!pkg) return null;
        const items = await queryMany<{
          sourceType: InvestigationContextPackage['items'][number]['sourceType'];
          sourceId: string;
          label: string;
          digest: string;
          path: string | null;
          lineStart: number | null;
          lineEnd: number | null;
          sensitivity: string | null;
          byteSize: number;
          redactionCount: number;
          suspiciousInstructionCount: number;
          content: unknown;
        }>(
          client,
          `SELECT "sourceType","sourceId","label","digest","path","lineStart","lineEnd",
                  "sensitivity","byteSize","redactionCount","suspiciousInstructionCount","content"
             FROM "InvestigationContextItem" WHERE "contextPackageId"=$1 ORDER BY "createdAt","id"`,
          [pkg.id],
        );
        return {
          schemaVersion: 'codeer-context-v1',
          generatedAt: pkg.createdAt.toISOString(),
          items: items.map((item) => ({
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            label: item.label,
            digest: item.digest,
            content: item.content,
            byteSize: item.byteSize,
            suspiciousInstructionCount: item.suspiciousInstructionCount,
            redactionCount: item.redactionCount,
            ...(item.path ? { path: item.path } : {}),
            ...(item.lineStart !== null ? { lineStart: item.lineStart } : {}),
            ...(item.lineEnd !== null ? { lineEnd: item.lineEnd } : {}),
            ...(item.sensitivity ? { sensitivity: item.sensitivity } : {}),
          })),
          totalBytes: pkg.totalBytes,
          truncated: pkg.truncated,
          contentHash: pkg.contentHash,
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async loadInvestigationSources(
    organizationId: string,
    investigationId: string,
  ): Promise<InvestigationSourceBundle> {
    return await withTransaction(
      async (client) => {
        const run = await queryOne<{
          incidentId: string;
          reproductionId: string;
          repositoryId: string;
          repositoryFullName: string;
          worktreeRelativePath: string;
        }>(
          client,
          `SELECT r."incidentId",r."reproductionId",i."repositoryId",repo."fullName" AS "repositoryFullName",
                  w."relativePath" AS "worktreeRelativePath"
             FROM "InvestigationRun" r
             JOIN "Incident" i ON i."id"=r."incidentId" AND i."organizationId"=r."organizationId"
             JOIN "Repository" repo ON repo."id"=i."repositoryId" AND repo."organizationId"=r."organizationId"
             JOIN "FailureReproduction" f ON f."id"=r."reproductionId" AND f."organizationId"=r."organizationId"
             JOIN "SandboxExecution" x ON x."id"=f."executionId" AND x."organizationId"=r."organizationId"
             JOIN "RepositoryWorktree" w ON w."id"=x."worktreeId"
            WHERE r."id"=$1 AND r."organizationId"=$2`,
          [investigationId, organizationId],
        );
        if (!run) throw new TenantResourceNotFoundError('Investigation');

        const [evidence, events, reproduction, logs, artifacts, health] = await Promise.all([
          queryMany<{
            id: string;
            kind: string;
            title: string;
            summary: string;
            payload: unknown;
            digest: string;
            sensitivity: string;
            observedAt: Date;
          }>(
            client,
            `SELECT "id","kind","title","summary","payload","digest","sensitivity","observedAt"
               FROM "Evidence" WHERE "organizationId"=$1 AND "incidentId"=$2
               ORDER BY "createdAt" DESC LIMIT 150`,
            [organizationId, run.incidentId],
          ),
          queryMany<{
            id: string;
            type: string;
            payload: unknown;
            eventHash: string;
            occurredAt: Date;
          }>(
            client,
            `SELECT "id","type","payload","eventHash","occurredAt" FROM "IncidentEvent"
              WHERE "incidentId"=$1 ORDER BY "sequence" DESC LIMIT 250`,
            [run.incidentId],
          ),
          queryOne<{
            id: string;
            result: string | null;
            status: string;
            input: unknown;
            originalFailureSignature: unknown;
            observedFailureSignature: unknown;
            signatureComparison: unknown;
            confidence: number | null;
            environmentFingerprint: string | null;
            updatedAt: Date;
          }>(
            client,
            `SELECT "id","result","status","input","originalFailureSignature","observedFailureSignature",
                    "signatureComparison","confidence","environmentFingerprint","updatedAt"
               FROM "FailureReproduction" WHERE "id"=$1 AND "organizationId"=$2`,
            [run.reproductionId, organizationId],
          ),
          queryMany<{
            id: string;
            sequence: number;
            stream: string;
            content: string;
            chunkHash: string;
            createdAt: Date;
          }>(
            client,
            `SELECT l."id",l."sequence",l."stream",l."content",l."chunkHash",l."createdAt"
               FROM "SandboxLogChunk" l JOIN "SandboxExecution" x ON x."id"=l."executionId"
              WHERE x."organizationId"=$1 AND x."incidentId"=$2
              ORDER BY l."sequence" DESC LIMIT 300`,
            [organizationId, run.incidentId],
          ),
          queryMany<{
            id: string;
            name: string;
            relativePath: string;
            mediaType: string;
            byteSize: number;
            digest: string;
            createdAt: Date;
          }>(
            client,
            `SELECT a."id",a."path" AS "name",a."path" AS "relativePath",a."mediaType",a."byteSize",a."digest",a."createdAt"
               FROM "SandboxArtifact" a
              WHERE a."organizationId"=$1 AND a."incidentId"=$2
              ORDER BY a."createdAt" DESC LIMIT 100`,
            [organizationId, run.incidentId],
          ),
          queryOne<{
            id: string;
            overallScore: number;
            status: string;
            dimensions: unknown;
            calculationVersion: string;
            createdAt: Date;
          }>(
            client,
            `SELECT "id","overallScore","status","dimensions","calculationVersion","createdAt"
               FROM "RepositoryHealthSnapshot" WHERE "organizationId"=$1 AND "repositoryId"=$2
               ORDER BY "createdAt" DESC LIMIT 1`,
            [organizationId, run.repositoryId],
          ),
        ]);

        const sources: ContextSource[] = [];
        for (const item of evidence) {
          sources.push({
            sourceType: CitationSourceType.INCIDENT_EVIDENCE,
            sourceId: item.id,
            label: `${item.kind}: ${item.title}`,
            digest: item.digest,
            content: { summary: item.summary, payload: item.payload },
            observedAt: item.observedAt.toISOString(),
            sensitivity: item.sensitivity,
          });
        }
        for (const event of events.reverse()) {
          sources.push({
            sourceType: CitationSourceType.INCIDENT_EVENT,
            sourceId: event.id,
            label: event.type,
            digest: event.eventHash,
            content: event.payload,
            observedAt: event.occurredAt.toISOString(),
          });
        }
        if (reproduction) {
          const content = {
            status: reproduction.status,
            result: reproduction.result,
            input: reproduction.input,
            originalFailureSignature: reproduction.originalFailureSignature,
            observedFailureSignature: reproduction.observedFailureSignature,
            signatureComparison: reproduction.signatureComparison,
            confidence: reproduction.confidence,
            environmentFingerprint: reproduction.environmentFingerprint,
          };
          sources.push({
            sourceType: CitationSourceType.REPRODUCTION,
            sourceId: reproduction.id,
            label: 'Verified failure reproduction',
            digest: digestPayload(content),
            content,
            observedAt: reproduction.updatedAt.toISOString(),
          });
        }
        for (const log of logs.reverse()) {
          sources.push({
            sourceType: CitationSourceType.SANDBOX_LOG,
            sourceId: log.id,
            label: `${log.stream} log chunk ${log.sequence}`,
            digest: log.chunkHash,
            content: log.content,
            observedAt: log.createdAt.toISOString(),
          });
        }
        for (const artifact of artifacts) {
          sources.push({
            sourceType: CitationSourceType.SANDBOX_ARTIFACT,
            sourceId: artifact.id,
            label: artifact.name,
            digest: artifact.digest,
            content: {
              path: artifact.relativePath,
              mediaType: artifact.mediaType,
              byteSize: artifact.byteSize,
            },
            path: artifact.relativePath,
            observedAt: artifact.createdAt.toISOString(),
          });
        }
        if (health) {
          sources.push({
            sourceType: CitationSourceType.REPOSITORY_HEALTH,
            sourceId: health.id,
            label: `Repository health ${health.status}`,
            digest: digestPayload({
              overallScore: health.overallScore,
              status: health.status,
              dimensions: health.dimensions,
              calculationVersion: health.calculationVersion,
            }),
            content: {
              overallScore: health.overallScore,
              status: health.status,
              dimensions: health.dimensions,
              calculationVersion: health.calculationVersion,
            },
            observedAt: health.createdAt.toISOString(),
          });
        }
        return {
          worktreeRelativePath: run.worktreeRelativePath,
          repositoryId: run.repositoryId,
          repositoryFullName: run.repositoryFullName,
          sources,
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async reconcileStaleInvestigations(workerId: string, staleAfterMs: number): Promise<number> {
    return await withTransaction(
      async (client) => {
        const stale = await queryMany<{
          id: string;
          organizationId: string;
          status: InvestigationStatus;
        }>(
          client,
          `SELECT "id","organizationId","status" FROM "InvestigationRun"
            WHERE "leaseExpiresAt"<NOW() AND "updatedAt"<NOW()-($1*INTERVAL '1 millisecond')
              AND "status" IN ('POLICY_CHECK','CONTEXT_BUILDING','TRIAGE','MAPPING','HYPOTHESIS','VALIDATION','SECURITY_REVIEW','PLAN_COMPOSITION','CRITIC_REVIEW')
            ORDER BY "updatedAt" LIMIT 100 FOR UPDATE SKIP LOCKED`,
          [Math.min(Math.max(staleAfterMs, 60_000), 24 * 60 * 60 * 1000)],
        );
        for (const row of stale) {
          await client.query(
            `UPDATE "InvestigationRun" SET "status"='MODEL_FAILED',"errorCode"='STALE_WORKER',
               "errorMessage"='Investigation worker lease expired before completion.',
               "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW()
              WHERE "id"=$1`,
            [row.id],
          );
          await appendInvestigationEvent(client, {
            investigationId: row.id,
            type: 'INVESTIGATION_RECONCILED',
            payload: {
              previousStatus: row.status,
              outcome: 'MODEL_FAILED',
              reason: 'STALE_WORKER',
            },
            actorType: ActorType.SERVICE,
            actorId: workerId,
          });
        }
        return stale.length;
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  private async upsertPolicyInTransaction(
    client: PoolClient,
    organizationId: string,
    actorId: string,
    policy: AiPolicy,
  ): Promise<string> {
    const parsed = AiPolicySchema.parse(policy);
    const contentHash = digestPayload(parsed);
    const previous = await queryOne<{ id: string; contentHash: string }>(
      client,
      `SELECT "id","contentHash" FROM "OrganizationAiPolicy"
        WHERE "organizationId"=$1 AND "policyVersion"=$2 FOR UPDATE`,
      [organizationId, parsed.policyVersion],
    );
    if (previous) {
      if (previous.contentHash !== contentHash) {
        throw new Error('AI policy version already exists with different content.');
      }
      return previous.id;
    }
    const id = randomUUID();
    await client.query(
      `UPDATE "OrganizationAiPolicy" SET "active"=FALSE,"supersededAt"=NOW()
        WHERE "organizationId"=$1 AND "active"=TRUE`,
      [organizationId],
    );
    await client.query(
      `INSERT INTO "OrganizationAiPolicy" (
        "id","organizationId","provider","allowedModels","modelByAgent","allowedTools",
        "maximumConcurrentInvestigations","maximumModelInvocations","maximumToolCalls",
        "maximumInputTokens","maximumOutputTokens","maximumCostUsd","timeoutMs","retentionDays",
        "requireHumanApproval","requireIndependentCritic","requireSecurityReview",
        "storeProviderResponses","policyVersion","active","contentHash","createdBy","createdAt"
      ) VALUES ($1,$2,$3::"AiProvider",$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,TRUE,$20,$21,NOW())`,
      [
        id,
        organizationId,
        parsed.provider,
        parsed.allowedModels,
        canonicalJson(parsed.modelByAgent),
        parsed.allowedTools,
        parsed.maximumConcurrentInvestigations,
        parsed.maximumModelInvocations,
        parsed.maximumToolCalls,
        parsed.maximumInputTokens,
        parsed.maximumOutputTokens,
        parsed.maximumCostUsd,
        parsed.timeoutMs,
        parsed.retentionDays,
        parsed.requireHumanApproval,
        parsed.requireIndependentCritic,
        parsed.requireSecurityReview,
        parsed.storeProviderResponses,
        parsed.policyVersion,
        contentHash,
        actorId,
      ],
    );
    return id;
  }

  private mapPolicy(row: Record<string, unknown>): AiPolicy {
    return AiPolicySchema.parse({
      provider: row.provider ?? AiProvider.OPENAI,
      allowedModels: row.allowedModels,
      modelByAgent: row.modelByAgent,
      allowedTools: row.allowedTools,
      maximumConcurrentInvestigations: row.maximumConcurrentInvestigations,
      maximumModelInvocations: row.maximumModelInvocations,
      maximumToolCalls: row.maximumToolCalls,
      maximumInputTokens: row.maximumInputTokens,
      maximumOutputTokens: row.maximumOutputTokens,
      maximumCostUsd: Number(row.maximumCostUsd),
      timeoutMs: row.timeoutMs,
      retentionDays: row.retentionDays,
      requireHumanApproval: row.requireHumanApproval,
      requireIndependentCritic: row.requireIndependentCritic,
      requireSecurityReview: row.requireSecurityReview,
      storeProviderResponses: row.storeProviderResponses,
      policyVersion: row.policyVersion ?? AI_POLICY_VERSION,
    });
  }

  private async getInvestigationRow(
    client: PoolClient,
    organizationId: string,
    investigationId: string,
    forUpdate = false,
  ): Promise<InvestigationRow | undefined> {
    return await queryOne<InvestigationRow>(
      client,
      `SELECT r.*,p."policyVersion" FROM "InvestigationRun" r
         JOIN "OrganizationAiPolicy" p ON p."id"=r."aiPolicyId"
        WHERE r."organizationId"=$1 AND r."id"=$2 ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
      [organizationId, investigationId],
    );
  }

  private async getInvestigationInTransaction(
    client: PoolClient,
    organizationId: string,
    investigationId: string,
  ): Promise<Investigation> {
    const row = await this.getInvestigationRow(client, organizationId, investigationId);
    if (!row) throw new TenantResourceNotFoundError('Investigation');
    return mapInvestigation(row);
  }

  private async assertTenantInvestigation(
    client: PoolClient,
    organizationId: string,
    investigationId: string,
  ): Promise<void> {
    const row = await queryOne<{ id: string }>(
      client,
      `SELECT "id" FROM "InvestigationRun" WHERE "id"=$1 AND "organizationId"=$2`,
      [investigationId, organizationId],
    );
    if (!row) throw new TenantResourceNotFoundError('Investigation');
  }

  private async listTreatmentPlansInTransaction(
    client: PoolClient,
    organizationId: string,
    investigationId: string,
  ): Promise<TreatmentPlan[]> {
    const rows = await queryMany<TreatmentPlanRow>(
      client,
      `SELECT p.*,s."sequence",s."title",s."objective",s."affectedComponents",
              s."scopeRestrictions",s."risk" AS "stepRisk",s."securityConsiderations",
              s."verificationCommands",s."expectedResults",s."rollbackProcedure",s."citations"
         FROM "TreatmentPlan" p LEFT JOIN "TreatmentPlanStep" s ON s."planId"=p."id"
        WHERE p."organizationId"=$1 AND p."investigationId"=$2
        ORDER BY p."version" DESC,s."sequence"`,
      [organizationId, investigationId],
    );
    const grouped = new Map<string, TreatmentPlanRow[]>();
    for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
    return [...grouped.values()].map((group) => {
      const first = group[0]!;
      return TreatmentPlanSchema.parse({
        id: first.id,
        investigationId: first.investigationId,
        diagnosisId: first.diagnosisId,
        version: first.version,
        status: first.status,
        goal: first.goal,
        risk: first.risk,
        steps: group
          .filter((row) => row.sequence !== null)
          .map((row) => ({
            sequence: row.sequence,
            title: row.title,
            objective: row.objective,
            affectedComponents: row.affectedComponents,
            scopeRestrictions: row.scopeRestrictions,
            risk: row.stepRisk,
            securityConsiderations: row.securityConsiderations,
            verificationCommands: row.verificationCommands,
            expectedResults: row.expectedResults,
            rollbackProcedure: row.rollbackProcedure,
            citations: row.citations,
          })),
        verificationMatrix: first.verificationMatrix,
        rollbackStrategy: first.rollbackStrategy,
        compatibilityImpact: first.compatibilityImpact,
        migrationImpact: first.migrationImpact,
        knownLimitations: first.knownLimitations,
        requiredApprovals: first.requiredApprovals,
        schemaVersion: first.schemaVersion,
        contentHash: first.contentHash,
        createdAt: first.createdAt.toISOString(),
      });
    });
  }
}
