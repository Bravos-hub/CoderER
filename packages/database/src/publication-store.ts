import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson, digestPayload } from '@codeer/incidents';
import {
  ApprovedRecoveryPackageSchema,
  PublicationPolicySchema,
  PublicationRunSchema,
  type PublicationStatus,
  evaluatePublicationPolicy,
  type ApprovedRecoveryPackage,
  type PublicationPolicy,
  type PublicationRun,
} from '@codeer/publication';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';
import type { StoreActorContext } from './incident-store.js';

export const PUBLICATION_OUTBOX_TOPIC = 'publication.execute.v1';

interface PublicationRow {
  id: string;
  organizationId: string;
  incidentId: string;
  recoveryId: string;
  repositoryId: string;
  installationExternalId: string;
  status: string;
  version: number;
  policyVersion: string;
  baseBranch: string;
  headBranch: string;
  baseCommitSha: string;
  patchDigest: string;
  treeSha: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapPublication(row: PublicationRow): PublicationRun {
  return PublicationRunSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    incidentId: row.incidentId,
    recoveryId: row.recoveryId,
    repositoryId: row.repositoryId,
    installationId: row.installationExternalId,
    status: row.status,
    version: row.version,
    policyVersion: row.policyVersion,
    baseBranch: row.baseBranch,
    headBranch: row.headBranch,
    baseCommitSha: row.baseCommitSha,
    patchDigest: row.patchDigest,
    treeSha: row.treeSha,
    commitSha: row.commitSha,
    pullRequestNumber: row.pullRequestNumber,
    pullRequestUrl: row.pullRequestUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export interface CreatePublicationCommand {
  context: StoreActorContext;
  recoveryId: string;
  installationId: string;
  package: ApprovedRecoveryPackage;
  policy: PublicationPolicy;
  idempotencyKey: string;
}

export class PublicationStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async createPublication(command: CreatePublicationCommand): Promise<PublicationRun> {
    const approvedPackage = ApprovedRecoveryPackageSchema.parse(command.package);
    const policy = PublicationPolicySchema.parse(command.policy);
    if (approvedPackage.recoveryId !== command.recoveryId) {
      throw new Error('Recovery package does not match the requested recovery.');
    }
    if (approvedPackage.organizationId !== command.context.organizationId) {
      throw new Error('Recovery package organization does not match the actor context.');
    }
    const policyDecision = evaluatePublicationPolicy(approvedPackage, policy);
    if (!policyDecision.allowed) throw new Error(policyDecision.reasons.join(' '));

    return withTransaction(
      async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `publication-create:${command.context.organizationId}:${command.idempotencyKey}`,
        ]);
        const existing = await queryOne<PublicationRow>(
          client,
          `SELECT p.*, gi."installationId"::text AS "installationExternalId"
           FROM "PublicationRun" p JOIN "GithubInstallation" gi ON gi."id"=p."installationId"
           WHERE p."organizationId"=$1 AND p."idempotencyKey"=$2`,
          [command.context.organizationId, command.idempotencyKey],
        );
        if (existing) return mapPublication(existing);

        const recovery = await queryOne<{
          id: string;
          organizationId: string;
          incidentId: string;
          repositoryId: string;
          status: string;
          currentPatchVersion: number | null;
          baseCommitSha: string;
        }>(
          client,
          `SELECT "id","organizationId","incidentId","repositoryId","status","currentPatchVersion","baseCommitSha"
           FROM "RecoveryRun" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [command.recoveryId, command.context.organizationId],
        );
        if (!recovery) throw new Error('Recovery was not found in this organization.');
        if (recovery.status !== 'READY_TO_PUBLISH')
          throw new Error('Recovery is not ready to publish.');
        if (recovery.currentPatchVersion !== approvedPackage.patchVersion) {
          throw new Error('Approved patch version is stale.');
        }
        if (recovery.baseCommitSha !== approvedPackage.baseCommitSha) {
          throw new Error('Approved base commit does not match the recovery.');
        }

        const installation = await queryOne<{ id: string; installationId: string }>(
          client,
          `SELECT "id","installationId"::text FROM "GithubInstallation"
           WHERE "organizationId"=$1 AND "installationId"=$2::bigint AND "suspendedAt" IS NULL`,
          [command.context.organizationId, command.installationId],
        );
        if (!installation) throw new Error('Active GitHub installation was not found.');

        let policyRow = await queryOne<{ id: string }>(
          client,
          `SELECT "id" FROM "RepositoryPublicationPolicy"
           WHERE "organizationId"=$1 AND "repositoryId"=$2 AND "policyVersion"=$3 AND "active"=TRUE`,
          [command.context.organizationId, approvedPackage.repositoryId, policy.version],
        );
        if (!policyRow) {
          policyRow = { id: randomUUID() };
          await client.query(
            `INSERT INTO "RepositoryPublicationPolicy" (
               "id","organizationId","repositoryId","policyVersion","active","allowedBaseBranches",
               "recoveryBranchPrefix","requiredChecks","requiredApprovals","requireCodeOwnerApproval",
               "allowForcePush","allowProtectedBranchWrites","allowAutomaticMerge","maximumPublicationAttempts",
               "webhookReplayWindowSeconds","postMergeVerificationRequired","retentionDays","contentHash","createdBy"
             ) VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,FALSE,FALSE,FALSE,$10,$11,$12,$13,$14,$15)`,
            [
              policyRow.id,
              command.context.organizationId,
              approvedPackage.repositoryId,
              policy.version,
              policy.allowedBaseBranches,
              policy.recoveryBranchPrefix,
              policy.requiredChecks,
              policy.requiredApprovals,
              policy.requireCodeOwnerApproval,
              policy.maximumPublicationAttempts,
              policy.webhookReplayWindowSeconds,
              policy.postMergeVerificationRequired,
              policy.retentionDays,
              policyDecision.digest,
              command.context.actorId,
            ],
          );
        }

        const id = randomUUID();
        await client.query(
          `INSERT INTO "PublicationRun" (
             "id","organizationId","incidentId","recoveryId","repositoryId","installationId",
             "publicationPolicyId","status","policyVersion","baseBranch","headBranch","baseCommitSha",
             "approvedPatchVersion","patchDigest","expectedTreeDigest","idempotencyKey","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PUBLICATION_REQUESTED',$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
          [
            id,
            command.context.organizationId,
            approvedPackage.incidentId,
            command.recoveryId,
            approvedPackage.repositoryId,
            installation.id,
            policyRow.id,
            policy.version,
            approvedPackage.targetBaseBranch,
            approvedPackage.branchName,
            approvedPackage.baseCommitSha,
            approvedPackage.patchVersion,
            approvedPackage.patchDigest,
            approvedPackage.treeDigest,
            command.idempotencyKey,
          ],
        );
        const eventPayload = {
          recoveryId: command.recoveryId,
          patchVersion: approvedPackage.patchVersion,
          patchDigest: approvedPackage.patchDigest,
          policyDecisionDigest: policyDecision.digest,
        };
        await client.query(
          `INSERT INTO "PublicationEvent" (
             "id","publicationId","sequence","type","payload","previousHash","eventHash",
             "actorType","actorId","correlationId","occurredAt","createdAt"
           ) VALUES ($1,$2,1,'PUBLICATION_REQUESTED',$3::jsonb,NULL,$4,$5::"ActorType",$6,$7,NOW(),NOW())`,
          [
            randomUUID(),
            id,
            canonicalJson(eventPayload),
            digestPayload({ publicationId: id, sequence: 1, eventPayload }),
            command.context.actorType,
            command.context.actorId,
            command.context.correlationId,
          ],
        );
        await client.query(
          `INSERT INTO "OutboxMessage" (
             "id","organizationId","topic","partitionKey","deduplicationKey","payload",
             "status","attempts","availableAt","createdAt","updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,NOW(),NOW(),NOW())
           ON CONFLICT ("deduplicationKey") DO NOTHING`,
          [
            randomUUID(),
            command.context.organizationId,
            PUBLICATION_OUTBOX_TOPIC,
            id,
            `publication.execute:${id}:1`,
            canonicalJson({
              publicationId: id,
              organizationId: command.context.organizationId,
              attempt: 1,
            }),
          ],
        );
        const created = await queryOne<PublicationRow>(
          client,
          `SELECT p.*, gi."installationId"::text AS "installationExternalId"
           FROM "PublicationRun" p JOIN "GithubInstallation" gi ON gi."id"=p."installationId"
           WHERE p."id"=$1 AND p."organizationId"=$2`,
          [id, command.context.organizationId],
        );
        if (!created) throw new Error('Publication could not be reloaded.');
        return mapPublication(created);
      },
      { tenantOrganizationId: command.context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async getPublication(organizationId: string, publicationId: string): Promise<PublicationRun> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<PublicationRow>(
          client,
          `SELECT p.*, gi."installationId"::text AS "installationExternalId"
           FROM "PublicationRun" p JOIN "GithubInstallation" gi ON gi."id"=p."installationId"
           WHERE p."id"=$1 AND p."organizationId"=$2`,
          [publicationId, organizationId],
        );
        if (!row) throw new Error('Publication was not found.');
        return mapPublication(row);
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listForRecovery(organizationId: string, recoveryId: string): Promise<PublicationRun[]> {
    return withTransaction(
      async (client) => {
        const rows = await queryMany<PublicationRow>(
          client,
          `SELECT p.*, gi."installationId"::text AS "installationExternalId"
           FROM "PublicationRun" p JOIN "GithubInstallation" gi ON gi."id"=p."installationId"
           WHERE p."organizationId"=$1 AND p."recoveryId"=$2 ORDER BY p."createdAt" DESC`,
          [organizationId, recoveryId],
        );
        return rows.map(mapPublication);
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listEvents(organizationId: string, publicationId: string) {
    return withTransaction(
      async (client) =>
        queryMany(
          client,
          `SELECT e.* FROM "PublicationEvent" e JOIN "PublicationRun" p ON p."id"=e."publicationId"
         WHERE e."publicationId"=$1 AND p."organizationId"=$2 ORDER BY e."sequence"`,
          [publicationId, organizationId],
        ),
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listChecks(organizationId: string, publicationId: string) {
    return withTransaction(
      async (client) =>
        queryMany(
          client,
          `SELECT c.* FROM "PublicationCheck" c JOIN "PublicationRun" p ON p."id"=c."publicationId"
         WHERE c."publicationId"=$1 AND p."organizationId"=$2 ORDER BY c."name"`,
          [publicationId, organizationId],
        ),
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async listReviews(organizationId: string, publicationId: string) {
    return withTransaction(
      async (client) =>
        queryMany(
          client,
          `SELECT r.* FROM "PublicationReview" r JOIN "PublicationRun" p ON p."id"=r."publicationId"
         WHERE r."publicationId"=$1 AND p."organizationId"=$2 ORDER BY r."submittedAt" NULLS LAST, r."createdAt"`,
          [publicationId, organizationId],
        ),
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async transition(
    context: StoreActorContext,
    publicationId: string,
    expectedVersion: number,
    status: PublicationStatus,
  ): Promise<PublicationRun> {
    return withTransaction(
      async (client) => {
        const result = await client.query(
          `UPDATE "PublicationRun" SET "status"=$1::"PublicationStatus","version"="version"+1,"updatedAt"=NOW()
           WHERE "id"=$2 AND "organizationId"=$3 AND "version"=$4`,
          [status, publicationId, context.organizationId, expectedVersion],
        );
        if (result.rowCount !== 1)
          throw new Error('Publication version conflict or resource not found.');
        const row = await queryOne<PublicationRow>(
          client,
          `SELECT p.*, gi."installationId"::text AS "installationExternalId"
           FROM "PublicationRun" p JOIN "GithubInstallation" gi ON gi."id"=p."installationId"
           WHERE p."id"=$1 AND p."organizationId"=$2`,
          [publicationId, context.organizationId],
        );
        if (!row) throw new Error('Publication was not found.');
        return mapPublication(row);
      },
      { tenantOrganizationId: context.organizationId },
      this.pool,
    );
  }
}
