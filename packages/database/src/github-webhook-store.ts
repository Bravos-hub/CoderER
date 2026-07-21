import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { GITHUB_WEBHOOK_OUTBOX_TOPIC } from '@codeer/contracts';
import { canonicalJson, digestPayload } from '@codeer/incidents';
import { assertPublicationTransition, PublicationStatus } from '@codeer/publication';
import { databasePool, queryOne, withTransaction } from './client.js';

/**
 * Durable GitHub webhook ingestion store. Delivery reservation works without
 * a tenant context (RLS allows NULL organization rows); tenant resolution runs
 * through narrowly scoped SECURITY DEFINER functions and the delivery row is
 * then bound to the resolved organization. Event payloads are never persisted
 * here — only identifiers, digests and processing state.
 */

export type WebhookDeliveryStatus = 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'REJECTED' | 'FAILED';

export interface ReserveWebhookDeliveryInput {
  deliveryId: string;
  eventName: string;
  action: string | null;
  signatureValid: boolean;
  payloadDigest: string;
  installationExternalId: number | null;
}

export interface ResolvedWebhookTenant {
  organizationId: string;
  installationUuid: string;
  accountLogin: string;
  repositoryId: string | null;
}

async function appendPublicationEvent(
  client: PoolClient,
  input: {
    publicationId: string;
    type: string;
    payload: Record<string, unknown>;
    actorId: string;
    correlationId: string;
  },
): Promise<void> {
  const last = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence", "eventHash" FROM "PublicationEvent"
     WHERE "publicationId"=$1 ORDER BY "sequence" DESC LIMIT 1`,
    [input.publicationId],
  );
  const sequence = (last?.sequence ?? 0) + 1;
  const occurredAt = new Date().toISOString();
  const eventHash = digestPayload({
    publicationId: input.publicationId,
    sequence,
    type: input.type,
    payload: input.payload,
    previousHash: last?.eventHash ?? null,
    occurredAt,
  });
  await client.query(
    `INSERT INTO "PublicationEvent" (
       "id","publicationId","sequence","type","payload","previousHash","eventHash",
       "actorType","actorId","correlationId","occurredAt","createdAt"
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'SYSTEM',$8,$9,$10,$10)`,
    [
      randomUUID(),
      input.publicationId,
      sequence,
      input.type,
      canonicalJson(input.payload),
      last?.eventHash ?? null,
      eventHash,
      input.actorId,
      input.correlationId,
      occurredAt,
    ],
  );
}

export class GithubWebhookStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  /** Returns the delivery row id, or undefined when the delivery is a replay. */
  async reserveWebhookDelivery(input: ReserveWebhookDeliveryInput): Promise<string | undefined> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<{ id: string }>(
          client,
          `INSERT INTO "GithubWebhookDelivery" (
             "id","organizationId","installationId","deliveryId","eventName","action",
             "signatureValid","payloadDigest","status","receivedAt","createdAt"
           ) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,'RECEIVED',NOW(),NOW())
           ON CONFLICT ("deliveryId") DO NOTHING
           RETURNING "id"`,
          [
            randomUUID(),
            input.installationExternalId,
            input.deliveryId,
            input.eventName,
            input.action,
            input.signatureValid,
            input.payloadDigest,
          ],
        );
        return row?.id;
      },
      {},
      this.pool,
    );
  }

  async resolveAndAssignTenant(
    deliveryId: string,
    installationExternalId: number,
    repositoryExternalId: string | null,
  ): Promise<ResolvedWebhookTenant | undefined> {
    const installation = await withTransaction(
      async (client) =>
        queryOne<{ organizationId: string; installationUuid: string; accountLogin: string }>(
          client,
          `SELECT * FROM codeer_resolve_github_installation($1::bigint)`,
          [installationExternalId],
        ),
      {},
      this.pool,
    );
    if (!installation) return undefined;
    let repositoryId: string | null = null;
    if (repositoryExternalId) {
      const repository = await withTransaction(
        async (client) =>
          queryOne<{ repositoryId: string }>(
            client,
            `SELECT * FROM codeer_resolve_github_repository($1::uuid, $2)`,
            [installation.organizationId, repositoryExternalId],
          ),
        {},
        this.pool,
      );
      repositoryId = repository?.repositoryId ?? null;
    }
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE "GithubWebhookDelivery" SET "organizationId"=$2 WHERE "deliveryId"=$1`,
          [deliveryId, installation.organizationId],
        );
      },
      { tenantOrganizationId: installation.organizationId },
      this.pool,
    );
    return { ...installation, repositoryId };
  }

  /** Marks a delivery whose tenant could not be resolved (NULL organization). */
  async markUnresolvedDeliveryStatus(
    deliveryId: string,
    status: WebhookDeliveryStatus,
    errorCode?: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE "GithubWebhookDelivery"
           SET "status"=$2, "errorCode"=$3, "processedAt"=NOW()
           WHERE "deliveryId"=$1 AND "organizationId" IS NULL`,
          [deliveryId, status, errorCode ?? null],
        );
      },
      {},
      this.pool,
    );
  }

  async markWebhookDeliveryStatus(
    organizationId: string,
    deliveryId: string,
    status: WebhookDeliveryStatus,
    errorCode?: string,
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE "GithubWebhookDelivery"
           SET "status"=$3, "errorCode"=$4,
             "processedAt"=CASE WHEN $3 IN ('PROCESSED','IGNORED','REJECTED') THEN NOW() ELSE "processedAt" END
           WHERE "deliveryId"=$1 AND "organizationId"=$2`,
          [deliveryId, organizationId, status, errorCode ?? null],
        );
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async enqueueWebhookProcessMessage(input: {
    deliveryId: string;
    organizationId: string;
    eventName: string;
    correlationId: string;
    normalized: Record<string, unknown>;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await client.query(
          `INSERT INTO "OutboxMessage" (
             "id","organizationId","topic","partitionKey","deduplicationKey","payload",
             "status","attempts","availableAt","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,NOW(),NOW(),NOW())
           ON CONFLICT ("deduplicationKey") DO NOTHING`,
          [
            randomUUID(),
            input.organizationId,
            GITHUB_WEBHOOK_OUTBOX_TOPIC,
            input.deliveryId,
            `github.webhook.process:${input.deliveryId}:1`,
            canonicalJson({
              deliveryId: input.deliveryId,
              organizationId: input.organizationId,
              eventName: input.eventName,
              attempt: 1,
              correlationId: input.correlationId,
              normalized: input.normalized,
            }),
          ],
        );
      },
      { tenantOrganizationId: input.organizationId },
      this.pool,
    );
  }

  async findPublicationIdByHeadSha(
    organizationId: string,
    headSha: string,
  ): Promise<string | undefined> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<{ publicationId: string }>(
          client,
          `SELECT pr."publicationId" FROM "PullRequestRecord" pr
           JOIN "PublicationRun" p ON p."id" = pr."publicationId"
           WHERE pr."headSha"=$1 AND p."organizationId"=$2
           ORDER BY pr."createdAt" DESC LIMIT 1`,
          [headSha, organizationId],
        );
        return row?.publicationId;
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async findPublicationIdByPullRequestNumber(
    organizationId: string,
    number: number,
  ): Promise<string | undefined> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<{ publicationId: string }>(
          client,
          `SELECT pr."publicationId" FROM "PullRequestRecord" pr
           JOIN "PublicationRun" p ON p."id" = pr."publicationId"
           WHERE pr."number"=$1 AND p."organizationId"=$2
           ORDER BY pr."createdAt" DESC LIMIT 1`,
          [number, organizationId],
        );
        return row?.publicationId;
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async upsertPublicationCheck(
    organizationId: string,
    input: {
      publicationId: string;
      externalId: string;
      name: string;
      status: string;
      headSha: string | null;
      detailsUrl: string | null;
      startedAt: string | null;
      completedAt: string | null;
      rawConclusion: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        const existing = await queryOne<{ id: string }>(
          client,
          `SELECT c."id" FROM "PublicationCheck" c
           JOIN "PublicationRun" p ON p."id" = c."publicationId"
           WHERE c."publicationId"=$1 AND c."externalId"=$2 AND p."organizationId"=$3`,
          [input.publicationId, input.externalId, organizationId],
        );
        if (existing) {
          await client.query(
            `UPDATE "PublicationCheck" SET "status"=$3, "headSha"=$4, "detailsUrl"=$5,
               "startedAt"=$6, "completedAt"=$7, "rawConclusion"=$8, "updatedAt"=NOW()
             WHERE "id"=$1 AND "publicationId"=$2`,
            [
              existing.id,
              input.publicationId,
              input.status,
              input.headSha,
              input.detailsUrl,
              input.startedAt,
              input.completedAt,
              input.rawConclusion,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO "PublicationCheck" (
               "id","publicationId","externalId","name","provider","status","required",
               "detailsUrl","headSha","startedAt","completedAt","rawConclusion","createdAt","updatedAt"
             ) VALUES ($1,$2,$3,$4,'github',$5,FALSE,$6,$7,$8,$9,$10,NOW(),NOW())`,
            [
              randomUUID(),
              input.publicationId,
              input.externalId,
              input.name,
              input.status,
              input.detailsUrl,
              input.headSha,
              input.startedAt,
              input.completedAt,
              input.rawConclusion,
            ],
          );
        }
        await appendPublicationEvent(client, {
          publicationId: input.publicationId,
          type: 'CHECK_SYNCHRONIZED',
          payload: {
            externalId: input.externalId,
            name: input.name,
            status: input.status,
            headSha: input.headSha,
          },
          actorId: 'github-webhook-worker',
          correlationId: input.correlationId,
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async upsertPublicationReview(
    organizationId: string,
    input: {
      publicationId: string;
      externalId: string;
      reviewerLogin: string;
      state: string;
      submittedAt: string | null;
      bodyDigest: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await withTransaction(
      async (client) => {
        const existing = await queryOne<{ id: string }>(
          client,
          `SELECT r."id" FROM "PublicationReview" r
           JOIN "PublicationRun" p ON p."id" = r."publicationId"
           WHERE r."publicationId"=$1 AND r."externalId"=$2 AND p."organizationId"=$3`,
          [input.publicationId, input.externalId, organizationId],
        );
        if (existing) {
          await client.query(
            `UPDATE "PublicationReview" SET "state"=$3, "submittedAt"=$4, "bodyDigest"=$5,
               "updatedAt"=NOW()
             WHERE "id"=$1 AND "publicationId"=$2`,
            [existing.id, input.publicationId, input.state, input.submittedAt, input.bodyDigest],
          );
        } else {
          await client.query(
            `INSERT INTO "PublicationReview" (
               "id","publicationId","externalId","reviewerLogin","reviewerNodeId","state",
               "codeOwner","bodyDigest","submittedAt","createdAt","updatedAt"
             ) VALUES ($1,$2,$3,$4,NULL,$5,FALSE,$6,$7,NOW(),NOW())`,
            [
              randomUUID(),
              input.publicationId,
              input.externalId,
              input.reviewerLogin,
              input.state,
              input.bodyDigest,
              input.submittedAt,
            ],
          );
        }
        await appendPublicationEvent(client, {
          publicationId: input.publicationId,
          type: 'REVIEW_SYNCHRONIZED',
          payload: {
            externalId: input.externalId,
            reviewerLogin: input.reviewerLogin,
            state: input.state,
          },
          actorId: 'github-webhook-worker',
          correlationId: input.correlationId,
        });
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async applyPullRequestUpdate(
    organizationId: string,
    input: {
      number: number;
      state: 'open' | 'closed' | 'merged';
      draft: boolean;
      headSha: string;
      baseSha: string;
      merged: boolean;
      mergedBy: string | null;
      mergedAt: string | null;
      mergeCommitSha: string | null;
      correlationId: string;
    },
  ): Promise<{ publicationId: string; merged: boolean } | undefined> {
    return withTransaction(
      async (client) => {
        const record = await queryOne<{ publicationId: string }>(
          client,
          `SELECT pr."publicationId" FROM "PullRequestRecord" pr
           JOIN "PublicationRun" p ON p."id" = pr."publicationId"
           WHERE pr."number"=$1 AND p."organizationId"=$2
           ORDER BY pr."createdAt" DESC LIMIT 1`,
          [input.number, organizationId],
        );
        if (!record) return undefined;
        await client.query(
          `UPDATE "PullRequestRecord" SET "state"=$3, "draft"=$4, "headSha"=$5, "baseSha"=$6,
             "updatedAt"=NOW()
           WHERE "publicationId"=$1 AND "number"=$2`,
          [
            record.publicationId,
            input.number,
            input.state,
            input.draft,
            input.headSha,
            input.baseSha,
          ],
        );
        let merged = false;
        if (input.merged && input.mergeCommitSha) {
          await client.query(
            `INSERT INTO "MergeObservation" (
               "id","publicationId","mergeCommitSha","mergedBy","mergedAt","approvedHeadSha",
               "observedTreeSha","integrityValid","createdAt"
             ) VALUES ($1,$2,$3,$4,$5,$6,NULL,TRUE,NOW())
             ON CONFLICT ("publicationId") DO NOTHING`,
            [
              randomUUID(),
              record.publicationId,
              input.mergeCommitSha,
              input.mergedBy,
              input.mergedAt ?? new Date().toISOString(),
              input.headSha,
            ],
          );
          const run = await queryOne<{ status: PublicationStatus }>(
            client,
            `SELECT p."status" FROM "PublicationRun" p
             WHERE p."id"=$1 AND p."organizationId"=$2 FOR UPDATE`,
            [record.publicationId, organizationId],
          );
          if (run && run.status !== PublicationStatus.MERGED) {
            try {
              assertPublicationTransition(run.status, PublicationStatus.MERGED);
              await client.query(
                `UPDATE "PublicationRun" SET "status"='MERGED', "version"="version"+1, "updatedAt"=NOW()
                 WHERE "id"=$1 AND "organizationId"=$2`,
                [record.publicationId, organizationId],
              );
              await appendPublicationEvent(client, {
                publicationId: record.publicationId,
                type: 'MERGE_OBSERVED',
                payload: {
                  mergeCommitSha: input.mergeCommitSha,
                  mergedBy: input.mergedBy,
                  headSha: input.headSha,
                },
                actorId: 'github-webhook-worker',
                correlationId: input.correlationId,
              });
              merged = true;
            } catch {
              // Transition not valid from the current status; the observation is
              // still persisted above so a later reconciliation can converge.
            }
          }
        }
        return { publicationId: record.publicationId, merged };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }
}
