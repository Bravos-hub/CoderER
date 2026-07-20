import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalJson, digestPayload } from '@codeer/incidents';
import {
  ActorType,
  PUBLICATION_OUTBOX_TOPIC,
  PublicationExecutionJobSchema,
  type PublicationExecutionJob,
} from '@codeer/contracts';
import {
  ApprovedRecoveryPackageSchema,
  PublicationPolicySchema,
  PublicationRunSchema,
  PublicationStatus,
  assertPublicationTransition,
  isTerminalPublicationStatus,
  type PublicationExecutionBundle,
  evaluatePublicationPolicy,
  type ApprovedRecoveryPackage,
  type PublicationPolicy,
  type PublicationRun,
} from '@codeer/publication';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';
import type { StoreActorContext } from './incident-store.js';

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

export interface PublicationClaimEnvelope {
  id: string;
  organizationId: string;
  repositoryId: string;
  status: PublicationStatus;
  version: number;
  attemptCount: number;
  cancellationRequestedAt: string | null;
}

const EXECUTABLE_PUBLICATION_STATUSES = [
  'PUBLICATION_REQUESTED',
  'POLICY_CHECK',
  'COMMIT_MATERIALIZING',
  'BRANCH_PUBLISHING',
  'DRAFT_PR_CREATING',
  'PUSH_FAILED',
  'PR_CREATION_FAILED',
];

const IN_FLIGHT_PUBLICATION_STATUSES = [
  'PUBLICATION_REQUESTED',
  'POLICY_CHECK',
  'COMMIT_MATERIALIZING',
  'BRANCH_PUBLISHING',
  'DRAFT_PR_CREATING',
];

async function assertPublicationLease(
  client: PoolClient,
  organizationId: string,
  publicationId: string,
  workerId: string,
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    client,
    `SELECT "id" FROM "PublicationRun"
      WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3 AND "leaseExpiresAt">NOW()`,
    [publicationId, organizationId, workerId],
  );
  if (!row) throw new Error('Publication execution lease was lost.');
}

/**
 * Appends to the immutable, hash-chained publication event log. The event
 * hash excludes the sequence so a retried worker step does not duplicate the
 * logical event (idempotent via the unique eventHash constraint).
 */
async function appendPublicationEvent(
  client: PoolClient,
  command: {
    publicationId: string;
    type: string;
    payload: Record<string, unknown>;
    actorType: ActorType;
    actorId?: string | undefined;
    correlationId?: string | undefined;
  },
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `publication-event:${command.publicationId}`,
  ]);
  const latest = await queryOne<{ sequence: number; eventHash: string }>(
    client,
    `SELECT "sequence","eventHash" FROM "PublicationEvent"
      WHERE "publicationId"=$1 ORDER BY "sequence" DESC LIMIT 1`,
    [command.publicationId],
  );
  const sequence = (latest?.sequence ?? 0) + 1;
  const eventHash = digestPayload({
    publicationId: command.publicationId,
    type: command.type,
    payload: command.payload,
    actorType: command.actorType,
    actorId: command.actorId ?? null,
    correlationId: command.correlationId ?? null,
  });
  await client.query(
    `INSERT INTO "PublicationEvent" (
       "id","publicationId","sequence","type","payload","previousHash","eventHash",
       "actorType","actorId","correlationId","occurredAt","createdAt"
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::"ActorType",$9,$10,NOW(),NOW())
     ON CONFLICT ("eventHash") DO NOTHING`,
    [
      randomUUID(),
      command.publicationId,
      sequence,
      command.type,
      canonicalJson(command.payload),
      latest?.eventHash ?? null,
      eventHash,
      command.actorType,
      command.actorId ?? null,
      command.correlationId ?? null,
    ],
  );
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
              repositoryId: approvedPackage.repositoryId,
              attempt: 1,
              correlationId: command.context.correlationId,
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

  async listOrganization(organizationId: string, limit = 100): Promise<PublicationRun[]> {
    return withTransaction(
      async (client) => {
        const rows = await queryMany<PublicationRow>(
          client,
          `SELECT p.*, gi."installationId"::text AS "installationExternalId"
           FROM "PublicationRun" p JOIN "GithubInstallation" gi ON gi."id"=p."installationId"
           WHERE p."organizationId"=$1 ORDER BY p."createdAt" DESC LIMIT $2`,
          [organizationId, Math.min(Math.max(limit, 1), 100)],
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

  async claimPublication(
    organizationId: string,
    publicationId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<PublicationClaimEnvelope | null> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<{
          id: string;
          organizationId: string;
          repositoryId: string;
          status: PublicationStatus;
          version: number;
          attemptCount: number;
          cancellationRequestedAt: Date | null;
        }>(
          client,
          `UPDATE "PublicationRun" SET "leaseOwner"=$3,
             "leaseExpiresAt"=NOW()+($4*INTERVAL '1 second'),"heartbeatAt"=NOW(),
             "startedAt"=COALESCE("startedAt",NOW()),"attemptCount"="attemptCount"+1,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2
              AND ("leaseOwner" IS NULL OR "leaseExpiresAt"<NOW() OR "leaseOwner"=$3)
              AND "status"::text = ANY($5::text[])
            RETURNING "id","organizationId","repositoryId","status","version","attemptCount","cancellationRequestedAt"`,
          [
            publicationId,
            organizationId,
            workerId,
            Math.min(Math.max(leaseSeconds, 15), 900),
            EXECUTABLE_PUBLICATION_STATUSES,
          ],
        );
        if (!row) return null;
        return {
          id: row.id,
          organizationId: row.organizationId,
          repositoryId: row.repositoryId,
          status: row.status,
          version: row.version,
          attemptCount: row.attemptCount,
          cancellationRequestedAt: row.cancellationRequestedAt?.toISOString() ?? null,
        };
      },
      { tenantOrganizationId: organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async heartbeat(
    organizationId: string,
    publicationId: string,
    workerId: string,
    leaseSeconds: number,
  ) {
    return withTransaction(
      async (client) => {
        const row = await queryOne<{ cancellationRequestedAt: Date | null }>(
          client,
          `UPDATE "PublicationRun" SET "heartbeatAt"=NOW(),
             "leaseExpiresAt"=NOW()+($4*INTERVAL '1 second'),"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2 AND "leaseOwner"=$3 AND "leaseExpiresAt">NOW()
            RETURNING "cancellationRequestedAt"`,
          [publicationId, organizationId, workerId, Math.min(Math.max(leaseSeconds, 15), 900)],
        );
        if (!row) throw new Error('Publication execution lease was lost.');
        return { cancellationRequested: Boolean(row.cancellationRequestedAt) };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async releaseLease(organizationId: string, publicationId: string, workerId: string): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertPublicationLease(client, organizationId, publicationId, workerId);
        await client.query(
          `UPDATE "PublicationRun" SET "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NOW(),
             "version"="version"+1,"updatedAt"=NOW()
            WHERE "id"=$1 AND "organizationId"=$2`,
          [publicationId, organizationId],
        );
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  /** Loads and re-validates everything the execution worker needs, from persisted state only. */
  async loadExecutionBundle(
    organizationId: string,
    publicationId: string,
  ): Promise<PublicationExecutionBundle> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<Record<string, unknown>>(
          client,
          `SELECT p."id", p."organizationId", p."repositoryId", p."recoveryId", p."status", p."version",
                  p."attemptCount", p."policyVersion", p."baseBranch", p."headBranch", p."baseCommitSha",
                  p."approvedPatchVersion", p."patchDigest", p."expectedTreeDigest", p."treeSha", p."commitSha",
                  p."pullRequestNumber", p."pullRequestUrl",
                  gi."installationId"::text AS "installationExternalId",
                  r."owner" AS "repositoryOwner", r."name" AS "repositoryName", r."providerRepoId",
                  rr."status" AS "recoveryStatus", rr."currentPatchVersion",
                  rr."baseCommitSha" AS "recoveryBaseCommitSha",
                  pol."allowedBaseBranches", pol."recoveryBranchPrefix", pol."requiredChecks",
                  pol."requiredApprovals", pol."requireCodeOwnerApproval", pol."maximumPublicationAttempts",
                  pol."webhookReplayWindowSeconds", pol."postMergeVerificationRequired", pol."retentionDays"
           FROM "PublicationRun" p
           JOIN "GithubInstallation" gi ON gi."id" = p."installationId"
           JOIN "Repository" r ON r."id" = p."repositoryId"
           JOIN "RecoveryRun" rr ON rr."id" = p."recoveryId"
           JOIN "RepositoryPublicationPolicy" pol ON pol."id" = p."publicationPolicyId"
           WHERE p."id"=$1 AND p."organizationId"=$2`,
          [publicationId, organizationId],
        );
        if (!row) throw new Error('Publication was not found.');
        const patch = await queryOne<{
          id: string;
          version: number;
          unifiedDiff: string;
          patchDigest: string;
        }>(
          client,
          `SELECT "id","version","unifiedDiff","patchDigest" FROM "RecoveryPatchVersion"
            WHERE "recoveryId"=$1 AND "version"=$2`,
          [row.recoveryId, row.approvedPatchVersion],
        );
        if (!patch) throw new Error('Approved patch version was not found.');
        const prPackage = await queryOne<{ title: string; body: string }>(
          client,
          `SELECT "title","body" FROM "RecoveryPullRequestPackage"
            WHERE "recoveryId"=$1 AND "patchId"=$2 ORDER BY "version" DESC LIMIT 1`,
          [row.recoveryId, patch.id],
        );
        if (!prPackage) throw new Error('Approved pull request package was not found.');
        const securityReview = await queryOne<{ decision: string }>(
          client,
          `SELECT "decision"::text AS "decision" FROM "RecoverySecurityReview"
            WHERE "patchId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
          [patch.id],
        );
        const verification = await queryOne<{ status: string }>(
          client,
          `SELECT "status"::text AS "status" FROM "RecoveryVerificationRun"
            WHERE "patchId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
          [patch.id],
        );
        const approvals = await queryOne<{ count: string; latest: Date | null }>(
          client,
          `SELECT COUNT(DISTINCT "actorId")::text AS "count", MAX("createdAt") AS "latest"
             FROM "RecoveryPublicationApproval"
            WHERE "recoveryId"=$1 AND "recoveryVersion"=$2 AND "decision"='APPROVE'`,
          [row.recoveryId, row.approvedPatchVersion],
        );
        const materialization = await queryOne<{ treeDigest: string; messageDigest: string }>(
          client,
          `SELECT "treeDigest","messageDigest" FROM "PublishedCommit" WHERE "publicationId"=$1`,
          [publicationId],
        );
        const policy = PublicationPolicySchema.parse({
          version: row.policyVersion,
          allowedBaseBranches: row.allowedBaseBranches,
          recoveryBranchPrefix: row.recoveryBranchPrefix,
          requiredChecks: row.requiredChecks,
          requiredApprovals: row.requiredApprovals,
          requireCodeOwnerApproval: row.requireCodeOwnerApproval,
          maximumPublicationAttempts: row.maximumPublicationAttempts,
          webhookReplayWindowSeconds: row.webhookReplayWindowSeconds,
          postMergeVerificationRequired: row.postMergeVerificationRequired,
          retentionDays: row.retentionDays,
        });
        return {
          publication: {
            id: row.id as string,
            organizationId: row.organizationId as string,
            repositoryId: row.repositoryId as string,
            status: row.status as PublicationStatus,
            version: Number(row.version),
            attemptCount: Number(row.attemptCount),
            policyVersion: row.policyVersion as string,
            baseBranch: row.baseBranch as string,
            headBranch: row.headBranch as string,
            baseCommitSha: row.baseCommitSha as string,
            approvedPatchVersion: Number(row.approvedPatchVersion),
            patchDigest: row.patchDigest as string,
            expectedTreeDigest: row.expectedTreeDigest as string,
            treeSha: (row.treeSha as string | null) ?? null,
            commitSha: (row.commitSha as string | null) ?? null,
            pullRequestNumber: (row.pullRequestNumber as number | null) ?? null,
            pullRequestUrl: (row.pullRequestUrl as string | null) ?? null,
          },
          recovery: {
            id: row.recoveryId as string,
            status: row.recoveryStatus as string,
            currentPatchVersion: (row.currentPatchVersion as number | null) ?? null,
            baseCommitSha: row.recoveryBaseCommitSha as string,
          },
          patch: {
            id: patch.id,
            version: patch.version,
            unifiedDiff: patch.unifiedDiff,
            patchDigest: patch.patchDigest,
          },
          pullRequestPackage: { title: prPackage.title, body: prPackage.body },
          approvals: {
            approvedCount: Number(approvals?.count ?? 0),
            latestApprovedAt: approvals?.latest?.toISOString() ?? null,
          },
          securityReview: securityReview ? { decision: securityReview.decision } : null,
          verification: verification ? { status: verification.status } : null,
          materialization: materialization
            ? {
                treeDigest: materialization.treeDigest,
                messageDigest: materialization.messageDigest,
              }
            : null,
          policy,
          installation: { installationId: row.installationExternalId as string },
          repository: {
            owner: row.repositoryOwner as string,
            name: row.repositoryName as string,
            providerRepoId: row.providerRepoId as string,
          },
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async advancePublication(command: {
    organizationId: string;
    publicationId: string;
    workerId: string;
    to: PublicationStatus;
    eventType: string;
    eventPayload?: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertPublicationLease(client, command.organizationId, command.publicationId, command.workerId);
        const current = await queryOne<{ status: PublicationStatus }>(
          client,
          `SELECT "status" FROM "PublicationRun" WHERE "id"=$1 FOR UPDATE`,
          [command.publicationId],
        );
        if (!current) throw new Error('Publication was not found.');
        if (current.status !== command.to) {
          assertPublicationTransition(current.status, command.to);
          await client.query(
            `UPDATE "PublicationRun" SET "status"=$3::"PublicationStatus","version"="version"+1,"updatedAt"=NOW()
             WHERE "id"=$1 AND "organizationId"=$2`,
            [command.publicationId, command.organizationId, command.to],
          );
        }
        await appendPublicationEvent(client, {
          publicationId: command.publicationId,
          type: command.eventType,
          payload: { status: command.to, ...(command.eventPayload ?? {}) },
          actorType: ActorType.SERVICE,
          actorId: command.workerId,
          correlationId: command.correlationId,
        });
      },
      { tenantOrganizationId: command.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async recordMaterialization(command: {
    organizationId: string;
    publicationId: string;
    workerId: string;
    treeSha: string;
    commitSha: string;
    treeDigest: string;
    messageDigest: string;
    correlationId?: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertPublicationLease(client, command.organizationId, command.publicationId, command.workerId);
        const current = await queryOne<{
          status: PublicationStatus;
          baseCommitSha: string;
          patchDigest: string;
        }>(
          client,
          `SELECT "status","baseCommitSha","patchDigest" FROM "PublicationRun" WHERE "id"=$1 FOR UPDATE`,
          [command.publicationId],
        );
        if (!current) throw new Error('Publication was not found.');
        if (current.status !== PublicationStatus.BRANCH_PUBLISHING) {
          assertPublicationTransition(current.status, PublicationStatus.BRANCH_PUBLISHING);
        }
        const existing = await queryOne<{ commitSha: string; treeSha: string }>(
          client,
          `SELECT "commitSha","treeSha" FROM "PublishedCommit" WHERE "publicationId"=$1`,
          [command.publicationId],
        );
        if (existing) {
          if (existing.commitSha !== command.commitSha || existing.treeSha !== command.treeSha)
            throw new Error('Recorded published commit does not match the materialized commit.');
        } else {
          await client.query(
            `INSERT INTO "PublishedCommit" (
               "id","publicationId","baseCommitSha","treeSha","commitSha","patchDigest",
               "treeDigest","messageDigest","materializedAt","createdAt"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
            [
              randomUUID(),
              command.publicationId,
              current.baseCommitSha,
              command.treeSha,
              command.commitSha,
              current.patchDigest,
              command.treeDigest,
              command.messageDigest,
            ],
          );
        }
        await client.query(
          `UPDATE "PublicationRun" SET "status"='BRANCH_PUBLISHING'::"PublicationStatus",
             "treeSha"=$3,"commitSha"=$4,"version"="version"+1,"updatedAt"=NOW()
           WHERE "id"=$1 AND "organizationId"=$2`,
          [command.publicationId, command.organizationId, command.treeSha, command.commitSha],
        );
        await appendPublicationEvent(client, {
          publicationId: command.publicationId,
          type: 'PUBLICATION_COMMIT_MATERIALIZED',
          payload: {
            status: PublicationStatus.BRANCH_PUBLISHING,
            treeSha: command.treeSha,
            commitSha: command.commitSha,
            patchDigest: current.patchDigest,
          },
          actorType: ActorType.SERVICE,
          actorId: command.workerId,
          correlationId: command.correlationId,
        });
      },
      { tenantOrganizationId: command.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async recordPullRequest(command: {
    organizationId: string;
    publicationId: string;
    workerId: string;
    pullRequest: {
      number: number;
      nodeId: string;
      url: string;
      title: string;
      bodyDigest: string;
      baseBranch: string;
      headBranch: string;
      headSha: string;
      baseSha: string;
      draft: boolean;
      state: string;
    };
    reused: boolean;
    correlationId?: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertPublicationLease(client, command.organizationId, command.publicationId, command.workerId);
        const current = await queryOne<{ status: PublicationStatus; commitSha: string | null }>(
          client,
          `SELECT "status","commitSha" FROM "PublicationRun" WHERE "id"=$1 FOR UPDATE`,
          [command.publicationId],
        );
        if (!current) throw new Error('Publication was not found.');
        if (current.status !== PublicationStatus.CI_MONITORING) {
          assertPublicationTransition(current.status, PublicationStatus.CI_MONITORING);
        }
        const existing = await queryOne<{ number: number }>(
          client,
          `SELECT "number" FROM "PullRequestRecord" WHERE "publicationId"=$1`,
          [command.publicationId],
        );
        if (existing) {
          if (existing.number !== command.pullRequest.number)
            throw new Error('Recorded pull request does not match the remote pull request.');
        } else {
          await client.query(
            `INSERT INTO "PullRequestRecord" (
               "id","publicationId","number","nodeId","url","title","bodyDigest","baseBranch",
               "headBranch","draft","state","headSha","baseSha","createdAt","updatedAt"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
            [
              randomUUID(),
              command.publicationId,
              command.pullRequest.number,
              command.pullRequest.nodeId,
              command.pullRequest.url,
              command.pullRequest.title,
              command.pullRequest.bodyDigest,
              command.pullRequest.baseBranch,
              command.pullRequest.headBranch,
              command.pullRequest.draft,
              command.pullRequest.state,
              command.pullRequest.headSha,
              command.pullRequest.baseSha,
            ],
          );
        }
        await client.query(
          `UPDATE "PublicationRun" SET "status"='CI_MONITORING'::"PublicationStatus",
             "pullRequestNumber"=$3,"pullRequestUrl"=$4,"commitSha"=COALESCE("commitSha",$5),
             "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NOW(),
             "version"="version"+1,"updatedAt"=NOW()
           WHERE "id"=$1 AND "organizationId"=$2`,
          [
            command.publicationId,
            command.organizationId,
            command.pullRequest.number,
            command.pullRequest.url,
            command.pullRequest.headSha,
          ],
        );
        await appendPublicationEvent(client, {
          publicationId: command.publicationId,
          type: 'PUBLICATION_DRAFT_PR_CREATED',
          payload: {
            status: PublicationStatus.CI_MONITORING,
            number: command.pullRequest.number,
            url: command.pullRequest.url,
            draft: command.pullRequest.draft,
            headBranch: command.pullRequest.headBranch,
            baseBranch: command.pullRequest.baseBranch,
            reused: command.reused,
          },
          actorType: ActorType.SERVICE,
          actorId: command.workerId,
          correlationId: command.correlationId,
        });
      },
      { tenantOrganizationId: command.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async failPublication(command: {
    organizationId: string;
    publicationId: string;
    workerId: string;
    status: PublicationStatus;
    errorCode: string;
    errorMessage: string;
    correlationId?: string;
  }): Promise<void> {
    await withTransaction(
      async (client) => {
        await assertPublicationLease(client, command.organizationId, command.publicationId, command.workerId);
        const current = await queryOne<{ status: PublicationStatus }>(
          client,
          `SELECT "status" FROM "PublicationRun" WHERE "id"=$1 FOR UPDATE`,
          [command.publicationId],
        );
        if (!current) throw new Error('Publication was not found.');
        if (current.status !== command.status) {
          assertPublicationTransition(current.status, command.status);
        }
        await client.query(
          `UPDATE "PublicationRun" SET "status"=$3::"PublicationStatus","errorCode"=$4,"errorMessage"=$5,
             "completedAt"=CASE WHEN $6 THEN NOW() ELSE "completedAt" END,
             "leaseOwner"=NULL,"leaseExpiresAt"=NULL,"version"="version"+1,"updatedAt"=NOW()
           WHERE "id"=$1 AND "organizationId"=$2`,
          [
            command.publicationId,
            command.organizationId,
            command.status,
            command.errorCode,
            command.errorMessage.slice(0, 2_000),
            isTerminalPublicationStatus(command.status),
          ],
        );
        await appendPublicationEvent(client, {
          publicationId: command.publicationId,
          type: 'PUBLICATION_FAILED',
          payload: { status: command.status, errorCode: command.errorCode },
          actorType: ActorType.SERVICE,
          actorId: command.workerId,
          correlationId: command.correlationId,
        });
      },
      { tenantOrganizationId: command.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }

  async listStalePublicationJobs(
    staleSeconds: number,
    limit = 25,
  ): Promise<PublicationExecutionJob[]> {
    return withTransaction(
      async (client) => {
        const rows = await queryMany<{ id: string; organizationId: string; repositoryId: string }>(
          client,
          `SELECT "id","organizationId","repositoryId" FROM "PublicationRun"
            WHERE "status"::text = ANY($3::text[])
              AND ("heartbeatAt" IS NULL OR "heartbeatAt" < NOW()-($1*INTERVAL '1 second'))
              AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())
            ORDER BY COALESCE("heartbeatAt","createdAt") ASC
            LIMIT $2`,
          [
            Math.min(Math.max(staleSeconds, 60), 86_400),
            Math.min(Math.max(limit, 1), 100),
            IN_FLIGHT_PUBLICATION_STATUSES,
          ],
        );
        return rows.map((row) =>
          PublicationExecutionJobSchema.parse({
            publicationId: row.id,
            organizationId: row.organizationId,
            repositoryId: row.repositoryId,
            attempt: 1,
            correlationId: `reconcile-${row.id}`,
          }),
        );
      },
      { workerBypassRls: true },
      this.pool,
    );
  }
}
