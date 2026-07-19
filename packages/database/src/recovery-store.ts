import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ActorRole,
  ActorType,
  CONTROLLED_RECOVERY_OUTBOX_TOPIC,
  ControlledRecoveryJobSchema,
  IncidentEventType,
  PatchVersionSchema,
  PublicationDecision,
  PullRequestPackageSchema,
  RecoveryEventSchema,
  RecoveryRunSchema,
  RecoveryRunStatus,
  RecoverySecurityReviewSchema,
  RecoveryVerificationReportSchema,
  type AgentRunStatus,
  type ControlledRecoveryJob,
  type PatchVersion,
  type PullRequestPackage,
  type RecoveryEvent,
  type RecoveryListQuery,
  type RecoveryPolicy,
  type RecoveryRun,
  type RecoverySecurityReview,
  type RecoveryRevisionRequest,
  type RecoveryVerificationReport,
  type StartRecoveryInput,
} from '@codeer/contracts';
import { buildIncidentEventHash, canonicalJson, digestPayload } from '@codeer/incidents';
import { assertRecoveryTransition } from '@codeer/recovery';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';
import {
  IdempotencyConflictError,
  OptimisticConcurrencyError,
  TenantResourceNotFoundError,
  type StoreActorContext,
} from './incident-store.js';

export interface CreateRecoveryCommand {
  context: StoreActorContext;
  planId: string;
  input: StartRecoveryInput;
  policy: RecoveryPolicy;
  idempotencyKey?: string;
  idempotencyTtlSeconds: number;
}

export interface RecoveryEnvelope {
  id: string;
  status: RecoveryRunStatus;
  organizationId: string;
  incidentId: string;
  repositoryId: string;
  treatmentPlanId: string;
  treatmentPlanVersion: number;
  policy: RecoveryPolicy;
  policyId: string;
  requestedBy: string;
  input: StartRecoveryInput;
  branchName: string;
  baseCommitSha: string;
  currentCheckpoint: number;
  cancellationRequestedAt: string | null;
}

interface RecoveryRow {
  id: string;
  organizationId: string;
  incidentId: string;
  treatmentPlanId: string;
  repositoryId: string;
  status: string;
  version: number;
  policyVersion: string;
  treatmentPlanVersion: number;
  baseCommitSha: string;
  branchName: string;
  currentPatchVersion: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancellationRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RecoveryEventRow {
  id: string;
  recoveryId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  previousHash: string | null;
  eventHash: string;
  occurredAt: Date;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapRecovery(row: RecoveryRow): RecoveryRun {
  return RecoveryRunSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    incidentId: row.incidentId,
    treatmentPlanId: row.treatmentPlanId,
    repositoryId: row.repositoryId,
    status: row.status,
    version: row.version,
    policyVersion: row.policyVersion,
    treatmentPlanVersion: row.treatmentPlanVersion,
    baseCommitSha: row.baseCommitSha,
    branchName: row.branchName,
    patchVersion: row.currentPatchVersion,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: iso(row.leaseExpiresAt),
    cancellationRequestedAt: iso(row.cancellationRequestedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function mapEvent(row: RecoveryEventRow): RecoveryEvent {
  return RecoveryEventSchema.parse({ ...row, occurredAt: row.occurredAt.toISOString() });
}

async function appendRecoveryEvent(
  client: PoolClient,
  command: {
    recoveryId: string;
    type: string;
    payload: Record<string, unknown>;
    actorType: ActorType;
    actorId?: string;
    requestId?: string;
    correlationId?: string;
  },
): Promise<RecoveryEvent> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `recovery-event:${command.recoveryId}`,
  ]);
  const latest = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence","eventHash" FROM "RecoveryEvent"
      WHERE "recoveryId"=$1 ORDER BY "sequence" DESC LIMIT 1`,
    [command.recoveryId],
  );
  const sequence = (latest?.sequence ?? 0) + 1;
  const occurredAt = new Date();
  const payload = {
    recoveryId: command.recoveryId,
    sequence,
    type: command.type,
    payload: command.payload,
    actorType: command.actorType,
    actorId: command.actorId ?? null,
    requestId: command.requestId ?? null,
    correlationId: command.correlationId ?? null,
    previousHash: latest?.eventHash ?? null,
    occurredAt: occurredAt.toISOString(),
  };
  const eventHash = digestPayload(payload);
  const id = randomUUID();
  await client.query(
    `INSERT INTO "RecoveryEvent" (
       "id","recoveryId","sequence","type","payload","previousHash","eventHash",
       "actorType","actorId","requestId","correlationId","occurredAt","createdAt"
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::"ActorType",$9,$10,$11,$12,NOW())`,
    [
      id,
      command.recoveryId,
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
  return RecoveryEventSchema.parse({
    id,
    recoveryId: command.recoveryId,
    sequence,
    type: command.type,
    payload: command.payload,
    previousHash: latest?.eventHash ?? null,
    eventHash,
    occurredAt: occurredAt.toISOString(),
  });
}

async function appendIncidentEvent(
  client: PoolClient,
  command: {
    incidentId: string;
    type: IncidentEventType;
    payload: unknown;
    actorType: ActorType;
    actorId?: string;
    requestId?: string;
    correlationId?: string;
  },
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `incident-event:${command.incidentId}`,
  ]);
  const latest = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence","eventHash" FROM "IncidentEvent"
      WHERE "incidentId"=$1 ORDER BY "sequence" DESC LIMIT 1`,
    [command.incidentId],
  );
  const sequence = (latest?.sequence ?? 0) + 1;
  const occurredAt = new Date().toISOString();
  const eventHash = buildIncidentEventHash({
    incidentId: command.incidentId,
    sequence,
    type: command.type,
    payload: command.payload,
    occurredAt,
    actorType: command.actorType,
    ...(command.actorId ? { actorId: command.actorId } : {}),
    ...(command.requestId ? { requestId: command.requestId } : {}),
    ...(command.correlationId ? { correlationId: command.correlationId } : {}),
    ...(latest?.eventHash ? { previousHash: latest.eventHash } : {}),
  });
  await client.query(
    `INSERT INTO "IncidentEvent" (
       "id","incidentId","sequence","type","payload","actorType","actorId","requestId",
       "correlationId","previousHash","eventHash","occurredAt","createdAt"
     ) VALUES ($1,$2,$3,$4::"IncidentEventType",$5::jsonb,$6::"ActorType",$7,$8,$9,$10,$11,$12,NOW())`,
    [
      randomUUID(),
      command.incidentId,
      sequence,
      command.type,
      canonicalJson(command.payload),
      command.actorType,
      command.actorId ?? null,
      command.requestId ?? null,
      command.correlationId ?? null,
      latest?.eventHash ?? null,
      eventHash,
      occurredAt,
    ],
  );
}

async function assertLease(
  client: PoolClient,
  organizationId: string,
  recoveryId: string,
  workerId: string,
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    client,
    `SELECT "id" FROM "RecoveryRun"
      WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3
        AND "leaseExpiresAt">NOW() FOR UPDATE`,
    [recoveryId, organizationId, workerId],
  );
  if (!row) throw new Error('Recovery execution lease was lost.');
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
    throw new Error('Recovery cursor is invalid.');
  }
}

function encodeCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(row), 'utf8').toString('base64url');
}

export class RecoveryStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async createRecovery(command: CreateRecoveryCommand): Promise<RecoveryRun> {
    const requestHash = digestPayload({ planId: command.planId, input: command.input });
    return await withTransaction(
      async (client) => {
        if (command.idempotencyKey) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `${command.context.organizationId}:recovery.create:${command.idempotencyKey}`,
          ]);
          const previous = await queryOne<{
            requestHash: string;
            response: RecoveryRun;
            expiresAt: Date;
          }>(
            client,
            `SELECT "requestHash","response","expiresAt" FROM "IdempotencyRecord"
              WHERE "organizationId"=$1 AND "scope"='recovery.create' AND "key"=$2`,
            [command.context.organizationId, command.idempotencyKey],
          );
          if (previous && previous.expiresAt > new Date()) {
            if (previous.requestHash !== requestHash) throw new IdempotencyConflictError();
            return RecoveryRunSchema.parse(previous.response);
          }
        }

        const plan = await queryOne<{
          id: string;
          incidentId: string;
          version: number;
          status: string;
          repositoryId: string;
          defaultBranch: string;
        }>(
          client,
          `SELECT p."id",p."incidentId",p."version",p."status",i."repositoryId",r."defaultBranch"
             FROM "TreatmentPlan" p
             JOIN "Incident" i ON i."id"=p."incidentId"
             JOIN "Repository" r ON r."id"=i."repositoryId"
            WHERE p."id"=$1 AND p."organizationId"=$2 AND i."organizationId"=$2
            FOR UPDATE OF p,i`,
          [command.planId, command.context.organizationId],
        );
        if (!plan) throw new TenantResourceNotFoundError('Treatment plan');
        if (plan.status !== 'APPROVED')
          throw new Error('Recovery requires a fully approved treatment plan.');

        const policyId = await this.upsertPolicy(
          client,
          command.context.organizationId,
          command.context.actorId,
          command.policy,
        );
        const id = randomUUID();
        const branchName =
          command.input.requestedBranchName ?? `codeer/recovery-${id.slice(0, 12)}`;
        await client.query(
          `INSERT INTO "RecoveryRun" (
             "id","organizationId","incidentId","treatmentPlanId","repositoryId","recoveryPolicyId",
             "status","policyVersion","treatmentPlanVersion","baseCommitSha","branchName","input",
             "requestedBy","version","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED',$7,$8,$9,$10,$11::jsonb,$12,1,NOW(),NOW())`,
          [
            id,
            command.context.organizationId,
            plan.incidentId,
            plan.id,
            plan.repositoryId,
            policyId,
            command.policy.policyVersion,
            plan.version,
            command.input.baseCommitSha,
            branchName,
            canonicalJson({ ...command.input, baseBranch: plan.defaultBranch }),
            command.context.actorId,
          ],
        );
        const job: ControlledRecoveryJob = ControlledRecoveryJobSchema.parse({
          recoveryId: id,
          organizationId: command.context.organizationId,
          incidentId: plan.incidentId,
          treatmentPlanId: plan.id,
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
            CONTROLLED_RECOVERY_OUTBOX_TOPIC,
            id,
            `recovery.execute:${id}:1`,
            canonicalJson(job),
          ],
        );
        await appendRecoveryEvent(client, {
          recoveryId: id,
          type: 'RECOVERY_REQUESTED',
          payload: {
            planId: plan.id,
            planVersion: plan.version,
            baseCommitSha: command.input.baseCommitSha,
          },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        await appendIncidentEvent(client, {
          incidentId: plan.incidentId,
          type: IncidentEventType.RECOVERY_REQUESTED,
          payload: { recoveryId: id, treatmentPlanId: plan.id },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        const recovery = await this.getRecoveryInTransaction(
          client,
          command.context.organizationId,
          id,
        );
        if (command.idempotencyKey) {
          await client.query(
            `INSERT INTO "IdempotencyRecord" (
              "id","organizationId","scope","key","requestHash","response","statusCode",
              "resourceId","expiresAt","createdAt"
            ) VALUES ($1,$2,'recovery.create',$3,$4,$5::jsonb,201,$6,
              NOW()+($7*INTERVAL '1 second'),NOW())
            ON CONFLICT ("organizationId","scope","key") DO UPDATE
              SET "response"=EXCLUDED."response","resourceId"=EXCLUDED."resourceId",
                  "expiresAt"=EXCLUDED."expiresAt"`,
            [
              randomUUID(),
              command.context.organizationId,
              command.idempotencyKey,
              requestHash,
              canonicalJson(recovery),
              id,
              command.idempotencyTtlSeconds,
            ],
          );
        }
        return recovery;
      },
      { tenantOrganizationId: command.context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async getRecovery(organizationId: string, recoveryId: string): Promise<RecoveryRun> {
    return await withTransaction(
      (client) => this.getRecoveryInTransaction(client, organizationId, recoveryId),
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listRecoveries(organizationId: string, incidentId: string, query: RecoveryListQuery) {
    return await withTransaction(
      async (client) => {
        const cursor = query.cursor ? parseCursor(query.cursor) : null;
        const values: unknown[] = [organizationId, incidentId, query.limit + 1];
        const filters = ['"organizationId"=$1', '"incidentId"=$2'];
        if (query.status) {
          values.push(query.status);
          filters.push(`"status"=$${values.length}::"RecoveryRunStatus"`);
        }
        if (cursor) {
          values.push(cursor.createdAt, cursor.id);
          filters.push(`("createdAt","id")<($${values.length - 1}::timestamptz,$${values.length})`);
        }
        const rows = await queryMany<RecoveryRow>(
          client,
          `SELECT * FROM "RecoveryRun" WHERE ${filters.join(' AND ')}
             ORDER BY "createdAt" DESC,"id" DESC LIMIT $3`,
          values,
        );
        const hasMore = rows.length > query.limit;
        const items = rows.slice(0, query.limit).map(mapRecovery);
        const last = items.at(-1);
        return {
          items,
          nextCursor:
            hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listOrganizationRecoveries(organizationId: string, query: RecoveryListQuery) {
    return await withTransaction(
      async (client) => {
        const values: unknown[] = [organizationId, query.limit];
        const statusSql = query.status ? `AND "status"=$3::"RecoveryRunStatus"` : '';
        if (query.status) values.push(query.status);
        const rows = await queryMany<RecoveryRow>(
          client,
          `SELECT * FROM "RecoveryRun" WHERE "organizationId"=$1 ${statusSql}
             ORDER BY "createdAt" DESC,"id" DESC LIMIT $2`,
          values,
        );
        return { items: rows.map(mapRecovery), nextCursor: null };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listEvents(organizationId: string, recoveryId: string, afterSequence = 0, limit = 100) {
    return await withTransaction(
      async (client) => {
        await this.getRecoveryInTransaction(client, organizationId, recoveryId);
        const rows = await queryMany<RecoveryEventRow>(
          client,
          `SELECT "id","recoveryId","sequence","type","payload","previousHash","eventHash","occurredAt"
             FROM "RecoveryEvent" WHERE "recoveryId"=$1 AND "sequence">$2
             ORDER BY "sequence" ASC LIMIT $3`,
          [recoveryId, afterSequence, Math.min(Math.max(limit, 1), 500)],
        );
        return rows.map(mapEvent);
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async requestCancellation(context: StoreActorContext, recoveryId: string): Promise<RecoveryRun> {
    return await withTransaction(
      async (client) => {
        const row = await this.getRecoveryRow(client, context.organizationId, recoveryId, true);
        await client.query(
          `UPDATE "RecoveryRun" SET "cancellationRequestedAt"=COALESCE("cancellationRequestedAt",NOW()),
             "version"="version"+1,"updatedAt"=NOW() WHERE "id"=$1`,
          [recoveryId],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type: 'RECOVERY_CANCELLATION_REQUESTED',
          payload: { previousStatus: row.status },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        return await this.getRecoveryInTransaction(client, context.organizationId, recoveryId);
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async resumeRecovery(context: StoreActorContext, recoveryId: string): Promise<RecoveryRun> {
    return await withTransaction(
      async (client) => {
        const row = await this.getRecoveryRow(client, context.organizationId, recoveryId, true);
        const resumable = new Set([
          RecoveryRunStatus.PATCH_REJECTED,
          RecoveryRunStatus.SECURITY_REJECTED,
          RecoveryRunStatus.VERIFICATION_FAILED,
          RecoveryRunStatus.WORKTREE_FAILED,
          RecoveryRunStatus.MODEL_FAILED,
          RecoveryRunStatus.TOOL_FAILED,
        ]);
        if (!resumable.has(row.status as RecoveryRunStatus))
          throw new Error('Recovery is not resumable from its current state.');
        await client.query(
          `UPDATE "RecoveryRun" SET "status"='PATCH_PLANNING',"cancellationRequestedAt"=NULL,
             "errorCode"=NULL,"errorMessage"=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL,
             "version"="version"+1,"updatedAt"=NOW() WHERE "id"=$1`,
          [recoveryId],
        );
        const job = ControlledRecoveryJobSchema.parse({
          recoveryId,
          organizationId: context.organizationId,
          incidentId: row.incidentId,
          treatmentPlanId: row.treatmentPlanId,
          requestedBy: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
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
            context.organizationId,
            CONTROLLED_RECOVERY_OUTBOX_TOPIC,
            recoveryId,
            `recovery.execute:${recoveryId}:resume:${Date.now()}`,
            canonicalJson(job),
          ],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type: 'RECOVERY_RESUMED',
          payload: { fromStatus: row.status },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        return await this.getRecoveryInTransaction(client, context.organizationId, recoveryId);
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async acquireLease(
    recoveryId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<RecoveryEnvelope | null> {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{
          id: string;
          status: RecoveryRunStatus;
          organizationId: string;
          incidentId: string;
          repositoryId: string;
          treatmentPlanId: string;
          treatmentPlanVersion: number;
          recoveryPolicyId: string;
          requestedBy: string;
          input: StartRecoveryInput;
          branchName: string;
          baseCommitSha: string;
          currentCheckpoint: number;
          cancellationRequestedAt: Date | null;
        }>(
          client,
          `UPDATE "RecoveryRun" SET "leaseOwner"=$2,
             "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),"heartbeatAt"=NOW(),
             "startedAt"=COALESCE("startedAt",NOW()),"updatedAt"=NOW()
            WHERE "id"=$1 AND ("leaseOwner" IS NULL OR "leaseExpiresAt"<NOW() OR "leaseOwner"=$2)
              AND "status" NOT IN ('PUBLISHED','POLICY_BLOCKED','CANCELLED','BUDGET_EXCEEDED','CLEANUP_FAILED')
            RETURNING "id","status","organizationId","incidentId","repositoryId","treatmentPlanId",
              "treatmentPlanVersion","recoveryPolicyId","requestedBy","input","branchName",
              "baseCommitSha","currentCheckpoint","cancellationRequestedAt"`,
          [recoveryId, workerId, Math.min(Math.max(leaseSeconds, 15), 900)],
        );
        if (!row) return null;
        const policyRow = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM "OrganizationRecoveryPolicy" WHERE "id"=$1`,
          [row.recoveryPolicyId],
        );
        if (!policyRow) throw new Error('Recovery policy snapshot was not found.');
        return {
          id: row.id,
          status: row.status,
          organizationId: row.organizationId,
          incidentId: row.incidentId,
          repositoryId: row.repositoryId,
          treatmentPlanId: row.treatmentPlanId,
          treatmentPlanVersion: row.treatmentPlanVersion,
          policy: this.mapPolicy(policyRow),
          policyId: row.recoveryPolicyId,
          requestedBy: row.requestedBy,
          input: row.input,
          branchName: row.branchName,
          baseCommitSha: row.baseCommitSha,
          currentCheckpoint: row.currentCheckpoint,
          cancellationRequestedAt: iso(row.cancellationRequestedAt),
        };
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async heartbeat(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    leaseSeconds: number,
  ) {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<{ cancellationRequestedAt: Date | null }>(
          client,
          `UPDATE "RecoveryRun" SET "heartbeatAt"=NOW(),
             "leaseExpiresAt"=NOW()+($4*INTERVAL '1 second'),"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3 AND "leaseExpiresAt">NOW()
            RETURNING "cancellationRequestedAt"`,
          [recoveryId, organizationId, workerId, Math.min(Math.max(leaseSeconds, 15), 900)],
        );
        if (!row) throw new Error('Recovery execution lease was lost.');
        return { cancellationRequested: Boolean(row.cancellationRequestedAt) };
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async restartForRetry(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    previousStatus: RecoveryRunStatus,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        await client.query(
          `UPDATE "RecoveryRun" SET "status"='REQUESTED',"errorCode"=NULL,"errorMessage"=NULL,
             "version"="version"+1,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [recoveryId, organizationId],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type: 'RECOVERY_RECONCILED_FOR_RETRY',
          payload: { previousStatus },
          actorType: ActorType.SERVICE,
          actorId: workerId,
        });
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async releaseLease(organizationId: string, recoveryId: string, workerId: string): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        const updated = await client.query(
          `UPDATE "RecoveryRun" SET "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NOW(),
             "version"="version"+1,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2 AND "status" IN ('AWAITING_PUBLICATION_APPROVAL','READY_TO_PUBLISH')`,
          [recoveryId, organizationId],
        );
        if (updated.rowCount !== 1)
          throw new Error('Recovery lease can only be released at a publication gate.');
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async checkpoint(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    stage: RecoveryRunStatus,
    state: Record<string, unknown>,
    eventType: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        const current = await queryOne<{ status: RecoveryRunStatus; currentCheckpoint: number }>(
          client,
          `SELECT "status","currentCheckpoint" FROM "RecoveryRun" WHERE "id"=$1 FOR UPDATE`,
          [recoveryId],
        );
        if (!current) throw new TenantResourceNotFoundError('Recovery');
        assertRecoveryTransition(current.status, stage);
        const sequence = current.currentCheckpoint + 1;
        const stateHash = digestPayload(state);
        await client.query(
          `INSERT INTO "RecoveryCheckpoint" (
             "id","recoveryId","sequence","stage","state","stateHash","leaseOwner","occurredAt","createdAt"
           ) VALUES ($1,$2,$3,$4::"RecoveryRunStatus",$5::jsonb,$6,$7,NOW(),NOW())`,
          [randomUUID(), recoveryId, sequence, stage, canonicalJson(state), stateHash, workerId],
        );
        await client.query(
          `UPDATE "RecoveryRun" SET "status"=$3::"RecoveryRunStatus","currentCheckpoint"=$4,
             "version"="version"+1,"updatedAt"=NOW() WHERE "id"=$1 AND "organizationId"=$2`,
          [recoveryId, organizationId, stage, sequence],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type: eventType,
          payload: { stage, checkpoint: sequence, stateHash, ...state },
          actorType: ActorType.SERVICE,
          actorId: workerId,
        });
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async recordWorktree(command: {
    organizationId: string;
    recoveryId: string;
    workerId: string;
    relativePath: string;
    repositoryPathRef: string;
    branchName: string;
    baseCommitSha: string;
  }): Promise<string> {
    return await withTransaction(
      async (client) => {
        await assertLease(client, command.organizationId, command.recoveryId, command.workerId);
        const id = randomUUID();
        const row = await queryOne<{ id: string }>(
          client,
          `INSERT INTO "RecoveryWorktree" (
             "id","recoveryId","status","repositoryPathRef","relativePath","branchName",
             "baseCommitSha","createdByWorker","createdAt"
           ) VALUES ($1,$2,'READY',$3,$4,$5,$6,$7,NOW())
           ON CONFLICT ("recoveryId") DO UPDATE SET
             "status"='READY',"repositoryPathRef"=EXCLUDED."repositoryPathRef",
             "relativePath"=EXCLUDED."relativePath","branchName"=EXCLUDED."branchName",
             "baseCommitSha"=EXCLUDED."baseCommitSha","createdByWorker"=EXCLUDED."createdByWorker"
           RETURNING "id"`,
          [
            id,
            command.recoveryId,
            command.repositoryPathRef,
            command.relativePath,
            command.branchName,
            command.baseCommitSha,
            command.workerId,
          ],
        );
        return row?.id ?? id;
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async recordAgentRun(command: {
    organizationId: string;
    recoveryId: string;
    workerId: string;
    kind: 'REPAIR' | 'SECURITY_REVIEWER';
    status: AgentRunStatus;
    model: string;
    promptVersion: string;
    schemaName: string;
    inputHash: string;
    outputHash?: string;
    providerRequestId?: string;
    providerResponseId?: string;
    usage?: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
    };
    estimatedCostUsd?: number;
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<string> {
    return await withTransaction(
      async (client) => {
        await assertLease(client, command.organizationId, command.recoveryId, command.workerId);
        const id = randomUUID();
        const usage = command.usage ?? {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        };
        await client.query(
          `INSERT INTO "RecoveryAgentRun" (
             "id","recoveryId","kind","status","model","promptVersion","schemaName",
             "inputHash","outputHash","providerRequestId","providerResponseId","inputTokens",
             "cachedInputTokens","outputTokens","reasoningTokens","estimatedCostUsd","durationMs",
             "errorCode","errorMessage","startedAt","completedAt","createdAt"
           ) VALUES ($1,$2,$3,$4::"AgentRunStatus",$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                     NOW(),CASE WHEN $4 IN ('COMPLETED','FAILED','CANCELLED','BLOCKED') THEN NOW() ELSE NULL END,NOW())`,
          [
            id,
            command.recoveryId,
            command.kind,
            command.status,
            command.model,
            command.promptVersion,
            command.schemaName,
            command.inputHash,
            command.outputHash ?? null,
            command.providerRequestId ?? null,
            command.providerResponseId ?? null,
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
        return id;
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async recordPatch(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    patch: PatchVersion,
  ): Promise<PatchVersion> {
    return await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        const normalized = PatchVersionSchema.parse(patch);
        await client.query(
          `INSERT INTO "RecoveryPatchVersion" (
             "id","recoveryId","version","status","baseCommitSha","unifiedDiff","patchDigest",
             "changedFiles","addedLines","deletedLines","generatedBy","modelInvocationId","createdAt"
           ) VALUES ($1,$2,$3,$4::"PatchVersionStatus",$5,$6,$7,$8,$9,$10,$11,NULL,$12)`,
          [
            normalized.id,
            recoveryId,
            normalized.version,
            normalized.status,
            normalized.baseCommitSha,
            normalized.unifiedDiff,
            normalized.patchDigest,
            normalized.changedFiles,
            normalized.addedLines,
            normalized.deletedLines,
            workerId,
            normalized.createdAt,
          ],
        );
        for (let fileIndex = 0; fileIndex < normalized.files.length; fileIndex += 1) {
          const file = normalized.files[fileIndex]!;
          await client.query(
            `INSERT INTO "RecoveryPatchFile" (
              "id","patchId","sequence","oldPath","newPath","changeType","oldDigest","newDigest",
              "addedLines","deletedLines","binary","generated","sensitive","createdAt"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,
            [
              file.id,
              normalized.id,
              fileIndex + 1,
              file.oldPath,
              file.newPath,
              file.changeType,
              file.oldDigest,
              file.newDigest,
              file.addedLines,
              file.deletedLines,
              file.binary,
              file.generated,
              file.sensitive,
            ],
          );
          for (const hunk of file.hunks) {
            await client.query(
              `INSERT INTO "RecoveryPatchHunk" (
                "id","fileId","sequence","oldStart","oldLines","newStart","newLines","header",
                "content","addedLines","deletedLines","treatmentPlanStep","evidenceCitations",
                "contentHash","createdAt"
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,NOW())`,
              [
                hunk.id,
                file.id,
                hunk.sequence,
                hunk.oldStart,
                hunk.oldLines,
                hunk.newStart,
                hunk.newLines,
                hunk.header,
                hunk.content,
                hunk.addedLines,
                hunk.deletedLines,
                hunk.treatmentPlanStep,
                canonicalJson(hunk.evidenceCitations),
                hunk.contentHash,
              ],
            );
          }
        }
        const decisionHash = digestPayload(normalized.policyDecision);
        await client.query(
          `INSERT INTO "RecoveryPatchPolicyDecision" (
             "id","patchId","allowed","reasons","policyVersion","decisionHash",
             "evaluatedBy","evaluatedAt","createdAt"
           ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,NOW())`,
          [
            randomUUID(),
            normalized.id,
            normalized.policyDecision.allowed,
            canonicalJson(normalized.policyDecision.reasons),
            normalized.policyDecision.policyVersion,
            decisionHash,
            workerId,
            normalized.policyDecision.evaluatedAt,
          ],
        );
        await client.query(
          `UPDATE "RecoveryRun" SET "currentPatchVersion"=$3,"version"="version"+1,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [recoveryId, organizationId, normalized.version],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type: 'RECOVERY_PATCH_RECORDED',
          payload: {
            patchId: normalized.id,
            version: normalized.version,
            digest: normalized.patchDigest,
            allowed: normalized.policyDecision.allowed,
          },
          actorType: ActorType.SERVICE,
          actorId: workerId,
        });
        return normalized;
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async getLatestPatch(organizationId: string, recoveryId: string): Promise<PatchVersion | null> {
    return await withTransaction(
      async (client) => {
        await this.getRecoveryInTransaction(client, organizationId, recoveryId);
        const patch = await queryOne<{
          id: string;
          version: number;
          status: string;
          baseCommitSha: string;
          unifiedDiff: string;
          patchDigest: string;
          changedFiles: number;
          addedLines: number;
          deletedLines: number;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","version","status","baseCommitSha","unifiedDiff","patchDigest","changedFiles","addedLines","deletedLines","createdAt" FROM "RecoveryPatchVersion" WHERE "recoveryId"=$1 ORDER BY "version" DESC LIMIT 1`,
          [recoveryId],
        );
        if (!patch) return null;
        const fileRows = await queryMany<{
          id: string;
          oldPath: string | null;
          newPath: string | null;
          changeType: string;
          oldDigest: string | null;
          newDigest: string | null;
          addedLines: number;
          deletedLines: number;
          binary: boolean;
          generated: boolean;
          sensitive: boolean;
        }>(client, `SELECT * FROM "RecoveryPatchFile" WHERE "patchId"=$1 ORDER BY "sequence"`, [
          patch.id,
        ]);
        const files = [];
        for (const file of fileRows) {
          const hunks = await queryMany<Record<string, unknown>>(
            client,
            `SELECT * FROM "RecoveryPatchHunk" WHERE "fileId"=$1 ORDER BY "sequence"`,
            [file.id],
          );
          files.push({
            ...file,
            patchId: patch.id,
            hunks: hunks.map((hunk) => ({ ...hunk, evidenceCitations: hunk.evidenceCitations })),
          });
        }
        const decision = await queryOne<{
          allowed: boolean;
          reasons: string[];
          policyVersion: string;
          evaluatedAt: Date;
        }>(
          client,
          `SELECT "allowed","reasons","policyVersion","evaluatedAt" FROM "RecoveryPatchPolicyDecision" WHERE "patchId"=$1 ORDER BY "evaluatedAt" DESC LIMIT 1`,
          [patch.id],
        );
        return PatchVersionSchema.parse({
          ...patch,
          recoveryId,
          files,
          policyDecision: {
            allowed: decision?.allowed ?? false,
            reasons: decision?.reasons ?? ['Policy decision missing.'],
            policyVersion: decision?.policyVersion ?? 'unknown',
            evaluatedAt: (decision?.evaluatedAt ?? patch.createdAt).toISOString(),
          },
          createdAt: patch.createdAt.toISOString(),
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async getPatchVersion(
    organizationId: string,
    recoveryId: string,
    version: number,
  ): Promise<PatchVersion | null> {
    return await withTransaction(
      async (client) => {
        await this.getRecoveryInTransaction(client, organizationId, recoveryId);
        const patch = await queryOne<{
          id: string;
          version: number;
          status: string;
          baseCommitSha: string;
          unifiedDiff: string;
          patchDigest: string;
          changedFiles: number;
          addedLines: number;
          deletedLines: number;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","version","status","baseCommitSha","unifiedDiff","patchDigest","changedFiles","addedLines","deletedLines","createdAt"
             FROM "RecoveryPatchVersion" WHERE "recoveryId"=$1 AND "version"=$2`,
          [recoveryId, version],
        );
        if (!patch) return null;
        const fileRows = await queryMany<{
          id: string;
          oldPath: string | null;
          newPath: string | null;
          changeType: string;
          oldDigest: string | null;
          newDigest: string | null;
          addedLines: number;
          deletedLines: number;
          binary: boolean;
          generated: boolean;
          sensitive: boolean;
        }>(client, `SELECT * FROM "RecoveryPatchFile" WHERE "patchId"=$1 ORDER BY "sequence"`, [
          patch.id,
        ]);
        const files = [];
        for (const file of fileRows) {
          const hunks = await queryMany<Record<string, unknown>>(
            client,
            `SELECT * FROM "RecoveryPatchHunk" WHERE "fileId"=$1 ORDER BY "sequence"`,
            [file.id],
          );
          files.push({ ...file, patchId: patch.id, hunks });
        }
        const decision = await queryOne<{
          allowed: boolean;
          reasons: string[];
          policyVersion: string;
          evaluatedAt: Date;
        }>(
          client,
          `SELECT "allowed","reasons","policyVersion","evaluatedAt" FROM "RecoveryPatchPolicyDecision"
             WHERE "patchId"=$1 ORDER BY "evaluatedAt" DESC LIMIT 1`,
          [patch.id],
        );
        return PatchVersionSchema.parse({
          ...patch,
          recoveryId,
          files,
          policyDecision: {
            allowed: decision?.allowed ?? false,
            reasons: decision?.reasons ?? ['Policy decision missing.'],
            policyVersion: decision?.policyVersion ?? 'unknown',
            evaluatedAt: (decision?.evaluatedAt ?? patch.createdAt).toISOString(),
          },
          createdAt: patch.createdAt.toISOString(),
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async recordSecurityReview(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    review: RecoverySecurityReview,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        const value = RecoverySecurityReviewSchema.parse(review);
        await client.query(
          `INSERT INTO "RecoverySecurityReview" (
             "id","recoveryId","patchId","decision","summary","findings","reviewerModel","contentHash","createdAt"
           ) VALUES ($1,$2,$3,$4::"RecoverySecurityDecision",$5,$6::jsonb,$7,$8,$9)`,
          [
            value.id,
            recoveryId,
            value.patchId,
            value.decision,
            value.summary,
            canonicalJson(value.findings),
            value.reviewerModel,
            value.contentHash,
            value.createdAt,
          ],
        );
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async recordVerification(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    report: RecoveryVerificationReport,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        const value = RecoveryVerificationReportSchema.parse(report);
        await client.query(
          `INSERT INTO "RecoveryVerificationRun" (
             "id","recoveryId","patchId","status","originalFailureResolved","unexpectedChanges",
             "scopeExpanded","summary","confidence","contentHash","completedAt","createdAt"
           ) VALUES ($1,$2,$3,$4::"RecoveryVerificationStatus",$5,$6::jsonb,$7,$8,$9,$10,$11,$11)`,
          [
            value.id,
            recoveryId,
            value.patchId,
            value.status,
            value.originalFailureResolved,
            canonicalJson(value.unexpectedChanges),
            value.scopeExpanded,
            value.summary,
            value.confidence,
            value.contentHash,
            value.createdAt,
          ],
        );
        for (const check of value.checks) {
          await client.query(
            `INSERT INTO "RecoveryVerificationCheck" (
               "id","verificationId","sequence","name","command","mandatory","status","exitCode",
               "evidenceIds","summary","startedAt","completedAt","createdAt"
             ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::"RecoveryVerificationCheckStatus",$8,$9,$10,$11,$12,NOW())`,
            [
              check.id,
              value.id,
              check.sequence,
              check.name,
              canonicalJson(check.command ?? null),
              check.mandatory,
              check.status,
              check.exitCode,
              check.evidenceIds,
              check.summary,
              check.startedAt,
              check.completedAt,
            ],
          );
        }
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async recordPullRequestPackage(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    value: PullRequestPackage,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        const pkg = PullRequestPackageSchema.parse(value);
        await client.query(
          `INSERT INTO "RecoveryPullRequestPackage" (
             "id","recoveryId","version","patchId","title","body","headBranch","baseBranch","rootCauseSummary",
             "changedFiles","riskSummary","verificationSummary","knownLimitations","rollbackInstructions",
             "packageHash","createdAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16)`,
          [
            pkg.id,
            recoveryId,
            pkg.version,
            pkg.patchId,
            pkg.title,
            pkg.body,
            pkg.headBranch,
            pkg.baseBranch,
            pkg.rootCauseSummary,
            canonicalJson(pkg.changedFiles),
            pkg.riskSummary,
            pkg.verificationSummary,
            canonicalJson(pkg.knownLimitations),
            pkg.rollbackInstructions,
            pkg.packageHash,
            pkg.createdAt,
          ],
        );
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async getPullRequestPackage(
    organizationId: string,
    recoveryId: string,
  ): Promise<PullRequestPackage | null> {
    return await withTransaction(
      async (client) => {
        await this.getRecoveryInTransaction(client, organizationId, recoveryId);
        const row = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM "RecoveryPullRequestPackage" WHERE "recoveryId"=$1 ORDER BY "version" DESC LIMIT 1`,
          [recoveryId],
        );
        if (!row) return null;
        return PullRequestPackageSchema.parse({
          ...row,
          changedFiles: row.changedFiles,
          knownLimitations: row.knownLimitations,
          createdAt: (row.createdAt as Date).toISOString(),
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async getSecurityReview(
    organizationId: string,
    recoveryId: string,
  ): Promise<RecoverySecurityReview | null> {
    return await withTransaction(
      async (client) => {
        await this.getRecoveryInTransaction(client, organizationId, recoveryId);
        const row = await queryOne<{
          id: string;
          recoveryId: string;
          patchId: string;
          decision: string;
          summary: string;
          findings: unknown;
          reviewerModel: string;
          contentHash: string;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","recoveryId","patchId","decision","summary","findings",
                  "reviewerModel","contentHash","createdAt"
             FROM "RecoverySecurityReview"
            WHERE "recoveryId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
          [recoveryId],
        );
        if (!row) return null;
        return RecoverySecurityReviewSchema.parse({
          ...row,
          findings: row.findings,
          createdAt: row.createdAt.toISOString(),
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async getVerification(
    organizationId: string,
    recoveryId: string,
  ): Promise<RecoveryVerificationReport | null> {
    return await withTransaction(
      async (client) => {
        await this.getRecoveryInTransaction(client, organizationId, recoveryId);
        const row = await queryOne<{
          id: string;
          recoveryId: string;
          patchId: string;
          status: string;
          originalFailureResolved: boolean;
          unexpectedChanges: unknown;
          scopeExpanded: boolean;
          summary: string;
          confidence: number;
          contentHash: string | null;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","recoveryId","patchId","status","originalFailureResolved",
                  "unexpectedChanges","scopeExpanded","summary","confidence","contentHash","createdAt"
             FROM "RecoveryVerificationRun"
            WHERE "recoveryId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
          [recoveryId],
        );
        if (!row || !row.contentHash) return null;
        const checks = await queryMany<{
          id: string;
          verificationId: string;
          sequence: number;
          name: string;
          command: unknown;
          mandatory: boolean;
          status: string;
          exitCode: number | null;
          evidenceIds: string[];
          summary: string;
          startedAt: Date | null;
          completedAt: Date | null;
        }>(
          client,
          `SELECT "id","verificationId","sequence","name","command","mandatory","status",
                  "exitCode","evidenceIds","summary","startedAt","completedAt"
             FROM "RecoveryVerificationCheck"
            WHERE "verificationId"=$1 ORDER BY "sequence"`,
          [row.id],
        );
        return RecoveryVerificationReportSchema.parse({
          ...row,
          unexpectedChanges: row.unexpectedChanges,
          checks: checks.map((check) => ({
            ...check,
            command: check.command ?? undefined,
            startedAt: iso(check.startedAt),
            completedAt: iso(check.completedAt),
          })),
          createdAt: row.createdAt.toISOString(),
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async decidePublication(command: {
    context: StoreActorContext;
    recoveryId: string;
    decision: PublicationDecision;
    comment: string;
    expectedVersion: number;
  }): Promise<RecoveryRun> {
    if (
      command.context.actorType !== ActorType.USER ||
      command.context.actorRoles.includes(ActorRole.SERVICE)
    ) {
      throw new Error('Recovery publication decisions require an authenticated human user.');
    }
    return await withTransaction(
      async (client) => {
        const recovery = await this.getRecoveryRow(
          client,
          command.context.organizationId,
          command.recoveryId,
          true,
        );
        const versionRow = await queryOne<{ version: number; recoveryPolicyId: string }>(
          client,
          `SELECT "version","recoveryPolicyId" FROM "RecoveryRun" WHERE "id"=$1`,
          [command.recoveryId],
        );
        if (!versionRow || versionRow.version !== command.expectedVersion)
          throw new OptimisticConcurrencyError();
        const publicationDecisionStatuses = new Set<string>([
          RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
          RecoveryRunStatus.READY_TO_PUBLISH,
        ]);
        if (!publicationDecisionStatuses.has(recovery.status)) {
          throw new Error(`Recovery in ${recovery.status} cannot be decided.`);
        }
        const policy = await queryOne<{ requiredPublicationApprovals: number }>(
          client,
          `SELECT "requiredPublicationApprovals" FROM "OrganizationRecoveryPolicy" WHERE "id"=$1`,
          [versionRow.recoveryPolicyId],
        );
        const plan = await queryOne<{ risk: string }>(
          client,
          `SELECT "risk"::text AS "risk" FROM "TreatmentPlan" WHERE "id"=$1 AND "organizationId"=$2`,
          [recovery.treatmentPlanId, command.context.organizationId],
        );
        const threshold = Math.max(policy?.requiredPublicationApprovals ?? 1, 1);
        if (
          command.decision === PublicationDecision.APPROVE &&
          (threshold > 1 || plan?.risk === 'HIGH' || plan?.risk === 'CRITICAL')
        ) {
          const treatmentPlanApprover = await queryOne<{ id: string }>(
            client,
            `SELECT "id" FROM "PlanApproval"
              WHERE "planId"=$1 AND "actorId"=$2 AND "decision"='APPROVE'::"PlanApprovalDecision"
              LIMIT 1`,
            [recovery.treatmentPlanId, command.context.actorId],
          );
          if (treatmentPlanApprover) {
            throw new Error(
              'Separation of duties prevents a treatment-plan approver from approving publication for this recovery.',
            );
          }
        }
        const publicationRound = recovery.currentPatchVersion;
        if (!publicationRound)
          throw new Error('Publication approval requires a committed patch version.');
        const decisionHash = digestPayload({
          recoveryId: recovery.id,
          decision: command.decision,
          actorId: command.context.actorId,
          comment: command.comment,
          publicationRound,
          expectedVersion: command.expectedVersion,
        });
        await client.query(
          `INSERT INTO "RecoveryPublicationApproval" (
             "id","organizationId","recoveryId","decision","comment","actorId","actorType","actorRoles",
             "recoveryVersion","requestId","correlationId","decisionHash","createdAt"
           ) VALUES ($1,$2,$3,$4::"PublicationDecision",$5,$6,$7::"ActorType",$8,$9,$10,$11,$12,NOW())
           ON CONFLICT ("recoveryId","recoveryVersion","actorId","decision") DO NOTHING`,
          [
            randomUUID(),
            command.context.organizationId,
            recovery.id,
            command.decision,
            command.comment,
            command.context.actorId,
            command.context.actorType,
            command.context.actorRoles,
            publicationRound,
            command.context.requestId,
            command.context.correlationId,
            decisionHash,
          ],
        );
        const count = await queryOne<{ count: string }>(
          client,
          `SELECT COUNT(DISTINCT "actorId")::text AS count FROM "RecoveryPublicationApproval" WHERE "recoveryId"=$1 AND "recoveryVersion"=$2 AND "decision"='APPROVE'`,
          [recovery.id, publicationRound],
        );
        const approved =
          command.decision === PublicationDecision.APPROVE &&
          Number(count?.count ?? 0) >= threshold;
        const next =
          command.decision === PublicationDecision.REJECT
            ? RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL
            : approved
              ? RecoveryRunStatus.READY_TO_PUBLISH
              : RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL;
        await client.query(
          `UPDATE "RecoveryRun" SET "status"=$3::"RecoveryRunStatus","version"="version"+1,"updatedAt"=NOW() WHERE "id"=$1 AND "organizationId"=$2`,
          [recovery.id, command.context.organizationId, next],
        );
        await appendRecoveryEvent(client, {
          recoveryId: recovery.id,
          type:
            command.decision === PublicationDecision.APPROVE
              ? 'RECOVERY_PUBLICATION_APPROVAL_RECORDED'
              : 'RECOVERY_PUBLICATION_REJECTED',
          payload: {
            decision: command.decision,
            publicationRound,
            approvalCount: Number(count?.count ?? 0),
            requiredApprovals: threshold,
            readyToPublish: approved,
          },
          actorType: command.context.actorType,
          actorId: command.context.actorId,
          requestId: command.context.requestId,
          correlationId: command.context.correlationId,
        });
        return await this.getRecoveryInTransaction(
          client,
          command.context.organizationId,
          recovery.id,
        );
      },
      { tenantOrganizationId: command.context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async requestRevision(
    context: StoreActorContext,
    recoveryId: string,
    input: RecoveryRevisionRequest,
  ): Promise<RecoveryRun> {
    return await withTransaction(
      async (client) => {
        const row = await this.getRecoveryRow(client, context.organizationId, recoveryId, true);
        if (row.version !== input.expectedRecoveryVersion) throw new OptimisticConcurrencyError();
        if (
          ![
            RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
            RecoveryRunStatus.READY_TO_PUBLISH,
            RecoveryRunStatus.PATCH_REJECTED,
            RecoveryRunStatus.SECURITY_REJECTED,
            RecoveryRunStatus.VERIFICATION_FAILED,
            RecoveryRunStatus.MODEL_FAILED,
            RecoveryRunStatus.TOOL_FAILED,
            RecoveryRunStatus.WORKTREE_FAILED,
          ].includes(row.status as RecoveryRunStatus)
        ) {
          throw new Error('Recovery revision is not allowed from the current state.');
        }
        const nextInput = {
          ...((
            await queryOne<{ input: StartRecoveryInput }>(
              client,
              `SELECT "input" FROM "RecoveryRun" WHERE "id"=$1`,
              [recoveryId],
            )
          )?.input ?? {}),
          additionalConstraints: input.additionalConstraints,
          revisionComment: input.comment,
        };
        await client.query(
          `UPDATE "RecoveryRun" SET "status"='REQUESTED',"input"=$3::jsonb,
             "cancellationRequestedAt"=NULL,"completedAt"=NULL,"errorCode"=NULL,"errorMessage"=NULL,
             "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,
             "version"="version"+1,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [recoveryId, context.organizationId, canonicalJson(nextInput)],
        );
        const job = ControlledRecoveryJobSchema.parse({
          recoveryId,
          organizationId: context.organizationId,
          incidentId: row.incidentId,
          treatmentPlanId: row.treatmentPlanId,
          requestedBy: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          requestedAt: new Date().toISOString(),
          attempt: 1,
        });
        await client.query(
          `INSERT INTO "OutboxMessage" (
             "id","organizationId","topic","partitionKey","deduplicationKey","payload",
             "status","attempts","availableAt","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,NOW(),NOW(),NOW())`,
          [
            randomUUID(),
            context.organizationId,
            CONTROLLED_RECOVERY_OUTBOX_TOPIC,
            recoveryId,
            `recovery.execute:${recoveryId}:revision:${row.version + 1}`,
            canonicalJson(job),
          ],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type: 'RECOVERY_REVISION_REQUESTED',
          payload: { comment: input.comment, additionalConstraints: input.additionalConstraints },
          actorType: context.actorType,
          actorId: context.actorId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        });
        return await this.getRecoveryInTransaction(client, context.organizationId, recoveryId);
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async complete(
    organizationId: string,
    recoveryId: string,
    workerId: string,
    status: RecoveryRunStatus,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertLease(client, organizationId, recoveryId, workerId);
        await client.query(
          `UPDATE "RecoveryRun" SET "status"=$3::"RecoveryRunStatus","completedAt"=NOW(),
             "errorCode"=$4,"errorMessage"=$5,"leaseOwner"=NULL,"leaseExpiresAt"=NULL,
             "version"="version"+1,"updatedAt"=NOW() WHERE "id"=$1 AND "organizationId"=$2`,
          [
            recoveryId,
            organizationId,
            status,
            errorCode ?? null,
            errorMessage?.slice(0, 2_000) ?? null,
          ],
        );
        await appendRecoveryEvent(client, {
          recoveryId,
          type:
            status === RecoveryRunStatus.CANCELLED
              ? 'RECOVERY_CANCELLED'
              : status === RecoveryRunStatus.READY_TO_PUBLISH
                ? 'RECOVERY_READY_TO_PUBLISH'
                : 'RECOVERY_FAILED',
          payload: { status, errorCode: errorCode ?? null },
          actorType: ActorType.SERVICE,
          actorId: workerId,
        });
      },
      { workerBypassRls: true, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async markCleanup(command: {
    organizationId: string;
    recoveryId: string;
    workerId: string;
    worktreeAbsent: boolean;
    branchDeleted: boolean;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        const attemptRow = await queryOne<{ attempt: number }>(
          client,
          `SELECT COALESCE(MAX("attempt"),0)+1 AS attempt FROM "RecoveryCleanupRecord" WHERE "recoveryId"=$1`,
          [command.recoveryId],
        );
        const attempt = Number(attemptRow?.attempt ?? 1);
        const payload = {
          recoveryId: command.recoveryId,
          attempt,
          worktreeAbsent: command.worktreeAbsent,
          branchDeleted: command.branchDeleted,
          verifiedAt: new Date().toISOString(),
          errorCode: command.errorCode ?? null,
          errorMessage: command.errorMessage ?? null,
        };
        await client.query(
          `INSERT INTO "RecoveryCleanupRecord" (
             "id","recoveryId","attempt","worktreeAbsent","branchDeleted","verifiedAt",
             "errorCode","errorMessage","cleanupDigest","createdAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [
            randomUUID(),
            command.recoveryId,
            attempt,
            command.worktreeAbsent,
            command.branchDeleted,
            payload.verifiedAt,
            command.errorCode ?? null,
            command.errorMessage?.slice(0, 2_000) ?? null,
            digestPayload(payload),
          ],
        );
        if (command.worktreeAbsent)
          await client.query(
            `UPDATE "RecoveryWorktree" SET "status"='REMOVED',"removedAt"=NOW() WHERE "recoveryId"=$1`,
            [command.recoveryId],
          );
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async listStaleRecoveryJobs(staleSeconds: number, limit = 25): Promise<ControlledRecoveryJob[]> {
    return await withTransaction(
      async (client) => {
        const rows = await queryMany<{
          id: string;
          organizationId: string;
          incidentId: string;
          treatmentPlanId: string;
          requestedBy: string;
          createdAt: Date;
        }>(
          client,
          `SELECT "id","organizationId","incidentId","treatmentPlanId","requestedBy","createdAt"
             FROM "RecoveryRun"
            WHERE "status" NOT IN ('PUBLISHED','POLICY_BLOCKED','CANCELLED','BUDGET_EXCEEDED','CLEANUP_FAILED')
              AND ("heartbeatAt" IS NULL OR "heartbeatAt" < NOW()-($1*INTERVAL '1 second'))
              AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())
            ORDER BY COALESCE("heartbeatAt","createdAt") ASC
            LIMIT $2`,
          [Math.min(Math.max(staleSeconds, 60), 86_400), Math.min(Math.max(limit, 1), 100)],
        );
        return rows.map((row) =>
          ControlledRecoveryJobSchema.parse({
            recoveryId: row.id,
            organizationId: row.organizationId,
            incidentId: row.incidentId,
            treatmentPlanId: row.treatmentPlanId,
            requestedBy: row.requestedBy,
            requestId: `reconcile-${row.id}`,
            correlationId: `reconcile-${row.id}`,
            requestedAt: new Date().toISOString(),
            attempt: 1,
          }),
        );
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  async loadRecoveryContext(organizationId: string, recoveryId: string) {
    return await withTransaction(
      async (client) => {
        const row = await queryOne<Record<string, unknown>>(
          client,
          `SELECT rr.*,r."defaultBranch",rw."relativePath" AS "sourceRelativePath",
                  tp."goal",tp."risk",tp."verificationMatrix",tp."rollbackStrategy",
                  tp."compatibilityImpact",tp."migrationImpact",tp."knownLimitations",
                  d."summary" AS "diagnosisSummary",d."contentHash" AS "diagnosisHash",
                  fr."originalFailureSignature",fr."input" AS "reproductionInput",
                  wr."relativePath" AS "recoveryWorktreeRelativePath",
                  wr."repositoryPathRef" AS "recoveryRepositoryPathRef",
                  wr."status" AS "recoveryWorktreeStatus"
             FROM "RecoveryRun" rr
             JOIN "Repository" r ON r."id"=rr."repositoryId"
             JOIN "RepositoryWorktree" rw ON rw."repositoryId"=r."id" AND rw."status"='ACTIVE'
             JOIN "TreatmentPlan" tp ON tp."id"=rr."treatmentPlanId"
             JOIN "Diagnosis" d ON d."id"=tp."diagnosisId"
             JOIN "InvestigationRun" ir ON ir."id"=tp."investigationId"
             JOIN "FailureReproduction" fr ON fr."id"=ir."reproductionId"
             LEFT JOIN "RecoveryWorktree" wr ON wr."recoveryId"=rr."id"
            WHERE rr."id"=$1 AND rr."organizationId"=$2
            ORDER BY rw."createdAt" DESC LIMIT 1`,
          [recoveryId, organizationId],
        );
        if (!row) throw new TenantResourceNotFoundError('Recovery context');
        const steps = await queryMany<Record<string, unknown>>(
          client,
          `SELECT * FROM "TreatmentPlanStep" WHERE "planId"=$1 ORDER BY "sequence"`,
          [row.treatmentPlanId],
        );
        return { ...row, steps };
      },
      { workerBypassRls: true },
      this.pool,
    );
  }

  private async upsertPolicy(
    client: PoolClient,
    organizationId: string,
    actorId: string,
    policy: RecoveryPolicy,
  ): Promise<string> {
    const contentHash = digestPayload(policy);
    const existing = await queryOne<{ id: string }>(
      client,
      `SELECT "id" FROM "OrganizationRecoveryPolicy" WHERE "organizationId"=$1 AND "policyVersion"=$2`,
      [organizationId, policy.policyVersion],
    );
    if (existing) return existing.id;
    const id = randomUUID();
    await client.query(
      `INSERT INTO "OrganizationRecoveryPolicy" (
         "id","organizationId","policyVersion","active","allowedPaths","deniedPaths","allowedExtensions",
         "maximumChangedFiles","maximumChangedLines","maximumPatchHunks","maximumPatchBytes","allowNewFiles",
         "allowDeletedFiles","allowGeneratedFiles","allowDependencyChanges","allowLockfileChanges",
         "allowWorkflowChanges","allowInfrastructureChanges","allowMigrationChanges","allowSecuritySensitiveChanges",
         "requireSecurityReview","requireIndependentVerification","requireHumanPublicationApproval",
         "requiredPublicationApprovals","retentionDays","contentHash","createdBy","createdAt"
       ) VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW())`,
      [
        id,
        organizationId,
        policy.policyVersion,
        policy.allowedPaths,
        policy.deniedPaths,
        policy.allowedExtensions,
        policy.maximumChangedFiles,
        policy.maximumChangedLines,
        policy.maximumPatchHunks,
        policy.maximumPatchBytes,
        policy.allowNewFiles,
        policy.allowDeletedFiles,
        policy.allowGeneratedFiles,
        policy.allowDependencyChanges,
        policy.allowLockfileChanges,
        policy.allowWorkflowChanges,
        policy.allowInfrastructureChanges,
        policy.allowMigrationChanges,
        policy.allowSecuritySensitiveChanges,
        policy.requireSecurityReview,
        policy.requireIndependentVerification,
        policy.requireHumanPublicationApproval,
        policy.requiredPublicationApprovals,
        policy.retentionDays,
        contentHash,
        actorId,
      ],
    );
    return id;
  }

  private mapPolicy(row: Record<string, unknown>): RecoveryPolicy {
    return {
      policyVersion: String(row.policyVersion),
      allowedPaths: row.allowedPaths as string[],
      deniedPaths: row.deniedPaths as string[],
      allowedExtensions: row.allowedExtensions as string[],
      maximumChangedFiles: Number(row.maximumChangedFiles),
      maximumChangedLines: Number(row.maximumChangedLines),
      maximumPatchHunks: Number(row.maximumPatchHunks),
      maximumPatchBytes: Number(row.maximumPatchBytes),
      allowNewFiles: Boolean(row.allowNewFiles),
      allowDeletedFiles: Boolean(row.allowDeletedFiles),
      allowGeneratedFiles: Boolean(row.allowGeneratedFiles),
      allowDependencyChanges: Boolean(row.allowDependencyChanges),
      allowLockfileChanges: Boolean(row.allowLockfileChanges),
      allowWorkflowChanges: Boolean(row.allowWorkflowChanges),
      allowInfrastructureChanges: Boolean(row.allowInfrastructureChanges),
      allowMigrationChanges: Boolean(row.allowMigrationChanges),
      allowSecuritySensitiveChanges: Boolean(row.allowSecuritySensitiveChanges),
      requireSecurityReview: true,
      requireIndependentVerification: true,
      requireHumanPublicationApproval: true,
      requiredPublicationApprovals: Number(row.requiredPublicationApprovals),
      retentionDays: Number(row.retentionDays),
    };
  }

  private async getRecoveryRow(
    client: PoolClient,
    organizationId: string,
    recoveryId: string,
    forUpdate = false,
  ): Promise<RecoveryRow> {
    const row = await queryOne<RecoveryRow>(
      client,
      `SELECT * FROM "RecoveryRun" WHERE "id"=$1 AND "organizationId"=$2${forUpdate ? ' FOR UPDATE' : ''}`,
      [recoveryId, organizationId],
    );
    if (!row) throw new TenantResourceNotFoundError('Recovery');
    return row;
  }

  private async getRecoveryInTransaction(
    client: PoolClient,
    organizationId: string,
    recoveryId: string,
  ): Promise<RecoveryRun> {
    return mapRecovery(await this.getRecoveryRow(client, organizationId, recoveryId));
  }
}
