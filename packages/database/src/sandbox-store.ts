import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ActorType,
  EvidenceKind,
  EvidenceSensitivity,
  EvidenceSource,
  IncidentEventType,
  SANDBOX_REPRODUCTION_OUTBOX_TOPIC,
  SandboxExecutionJobSchema,
  SandboxExecutionStatus,
  SandboxResult,
  ReproductionSchema,
  type Reproduction,
  type SandboxArtifact,
  type SandboxCleanupProof,
  type SandboxCommandRequest,
  type SandboxCommandStatus,
  type SandboxCommandResult,
  type SandboxExecutionJob,
  type SandboxLogChunk,
  type SandboxPolicyDecision,
  type StartReproductionInput,
} from '@codeer/contracts';
import { buildIncidentEventHash, canonicalJson, digestPayload } from '@codeer/incidents';
import { buildFailureSignature } from '@codeer/sandbox';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';
import type { StoreActorContext } from './incident-store.js';
import { IdempotencyConflictError, TenantResourceNotFoundError } from './incident-store.js';

export interface CreateReproductionCommand {
  context: StoreActorContext;
  incidentId: string;
  input: StartReproductionInput;
  policy: SandboxPolicyDecision;
  idempotencyKey?: string | undefined;
  idempotencyTtlSeconds: number;
}

export interface SandboxExecutionEnvelope {
  executionId: string;
  reproductionId: string;
  organizationId: string;
  incidentId: string;
  worktreeId: string;
  worktreeRelativePath: string;
  input: StartReproductionInput;
  policy: SandboxPolicyDecision;
  cancellationRequestedAt: string | null;
}

interface ReproductionRow {
  id: string;
  organizationId: string;
  incidentId: string;
  executionId: string;
  input: StartReproductionInput;
  status: string;
  result: string | null;
  originalFailureSignature: unknown;
  observedFailureSignature: unknown;
  signatureComparison: unknown;
  confidence: number | null;
  environmentFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
  worktreeId: string;
  image: string;
  cancellationRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  policyDecision: SandboxPolicyDecision;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

async function appendSandboxIncidentEvent(
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
      WHERE "incidentId" = $1 ORDER BY "sequence" DESC LIMIT 1 FOR UPDATE`,
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
      "id", "incidentId", "sequence", "type", "payload", "actorType", "actorId",
      "requestId", "correlationId", "previousHash", "eventHash", "occurredAt", "createdAt"
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

async function appendSandboxAudit(
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

function parseCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error('Reproduction cursor is invalid');
  }
}

function nextCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(row), 'utf8').toString('base64url');
}

async function assertSandboxLease(
  client: PoolClient,
  organizationId: string,
  executionId: string,
  leaseOwner: string,
): Promise<void> {
  const lease = await queryOne<{ id: string }>(
    client,
    `SELECT "id" FROM "SandboxExecution"
      WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3
        AND "leaseExpiresAt">NOW()
      FOR UPDATE`,
    [executionId, organizationId, leaseOwner],
  );
  if (!lease) throw new Error('Sandbox execution lease was lost.');
}

export class SandboxStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async createReproduction(command: CreateReproductionCommand): Promise<Reproduction> {
    const requestHash = digestPayload({ incidentId: command.incidentId, input: command.input });
    return await withTransaction(
      async (client) => {
        if (command.idempotencyKey) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `${command.context.organizationId}:sandbox.reproduction.create:${command.idempotencyKey}`,
          ]);
          const previous = await queryOne<{
            requestHash: string;
            response: Reproduction;
            expiresAt: Date;
          }>(
            client,
            `SELECT "requestHash","response","expiresAt" FROM "IdempotencyRecord"
              WHERE "organizationId"=$1 AND "scope"='sandbox.reproduction.create' AND "key"=$2`,
            [command.context.organizationId, command.idempotencyKey],
          );
          if (previous && previous.expiresAt > new Date()) {
            if (previous.requestHash !== requestHash) throw new IdempotencyConflictError();
            return previous.response;
          }
        }

        const worktree = await queryOne<{ id: string; relativePath: string; repositoryId: string }>(
          client,
          `SELECT w."id",w."relativePath",w."repositoryId"
             FROM "Incident" i
             JOIN "RepositoryWorktree" w ON w."repositoryId"=i."repositoryId" AND w."status"='ACTIVE'
            WHERE i."id"=$1 AND i."organizationId"=$2
              AND ($3::uuid IS NULL OR w."id"=$3::uuid)
            ORDER BY w."createdAt" DESC LIMIT 1 FOR UPDATE OF i`,
          [command.incidentId, command.context.organizationId, command.input.worktreeId ?? null],
        );
        if (!worktree) throw new TenantResourceNotFoundError('Incident worktree');

        const executionId = randomUUID();
        const reproductionId = randomUUID();
        const status = command.policy.allowed
          ? SandboxExecutionStatus.REQUESTED
          : SandboxExecutionStatus.POLICY_BLOCKED;
        const result = command.policy.allowed ? null : SandboxResult.POLICY_BLOCKED;
        const originalSignature = buildFailureSignature(
          command.input.failureSignature.expectedText,
        );

        await client.query(
          `INSERT INTO "SandboxExecution" (
             "id","organizationId","incidentId","worktreeId","status","result","image","completedAt","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5::"SandboxExecutionStatus",$6::"SandboxResult",$7,$8,NOW(),NOW())`,
          [
            executionId,
            command.context.organizationId,
            command.incidentId,
            worktree.id,
            status,
            result,
            command.policy.image,
            command.policy.allowed ? null : new Date(),
          ],
        );
        await client.query(
          `INSERT INTO "FailureReproduction" (
             "id","organizationId","incidentId","executionId","input","status","result",
             "originalFailureSignature","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::"SandboxExecutionStatus",$7::"SandboxResult",$8::jsonb,NOW(),NOW())`,
          [
            reproductionId,
            command.context.organizationId,
            command.incidentId,
            executionId,
            canonicalJson(command.input),
            status,
            result,
            canonicalJson(originalSignature),
          ],
        );
        await client.query(
          `INSERT INTO "SandboxPolicySnapshot" (
             "id","executionId","policyVersion","decisionId","allowed","reasons","image",
             "imageDigestRequired","normalizedCommands","resourceLimits","networkPolicy",
             "overrideRequired","overrideReason","approvedBy","evaluatedAt","createdAt"
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,NOW())`,
          [
            randomUUID(),
            executionId,
            command.policy.policyVersion,
            command.policy.decisionId,
            command.policy.allowed,
            canonicalJson(command.policy.reasons),
            command.policy.image,
            command.policy.imageDigestRequired,
            canonicalJson(command.policy.normalizedCommands),
            canonicalJson(command.policy.resourceLimits),
            canonicalJson(command.policy.networkPolicy),
            command.policy.overrideRequired,
            command.input.policyOverrideReason ?? null,
            command.input.policyOverrideReason ? command.context.actorId : null,
            new Date(command.policy.evaluatedAt),
          ],
        );

        const job: SandboxExecutionJob = SandboxExecutionJobSchema.parse({
          executionId,
          reproductionId,
          incidentId: command.incidentId,
          organizationId: command.context.organizationId,
          requestedBy: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
          requestedAt: new Date().toISOString(),
          attempt: 1,
        });
        if (command.policy.allowed) {
          await client.query(
            `INSERT INTO "OutboxMessage" (
               "id","organizationId","topic","partitionKey","deduplicationKey","payload",
               "status","attempts","availableAt","createdAt","updatedAt"
             ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,NOW(),NOW(),NOW())
             ON CONFLICT ("deduplicationKey") DO NOTHING`,
            [
              randomUUID(),
              command.context.organizationId,
              SANDBOX_REPRODUCTION_OUTBOX_TOPIC,
              executionId,
              `sandbox.execute:${executionId}:1`,
              canonicalJson(job),
            ],
          );
        }
        await appendSandboxIncidentEvent(client, {
          incidentId: command.incidentId,
          type: command.policy.allowed
            ? IncidentEventType.REPRODUCTION_REQUESTED
            : IncidentEventType.SANDBOX_POLICY_BLOCKED,
          payload: {
            reproductionId,
            executionId,
            policyDecisionId: command.policy.decisionId,
            allowed: command.policy.allowed,
            reasons: command.policy.reasons,
          },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        await appendSandboxAudit(
          client,
          command.context,
          command.incidentId,
          command.policy.allowed
            ? 'sandbox.reproduction.request'
            : 'sandbox.reproduction.policy_blocked',
          'FailureReproduction',
          reproductionId,
          { executionId, policyDecisionId: command.policy.decisionId },
          command.policy.allowed ? 'SUCCESS' : 'DENIED',
        );

        const response = await this.getReproductionInTransaction(
          client,
          command.context.organizationId,
          reproductionId,
        );
        if (command.idempotencyKey) {
          await client.query(
            `INSERT INTO "IdempotencyRecord" (
              "id","organizationId","scope","key","requestHash","response","statusCode","resourceId","expiresAt","createdAt"
             ) VALUES ($1,$2,'sandbox.reproduction.create',$3,$4,$5::jsonb,202,$6,NOW()+($7*INTERVAL '1 second'),NOW())
             ON CONFLICT ("organizationId","scope","key") DO UPDATE SET
               "requestHash"=EXCLUDED."requestHash","response"=EXCLUDED."response",
               "resourceId"=EXCLUDED."resourceId","expiresAt"=EXCLUDED."expiresAt"`,
            [
              randomUUID(),
              command.context.organizationId,
              command.idempotencyKey,
              requestHash,
              canonicalJson(response),
              reproductionId,
              command.idempotencyTtlSeconds,
            ],
          );
        }
        return response;
      },
      {
        isolationLevel: 'SERIALIZABLE',
        maxRetries: 5,
        tenantOrganizationId: command.context.organizationId,
      },
      this.pool,
    );
  }

  async getReproduction(organizationId: string, reproductionId: string): Promise<Reproduction> {
    return await withTransaction(
      (client) => this.getReproductionInTransaction(client, organizationId, reproductionId),
      { tenantOrganizationId: organizationId, isolationLevel: 'REPEATABLE READ' },
      this.pool,
    );
  }

  async listReproductions(
    organizationId: string,
    incidentId: string,
    query: {
      cursor?: string;
      limit: number;
      status?: SandboxExecutionStatus;
      result?: SandboxResult;
    },
  ): Promise<{ items: Reproduction[]; nextCursor: string | null }> {
    return await withTransaction(
      async (client) => {
        const values: unknown[] = [organizationId, incidentId];
        const clauses = ['r."organizationId"=$1', 'r."incidentId"=$2'];
        if (query.status) {
          values.push(query.status);
          clauses.push(`r."status"=$${values.length}::"SandboxExecutionStatus"`);
        }
        if (query.result) {
          values.push(query.result);
          clauses.push(`r."result"=$${values.length}::"SandboxResult"`);
        }
        if (query.cursor) {
          const cursor = parseCursor(query.cursor);
          values.push(cursor.createdAt, cursor.id);
          clauses.push(
            `(r."createdAt",r."id")<($${values.length - 1}::timestamptz,$${values.length}::uuid)`,
          );
        }
        values.push(query.limit + 1);
        const rows = await queryMany<{ id: string; createdAt: Date }>(
          client,
          `SELECT r."id",r."createdAt" FROM "FailureReproduction" r
          WHERE ${clauses.join(' AND ')} ORDER BY r."createdAt" DESC,r."id" DESC LIMIT $${values.length}`,
          values,
        );
        const selected = rows.slice(0, query.limit);
        const items: Reproduction[] = [];
        for (const row of selected)
          items.push(await this.getReproductionInTransaction(client, organizationId, row.id));
        const last = selected.at(-1);
        return {
          items,
          nextCursor:
            rows.length > query.limit && last
              ? nextCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
              : null,
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listLogs(
    organizationId: string,
    reproductionId: string,
    query: { afterSequence?: number; limit: number },
  ): Promise<{ items: SandboxLogChunk[]; nextSequence: number | null }> {
    return await withTransaction(
      async (client) => {
        const owner = await queryOne<{ executionId: string }>(
          client,
          `SELECT "executionId" FROM "FailureReproduction" WHERE "id"=$1 AND "organizationId"=$2`,
          [reproductionId, organizationId],
        );
        if (!owner) throw new TenantResourceNotFoundError('Reproduction');
        const rows = await queryMany<{
          id: string;
          executionId: string;
          commandId: string | null;
          sequence: number;
          stream: string;
          content: string;
          byteSize: number;
          redacted: boolean;
          redactionCount: number;
          truncated: boolean;
          previousHash: string | null;
          chunkHash: string;
          occurredAt: Date;
        }>(
          client,
          `SELECT * FROM "SandboxLogChunk" WHERE "executionId"=$1 AND "sequence">$2
          ORDER BY "sequence" ASC LIMIT $3`,
          [owner.executionId, query.afterSequence ?? 0, query.limit + 1],
        );
        const selected = rows.slice(0, query.limit).map((row) => ({
          ...row,
          stream: row.stream as SandboxLogChunk['stream'],
          occurredAt: row.occurredAt.toISOString(),
        }));
        return {
          items: selected,
          nextSequence: rows.length > query.limit ? (selected.at(-1)?.sequence ?? null) : null,
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listArtifacts(organizationId: string, reproductionId: string): Promise<SandboxArtifact[]> {
    return await withTransaction(
      async (client) => {
        const owner = await queryOne<{ executionId: string }>(
          client,
          `SELECT "executionId" FROM "FailureReproduction" WHERE "id"=$1 AND "organizationId"=$2`,
          [reproductionId, organizationId],
        );
        if (!owner) throw new TenantResourceNotFoundError('Reproduction');
        const rows = await queryMany<{
          id: string;
          executionId: string;
          path: string;
          mediaType: string;
          byteSize: number;
          digest: string;
          retention: string;
          storageReference: string | null;
          createdAt: Date;
        }>(
          client,
          `SELECT * FROM "SandboxArtifact" WHERE "executionId"=$1 ORDER BY "createdAt" ASC LIMIT 500`,
          [owner.executionId],
        );
        return rows.map((row) => ({
          ...row,
          retention: row.retention as SandboxArtifact['retention'],
          createdAt: row.createdAt.toISOString(),
        }));
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async requestCancellation(
    context: StoreActorContext,
    reproductionId: string,
  ): Promise<Reproduction> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{ incidentId: string; executionId: string; status: string }>(
          client,
          `SELECT "incidentId","executionId","status" FROM "FailureReproduction"
          WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [reproductionId, context.organizationId],
        );
        if (!row) throw new TenantResourceNotFoundError('Reproduction');
        if (
          [
            SandboxExecutionStatus.COMPLETED,
            SandboxExecutionStatus.CANCELLED,
            SandboxExecutionStatus.POLICY_BLOCKED,
            SandboxExecutionStatus.TIMED_OUT,
            SandboxExecutionStatus.INFRASTRUCTURE_FAILED,
            SandboxExecutionStatus.CLEANUP_FAILED,
          ].includes(row.status as SandboxExecutionStatus)
        ) {
          return await this.getReproductionInTransaction(
            client,
            context.organizationId,
            reproductionId,
          );
        }
        await client.query(
          `UPDATE "SandboxExecution" SET "cancellationRequestedAt"=COALESCE("cancellationRequestedAt",NOW()),"updatedAt"=NOW()
          WHERE "id"=$1`,
          [row.executionId],
        );
        await appendSandboxIncidentEvent(client, {
          incidentId: row.incidentId,
          type: IncidentEventType.REPRODUCTION_CANCELLATION_REQUESTED,
          payload: { reproductionId, executionId: row.executionId, requested: true },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        await appendSandboxAudit(
          client,
          context,
          row.incidentId,
          'sandbox.reproduction.cancel.request',
          'FailureReproduction',
          reproductionId,
          { executionId: row.executionId },
        );
        return await this.getReproductionInTransaction(
          client,
          context.organizationId,
          reproductionId,
        );
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async claimExecution(
    job: SandboxExecutionJob,
    workerId: string,
    leaseMs: number,
  ): Promise<SandboxExecutionEnvelope | null> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{ reproductionId: string }>(
          client,
          `UPDATE "SandboxExecution" SET
           "leaseOwner"=$2,"leaseExpiresAt"=NOW()+($3*INTERVAL '1 millisecond'),
           "heartbeatAt"=NOW(),"startedAt"=COALESCE("startedAt",NOW()),"status"='PREPARING',"updatedAt"=NOW()
         WHERE "id"=$1 AND "organizationId"=$4
           AND "status" IN ('REQUESTED','PREPARING','INSTALLING','REPRODUCING','COLLECTING','CLEANING')
           AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<NOW())
         RETURNING (SELECT r."id" FROM "FailureReproduction" r WHERE r."executionId"="SandboxExecution"."id") AS "reproductionId"`,
          [job.executionId, workerId, leaseMs, job.organizationId],
        );
        if (!row) return null;
        return await this.executionEnvelopeInTransaction(
          client,
          job.organizationId,
          job.executionId,
        );
      },
      { tenantOrganizationId: job.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async heartbeat(
    organizationId: string,
    executionId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        const result = await client.query(
          `UPDATE "SandboxExecution" SET "heartbeatAt"=NOW(),"leaseExpiresAt"=NOW()+($4*INTERVAL '1 millisecond'),"updatedAt"=NOW()
          WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3`,
          [executionId, organizationId, workerId, leaseMs],
        );
        if (result.rowCount !== 1) throw new Error('Sandbox execution lease was lost.');
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async updateStatus(
    organizationId: string,
    executionId: string,
    status: SandboxExecutionStatus,
    metadata: unknown = {},
    leaseOwner: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, executionId, leaseOwner);
        const row = await queryOne<{ incidentId: string; reproductionId: string }>(
          client,
          `UPDATE "SandboxExecution" SET "status"=$3::"SandboxExecutionStatus","updatedAt"=NOW()
          WHERE "id"=$1 AND "organizationId"=$2
          RETURNING "incidentId",(SELECT r."id" FROM "FailureReproduction" r WHERE r."executionId"="SandboxExecution"."id") AS "reproductionId"`,
          [executionId, organizationId, status],
        );
        if (!row) throw new TenantResourceNotFoundError('Sandbox execution');
        await client.query(
          `UPDATE "FailureReproduction" SET "status"=$2::"SandboxExecutionStatus","updatedAt"=NOW() WHERE "executionId"=$1`,
          [executionId, status],
        );
        const type =
          status === SandboxExecutionStatus.PREPARING
            ? IncidentEventType.SANDBOX_PREPARING
            : status === SandboxExecutionStatus.REPRODUCING
              ? IncidentEventType.REPRODUCTION_STARTED
              : undefined;
        if (type) {
          await appendSandboxIncidentEvent(client, {
            incidentId: row.incidentId,
            type,
            payload: { executionId, reproductionId: row.reproductionId, status, metadata },
            actorType: ActorType.SERVICE,
            actorId: 'sandbox-worker',
            requestId: executionId,
            correlationId: executionId,
          });
        }
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async commandStarted(
    organizationId: string,
    executionId: string,
    commandId: string,
    sequence: number,
    command: SandboxCommandRequest,
    leaseOwner: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, executionId, leaseOwner);
        await client.query(
          `INSERT INTO "SandboxCommand" (
           "id","executionId","sequence","phase","executable","arguments","workingDirectory","environment",
           "networkMode","timeoutMs","expectedExitCodes","status","startedAt","createdAt","updatedAt"
         ) VALUES ($1,$2,$3,$4::"SandboxCommandPhase",$5,$6,$7,$8::jsonb,$9::"SandboxNetworkMode",$10,$11,'RUNNING',NOW(),NOW(),NOW())
         ON CONFLICT ("id") DO NOTHING`,
          [
            commandId,
            executionId,
            sequence,
            command.phase,
            command.executable,
            command.arguments,
            command.workingDirectory,
            canonicalJson(command.environment),
            command.networkMode,
            command.timeoutMs ?? 300_000,
            command.expectedExitCodes,
          ],
        );
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async commandCompleted(
    organizationId: string,
    executionId: string,
    result: SandboxCommandResult,
    leaseOwner: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, executionId, leaseOwner);
        await client.query(
          `UPDATE "SandboxCommand" SET "status"=$4::"SandboxCommandStatus","exitCode"=$5,"signal"=$6,
          "durationMs"=$7,"timedOut"=$8,"oomKilled"=$9,"outputDigest"=$10,"completedAt"=$11,"updatedAt"=NOW()
          WHERE "id"=$1 AND "executionId"=$2 AND EXISTS (
            SELECT 1 FROM "SandboxExecution" e WHERE e."id"=$2 AND e."organizationId"=$3
          )`,
          [
            result.id,
            executionId,
            organizationId,
            result.status,
            result.exitCode,
            result.signal,
            result.durationMs,
            result.timedOut,
            result.oomKilled,
            result.outputDigest,
            new Date(result.completedAt),
          ],
        );
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async appendLogChunks(
    organizationId: string,
    executionId: string,
    chunks: readonly SandboxLogChunk[],
    leaseOwner: string,
  ): Promise<void> {
    if (chunks.length === 0) return;
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, executionId, leaseOwner);
        for (const chunk of chunks) {
          await client.query(
            `INSERT INTO "SandboxLogChunk" (
            "id","executionId","commandId","sequence","stream","content","byteSize","redacted",
            "redactionCount","truncated","previousHash","chunkHash","occurredAt","createdAt"
           ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
             WHERE EXISTS (SELECT 1 FROM "SandboxExecution" e WHERE e."id"=$2 AND e."organizationId"=$14)
           ON CONFLICT ("executionId","sequence") DO NOTHING`,
            [
              chunk.id,
              executionId,
              chunk.commandId,
              chunk.sequence,
              chunk.stream,
              chunk.content,
              chunk.byteSize,
              chunk.redacted,
              chunk.redactionCount,
              chunk.truncated,
              chunk.previousHash,
              chunk.chunkHash,
              new Date(chunk.occurredAt),
              organizationId,
            ],
          );
        }
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async recordArtifacts(
    organizationId: string,
    incidentId: string,
    executionId: string,
    artifacts: readonly SandboxArtifact[],
    leaseOwner: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, executionId, leaseOwner);
        const execution = await queryOne<{ incidentId: string }>(
          client,
          `SELECT "incidentId" FROM "SandboxExecution" WHERE "id"=$1 AND "organizationId"=$2`,
          [executionId, organizationId],
        );
        if (!execution || execution.incidentId !== incidentId) {
          throw new TenantResourceNotFoundError('Sandbox execution incident');
        }
        for (const artifact of artifacts) {
          await client.query(
            `INSERT INTO "SandboxArtifact" (
            "id","organizationId","incidentId","executionId","path","mediaType","byteSize","digest","retention","storageReference","createdAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::"SandboxArtifactRetention",$10,$11)
           ON CONFLICT ("executionId","path","digest") DO NOTHING`,
            [
              artifact.id,
              organizationId,
              incidentId,
              executionId,
              artifact.path,
              artifact.mediaType,
              artifact.byteSize,
              artifact.digest,
              artifact.retention,
              artifact.storageReference,
              new Date(artifact.createdAt),
            ],
          );
        }
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async recordCleanup(
    organizationId: string,
    cleanup: SandboxCleanupProof,
    leaseOwner: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, cleanup.executionId, leaseOwner);
        await client.query(
          `INSERT INTO "SandboxCleanupRecord" (
          "id","executionId","containerIds","volumeIds","networkIds","verifiedAbsent","attempts","digest","error","completedAt","createdAt"
         ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()
           WHERE EXISTS (SELECT 1 FROM "SandboxExecution" e WHERE e."id"=$2 AND e."organizationId"=$11)
         ON CONFLICT ("executionId","digest") DO NOTHING`,
          [
            randomUUID(),
            cleanup.executionId,
            cleanup.containerIds,
            cleanup.volumeIds,
            cleanup.networkIds,
            cleanup.verifiedAbsent,
            cleanup.attempts,
            cleanup.digest,
            cleanup.error,
            new Date(cleanup.completedAt),
            organizationId,
          ],
        );
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async isCancellationRequested(organizationId: string, executionId: string): Promise<boolean> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{ requested: boolean }>(
          client,
          `SELECT ("cancellationRequestedAt" IS NOT NULL) AS requested FROM "SandboxExecution"
          WHERE "id"=$1 AND "organizationId"=$2`,
          [executionId, organizationId],
        );
        return row?.requested ?? true;
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async completeExecution(
    organizationId: string,
    executionId: string,
    result: {
      status: SandboxExecutionStatus;
      result: SandboxResult;
      comparison: unknown;
      environmentFingerprint: string;
      confidence: number;
      cleanup: SandboxCleanupProof;
      error?: string | undefined;
    },
    leaseOwner: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertSandboxLease(client, organizationId, executionId, leaseOwner);
        const row = await queryOne<{ incidentId: string; reproductionId: string }>(
          client,
          `UPDATE "SandboxExecution" SET "status"=$3::"SandboxExecutionStatus","result"=$4::"SandboxResult",
          "environmentFingerprint"=$5,"completedAt"=NOW(),"leaseOwner"=NULL,"leaseExpiresAt"=NULL,
          "errorMessage"=$6,"updatedAt"=NOW()
          WHERE "id"=$1 AND "organizationId"=$2
          RETURNING "incidentId",(SELECT r."id" FROM "FailureReproduction" r WHERE r."executionId"="SandboxExecution"."id") AS "reproductionId"`,
          [
            executionId,
            organizationId,
            result.status,
            result.result,
            result.environmentFingerprint,
            result.error ?? null,
          ],
        );
        if (!row) throw new TenantResourceNotFoundError('Sandbox execution');
        const comparison = result.comparison as { observed?: unknown } | null;
        await client.query(
          `UPDATE "FailureReproduction" SET "status"=$2::"SandboxExecutionStatus","result"=$3::"SandboxResult",
          "observedFailureSignature"=$4::jsonb,"signatureComparison"=$5::jsonb,"confidence"=$6,
          "environmentFingerprint"=$7,"updatedAt"=NOW() WHERE "executionId"=$1`,
          [
            executionId,
            result.status,
            result.result,
            comparison?.observed ? canonicalJson(comparison.observed) : null,
            result.comparison ? canonicalJson(result.comparison) : null,
            result.confidence,
            result.environmentFingerprint,
          ],
        );
        const eventType =
          result.status === SandboxExecutionStatus.CLEANUP_FAILED
            ? IncidentEventType.SANDBOX_CLEANUP_FAILED
            : result.status === SandboxExecutionStatus.TIMED_OUT
              ? IncidentEventType.REPRODUCTION_TIMED_OUT
              : result.status === SandboxExecutionStatus.CANCELLED
                ? IncidentEventType.REPRODUCTION_CANCELLED
                : result.status === SandboxExecutionStatus.INFRASTRUCTURE_FAILED
                  ? IncidentEventType.SANDBOX_INFRASTRUCTURE_FAILED
                  : result.result === SandboxResult.REPRODUCED
                    ? IncidentEventType.FAILURE_REPRODUCED
                    : result.result === SandboxResult.NOT_REPRODUCED
                      ? IncidentEventType.FAILURE_NOT_REPRODUCED
                      : IncidentEventType.REPRODUCTION_INCONCLUSIVE;
        await appendSandboxIncidentEvent(client, {
          incidentId: row.incidentId,
          type: eventType,
          payload: {
            executionId,
            reproductionId: row.reproductionId,
            status: result.status,
            result: result.result,
            confidence: result.confidence,
            cleanupVerified: result.cleanup.verifiedAbsent,
          },
          actorType: ActorType.SERVICE,
          actorId: 'sandbox-worker',
          requestId: executionId,
          correlationId: executionId,
        });
        const evidenceId = randomUUID();
        const evidencePayload = {
          executionId,
          reproductionId: row.reproductionId,
          status: result.status,
          result: result.result,
          comparison: result.comparison,
          environmentFingerprint: result.environmentFingerprint,
          confidence: result.confidence,
          cleanup: result.cleanup,
        };
        await client.query(
          `INSERT INTO "Evidence" (
          "id","organizationId","incidentId","kind","source","sensitivity","title","summary","payload",
          "contentType","byteSize","digest","redacted","redactionCount","origin","collectionMethod","observedAt","createdAt"
         ) VALUES ($1,$2,$3,$4::"EvidenceKind",$5::"EvidenceSource",$6::"EvidenceSensitivity",$7,$8,$9::jsonb,
          'application/json',$10,$11,FALSE,0,$12,'sandbox-orchestrator',NOW(),NOW())
         ON CONFLICT ("incidentId","digest","kind") DO NOTHING`,
          [
            evidenceId,
            organizationId,
            row.incidentId,
            EvidenceKind.FAILURE_REPRODUCTION,
            EvidenceSource.SANDBOX,
            EvidenceSensitivity.INTERNAL,
            'Failure reproduction result',
            `Sandbox execution completed with ${result.result}.`,
            canonicalJson(evidencePayload),
            Buffer.byteLength(canonicalJson(evidencePayload), 'utf8'),
            digestPayload(evidencePayload),
            `sandbox://${executionId}`,
          ],
        );
      },
      { tenantOrganizationId: organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async reconcileExpiredLeases(
    reconcilerId: string,
    leaseMs: number,
    limit = 100,
  ): Promise<Array<{ executionId: string; organizationId: string }>> {
    return await withTransaction(
      async (client) => {
        return await queryMany<{ executionId: string; organizationId: string }>(
          client,
          `UPDATE "SandboxExecution" SET
             "leaseOwner"=$2,
             "leaseExpiresAt"=NOW()+($3*INTERVAL '1 millisecond'),
             "heartbeatAt"=NOW(),
             "updatedAt"=NOW()
          WHERE "id" IN (
            SELECT "id" FROM "SandboxExecution"
             WHERE "leaseExpiresAt"<NOW() AND "status" IN ('PREPARING','INSTALLING','REPRODUCING','COLLECTING','CLEANING')
             ORDER BY "leaseExpiresAt" ASC LIMIT $1 FOR UPDATE SKIP LOCKED
          ) RETURNING "id" AS "executionId","organizationId"`,
          [limit, reconcilerId, leaseMs],
        );
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  private async executionEnvelopeInTransaction(
    client: PoolClient,
    organizationId: string,
    executionId: string,
  ): Promise<SandboxExecutionEnvelope> {
    const row = await queryOne<{
      executionId: string;
      reproductionId: string;
      incidentId: string;
      organizationId: string;
      worktreeId: string;
      worktreeRelativePath: string;
      input: StartReproductionInput;
      policy: SandboxPolicyDecision;
      cancellationRequestedAt: Date | null;
    }>(
      client,
      `SELECT e."id" AS "executionId",r."id" AS "reproductionId",e."incidentId",e."organizationId",
        e."worktreeId",w."relativePath" AS "worktreeRelativePath",r."input",
        jsonb_build_object(
          'allowed',p."allowed",'policyVersion',p."policyVersion",'decisionId',p."decisionId",
          'reasons',p."reasons",'normalizedCommands',p."normalizedCommands",'resourceLimits',p."resourceLimits",
          'networkPolicy',p."networkPolicy",'image',p."image",'imageDigestRequired',p."imageDigestRequired",
          'overrideRequired',p."overrideRequired",'evaluatedAt',p."evaluatedAt"
        ) AS "policy",e."cancellationRequestedAt"
       FROM "SandboxExecution" e
       JOIN "FailureReproduction" r ON r."executionId"=e."id"
       JOIN "SandboxPolicySnapshot" p ON p."executionId"=e."id"
       JOIN "RepositoryWorktree" w ON w."id"=e."worktreeId"
       WHERE e."id"=$1 AND e."organizationId"=$2`,
      [executionId, organizationId],
    );
    if (!row) throw new TenantResourceNotFoundError('Sandbox execution');
    return {
      ...row,
      cancellationRequestedAt: iso(row.cancellationRequestedAt),
    };
  }

  private async getReproductionInTransaction(
    client: PoolClient,
    organizationId: string,
    reproductionId: string,
  ): Promise<Reproduction> {
    const row = await queryOne<ReproductionRow>(
      client,
      `SELECT r.*,e."worktreeId",e."image",e."cancellationRequestedAt",e."startedAt",e."completedAt",
        jsonb_build_object(
          'allowed',p."allowed",'policyVersion',p."policyVersion",'decisionId',p."decisionId",
          'reasons',p."reasons",'normalizedCommands',p."normalizedCommands",'resourceLimits',p."resourceLimits",
          'networkPolicy',p."networkPolicy",'image',p."image",'imageDigestRequired',p."imageDigestRequired",
          'overrideRequired',p."overrideRequired",'evaluatedAt',to_char(p."evaluatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ) AS "policyDecision"
       FROM "FailureReproduction" r
       JOIN "SandboxExecution" e ON e."id"=r."executionId"
       JOIN "SandboxPolicySnapshot" p ON p."executionId"=e."id"
       WHERE r."id"=$1 AND r."organizationId"=$2`,
      [reproductionId, organizationId],
    );
    if (!row) throw new TenantResourceNotFoundError('Reproduction');
    const commands = await queryMany<{
      id: string;
      sequence: number;
      phase: string;
      executable: string;
      arguments: string[];
      workingDirectory: string;
      status: string;
      exitCode: number | null;
      signal: string | null;
      durationMs: number | null;
      timedOut: boolean;
      oomKilled: boolean;
      outputDigest: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
    }>(client, `SELECT * FROM "SandboxCommand" WHERE "executionId"=$1 ORDER BY "sequence" ASC`, [
      row.executionId,
    ]);
    const artifacts = await queryMany<{
      id: string;
      executionId: string;
      path: string;
      mediaType: string;
      byteSize: number;
      digest: string;
      retention: string;
      storageReference: string | null;
      createdAt: Date;
    }>(client, `SELECT * FROM "SandboxArtifact" WHERE "executionId"=$1 ORDER BY "createdAt" ASC`, [
      row.executionId,
    ]);
    const cleanup = await queryOne<{
      executionId: string;
      containerIds: string[];
      volumeIds: string[];
      networkIds: string[];
      verifiedAbsent: boolean;
      attempts: number;
      digest: string;
      error: string | null;
      completedAt: Date;
    }>(
      client,
      `SELECT * FROM "SandboxCleanupRecord" WHERE "executionId"=$1
       ORDER BY "completedAt" DESC, "createdAt" DESC LIMIT 1`,
      [row.executionId],
    );
    return ReproductionSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      incidentId: row.incidentId,
      worktreeId: row.worktreeId,
      executionId: row.executionId,
      status: row.status as SandboxExecutionStatus,
      result: row.result as SandboxResult | null,
      policyDecision: row.policyDecision,
      originalFailureSignature:
        row.originalFailureSignature as Reproduction['originalFailureSignature'],
      observedFailureSignature:
        row.observedFailureSignature as Reproduction['observedFailureSignature'],
      signatureComparison: row.signatureComparison as Reproduction['signatureComparison'],
      environmentFingerprint: row.environmentFingerprint,
      confidence: row.confidence,
      commands: commands.map((command) => ({
        id: command.id,
        sequence: command.sequence,
        phase: command.phase as Reproduction['commands'][number]['phase'],
        executable: command.executable,
        arguments: command.arguments,
        workingDirectory: command.workingDirectory,
        status: command.status as SandboxCommandStatus,
        exitCode: command.exitCode,
        signal: command.signal,
        durationMs: command.durationMs ?? 0,
        timedOut: command.timedOut,
        oomKilled: command.oomKilled,
        outputDigest: command.outputDigest ?? digestPayload(''),
        startedAt: (command.startedAt ?? row.createdAt).toISOString(),
        completedAt: (command.completedAt ?? command.startedAt ?? row.createdAt).toISOString(),
      })),
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        retention: artifact.retention as Reproduction['artifacts'][number]['retention'],
        createdAt: artifact.createdAt.toISOString(),
      })),
      cleanup: cleanup ? { ...cleanup, completedAt: cleanup.completedAt.toISOString() } : null,
      cancellationRequestedAt: iso(row.cancellationRequestedAt),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
