import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson, digestPayload } from '@codeer/incidents';
import {
  PublicationStatus,
  assertPublicationTransition,
  decidePostMergeVerification,
  evaluateMergeReadiness,
  requiredChecksPassed,
  toMergeReadinessInput,
  type NormalizedCheckStatus,
  type PublicationPolicy,
  type ReviewState,
} from '@codeer/publication';
import { databasePool, queryMany, queryOne, withTransaction } from './client.js';
import { appendPublicationEvent } from './github-webhook-store.js';

/**
 * Merge readiness evaluation and post-merge closure for the publication
 * lifecycle. Every readiness decision is persisted (including blockers), a
 * human-ready transition requires the latest decision to be green, merges are
 * only observed — never performed — and incident closure is derived from
 * persisted post-merge verification evidence.
 */

interface RunRow {
  id: string;
  incidentId: string;
  recoveryId: string;
  status: PublicationStatus;
  version: number;
  policyVersion: string;
  baseCommitSha: string;
  patchDigest: string;
  commitSha: string | null;
  publicationPolicyId: string;
}

interface PolicyRow {
  requiredChecks: string[];
  requiredApprovals: number;
  requireCodeOwnerApproval: boolean;
  maximumPublicationAttempts: number;
  webhookReplayWindowSeconds: number;
  postMergeVerificationRequired: boolean;
}

export interface MergeReadinessEvaluation {
  ready: boolean;
  blockers: string[];
}

const RUN_SELECT = `"id","incidentId","recoveryId","status","version","policyVersion","baseCommitSha",
  "patchDigest","commitSha","publicationPolicyId"`;

export class MergeClosureStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async evaluateAndPersistMergeReadiness(
    organizationId: string,
    publicationId: string,
    correlationId: string,
  ): Promise<MergeReadinessEvaluation | undefined> {
    return withTransaction(
      async (client) => {
        const run = await queryOne<RunRow>(
          client,
          `SELECT ${RUN_SELECT} FROM "PublicationRun" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [publicationId, organizationId],
        );
        if (!run) return undefined;
        const policyRow = await queryOne<PolicyRow>(
          client,
          `SELECT "requiredChecks","requiredApprovals","requireCodeOwnerApproval",
             "maximumPublicationAttempts","webhookReplayWindowSeconds","postMergeVerificationRequired"
           FROM "RepositoryPublicationPolicy" WHERE "id"=$1`,
          [run.publicationPolicyId],
        );
        if (!policyRow) throw new Error('Publication policy is missing for readiness evaluation.');
        const checks = await queryMany<{ name: string; status: NormalizedCheckStatus }>(
          client,
          `SELECT DISTINCT ON (c."name") c."name", c."status" FROM "PublicationCheck" c
           WHERE c."publicationId"=$1 ORDER BY c."name", c."updatedAt" DESC`,
          [publicationId],
        );
        const reviews = await queryMany<{ reviewerLogin: string; state: ReviewState }>(
          client,
          `SELECT "reviewerLogin","state" FROM "PublicationReview" WHERE "publicationId"=$1
           ORDER BY "submittedAt" NULLS LAST, "createdAt"`,
          [publicationId],
        );
        const pullRequest = await queryOne<{ baseSha: string; draft: boolean }>(
          client,
          `SELECT "baseSha","draft" FROM "PullRequestRecord" WHERE "publicationId"=$1`,
          [publicationId],
        );
        const publishedCommit = await queryOne<{ patchDigest: string }>(
          client,
          `SELECT "patchDigest" FROM "PublishedCommit" WHERE "publicationId"=$1`,
          [publicationId],
        );

        const policy: PublicationPolicy = {
          version: run.policyVersion,
          allowedBaseBranches: [],
          recoveryBranchPrefix: '',
          requireDraftPullRequest: true,
          allowForcePush: false,
          allowProtectedBranchWrites: false,
          allowAutomaticMerge: false,
          requiredChecks: policyRow.requiredChecks,
          requiredApprovals: policyRow.requiredApprovals,
          requireCodeOwnerApproval: policyRow.requireCodeOwnerApproval,
          maximumPublicationAttempts: policyRow.maximumPublicationAttempts,
          webhookReplayWindowSeconds: policyRow.webhookReplayWindowSeconds,
          postMergeVerificationRequired: policyRow.postMergeVerificationRequired,
          retentionDays: 365,
        };
        const input = toMergeReadinessInput({
          baseCommitCurrent: pullRequest ? pullRequest.baseSha === run.baseCommitSha : true,
          publicationIntegrityValid: publishedCommit
            ? publishedCommit.patchDigest === run.patchDigest
            : true,
          checks,
          reviews: reviews.map((review) => ({
            actorId: review.reviewerLogin,
            state: review.state,
            codeOwner: false,
          })),
          unresolvedBlockingThreads: 0,
          pullRequestDraft: pullRequest?.draft ?? false,
        });
        const decision = evaluateMergeReadiness(input, policy);
        // Identical inputs produce an identical digest; the decision is only
        // persisted when something actually changed.
        await client.query(
          `INSERT INTO "MergeReadinessDecision" (
             "id","publicationId","ready","blockers","inputDigest","policyVersion","headSha",
             "baseSha","evaluatedAt","createdAt"
           ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,NOW(),NOW())
           ON CONFLICT ("publicationId","inputDigest") DO NOTHING`,
          [
            randomUUID(),
            publicationId,
            decision.ready,
            canonicalJson(decision.blockers),
            digestPayload({ publicationId, input, decision }),
            run.policyVersion,
            run.commitSha,
            run.baseCommitSha,
          ],
        );
        await appendPublicationEvent(client, {
          publicationId,
          type: 'MERGE_READINESS_EVALUATED',
          payload: { ready: decision.ready, blockers: decision.blockers },
          actorId: 'github-webhook-worker',
          correlationId,
        });
        return decision;
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async latestMergeReadiness(
    organizationId: string,
    publicationId: string,
  ): Promise<MergeReadinessEvaluation | undefined> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<{ ready: boolean; blockers: unknown }>(
          client,
          `SELECT d."ready", d."blockers" FROM "MergeReadinessDecision" d
           JOIN "PublicationRun" p ON p."id" = d."publicationId"
           WHERE d."publicationId"=$1 AND p."organizationId"=$2
           ORDER BY d."evaluatedAt" DESC LIMIT 1`,
          [publicationId, organizationId],
        );
        if (!row) return undefined;
        return {
          ready: row.ready,
          blockers: Array.isArray(row.blockers) ? (row.blockers as string[]) : [],
        };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async applyPostMergeVerification(
    organizationId: string,
    publicationId: string,
    correlationId: string,
  ): Promise<{ applied: boolean; outcome?: 'PASSED' | 'FAILED' }> {
    return withTransaction(
      async (client) => {
        const run = await queryOne<RunRow>(
          client,
          `SELECT ${RUN_SELECT} FROM "PublicationRun" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`,
          [publicationId, organizationId],
        );
        if (!run || run.status !== PublicationStatus.MERGED) return { applied: false };
        const policyRow = await queryOne<PolicyRow>(
          client,
          `SELECT "requiredChecks","requiredApprovals","requireCodeOwnerApproval",
             "maximumPublicationAttempts","webhookReplayWindowSeconds","postMergeVerificationRequired"
           FROM "RepositoryPublicationPolicy" WHERE "id"=$1`,
          [run.publicationPolicyId],
        );
        if (!policyRow)
          throw new Error('Publication policy is missing for post-merge verification.');
        const observation = await queryOne<{ mergeCommitSha: string; approvedHeadSha: string }>(
          client,
          `SELECT "mergeCommitSha","approvedHeadSha" FROM "MergeObservation" WHERE "publicationId"=$1`,
          [publicationId],
        );
        const checks = await queryMany<{ name: string; status: NormalizedCheckStatus }>(
          client,
          `SELECT DISTINCT ON (c."name") c."name", c."status" FROM "PublicationCheck" c
           WHERE c."publicationId"=$1 ORDER BY c."name", c."updatedAt" DESC`,
          [publicationId],
        );
        const publishedCommit = await queryOne<{ commitSha: string }>(
          client,
          `SELECT "commitSha" FROM "PublishedCommit" WHERE "publicationId"=$1`,
          [publicationId],
        );
        const recoveryVerification = await queryOne<{ id: string }>(
          client,
          `SELECT "id" FROM "RecoveryVerificationRun"
           WHERE "recoveryId"=$1 AND "status"='PASSED' LIMIT 1`,
          [run.recoveryId],
        );

        const policy: PublicationPolicy = {
          version: run.policyVersion,
          allowedBaseBranches: [],
          recoveryBranchPrefix: '',
          requireDraftPullRequest: true,
          allowForcePush: false,
          allowProtectedBranchWrites: false,
          allowAutomaticMerge: false,
          requiredChecks: policyRow.requiredChecks,
          requiredApprovals: policyRow.requiredApprovals,
          requireCodeOwnerApproval: policyRow.requireCodeOwnerApproval,
          maximumPublicationAttempts: policyRow.maximumPublicationAttempts,
          webhookReplayWindowSeconds: policyRow.webhookReplayWindowSeconds,
          postMergeVerificationRequired: policyRow.postMergeVerificationRequired,
          retentionDays: 365,
        };
        const decision = decidePostMergeVerification({
          mergeObserved: observation !== undefined,
          mergeCommitSha: observation?.mergeCommitSha ?? null,
          approvedHeadSha: observation?.approvedHeadSha ?? null,
          publishedCommitSha: publishedCommit?.commitSha ?? null,
          requiredChecksPassed: requiredChecksPassed(policy, checks),
          originalFailureResolved: recoveryVerification !== undefined,
          rollbackObserved: false,
          policy,
        });

        const verificationId = randomUUID();
        const approvedPatchPresent = Boolean(
          observation &&
          publishedCommit &&
          observation.approvedHeadSha === publishedCommit.commitSha,
        );
        const evidence = {
          decision,
          correlationId,
          note: 'Control-plane verification: merge observation, approved-commit integrity and required-check state from persisted synchronized records. Live re-execution of the failure check is tracked under issue #22.',
        };
        await client.query(
          `INSERT INTO "PostMergeVerification" (
             "id","publicationId","status","mergeCommitSha","approvedPatchPresent",
             "originalFailureResolved","requiredChecksPassed","repositoryHealthImproved",
             "rollbackTriggered","evidence","digest","startedAt","completedAt","createdAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9::jsonb,$10,NOW(),NOW(),NOW())`,
          [
            verificationId,
            publicationId,
            decision.outcome,
            observation?.mergeCommitSha ?? '0'.repeat(40),
            approvedPatchPresent,
            recoveryVerification !== undefined,
            requiredChecksPassed(policy, checks),
            canonicalJson(evidence),
            digestPayload({ publicationId, verificationId, decision }),
          ],
        );
        await appendPublicationEvent(client, {
          publicationId,
          type:
            decision.outcome === 'PASSED'
              ? 'POST_MERGE_VERIFICATION_PASSED'
              : 'POST_MERGE_VERIFICATION_FAILED',
          payload: { verificationId, outcome: decision.outcome, blockers: decision.blockers },
          actorId: 'github-webhook-worker',
          correlationId,
        });

        const transition = (to: PublicationStatus) => {
          assertPublicationTransition(run.status, to);
          return client.query(
            `UPDATE "PublicationRun" SET "status"=$1::"PublicationStatus","version"="version"+1,"updatedAt"=NOW()
             WHERE "id"=$2 AND "organizationId"=$3`,
            [to, publicationId, organizationId],
          );
        };
        await transition(PublicationStatus.POST_MERGE_VERIFYING);
        run.status = PublicationStatus.POST_MERGE_VERIFYING;

        if (decision.outcome === 'PASSED') {
          await transition(PublicationStatus.RECOVERY_CONFIRMED);
          run.status = PublicationStatus.RECOVERY_CONFIRMED;
          await transition(PublicationStatus.CLOSED);
          await client.query(
            `INSERT INTO "IncidentClosureRecord" (
               "id","organizationId","incidentId","publicationId","postMergeVerificationId",
               "closedBy","closureReason","evidenceDigest","closedAt","createdAt"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
             ON CONFLICT ("incidentId") DO NOTHING`,
            [
              randomUUID(),
              organizationId,
              run.incidentId,
              publicationId,
              verificationId,
              'github-webhook-worker',
              'Closed after observed human merge and passed post-merge verification.',
              digestPayload({ publicationId, verificationId, closure: true }),
            ],
          );
          await appendPublicationEvent(client, {
            publicationId,
            type: 'INCIDENT_CLOSED',
            payload: { verificationId, incidentId: run.incidentId },
            actorId: 'github-webhook-worker',
            correlationId,
          });
        } else {
          await transition(PublicationStatus.POST_MERGE_FAILED);
        }
        return { applied: true, outcome: decision.outcome };
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }
}
