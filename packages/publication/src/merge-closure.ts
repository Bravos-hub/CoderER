import {
  NormalizedCheckStatus,
  type MergeReadinessInput,
  type PublicationPolicy,
  type ReviewState,
} from './types.js';

/**
 * Pure decision logic for merge readiness and post-merge verification. The
 * store assembles the persisted rows into these inputs; everything here is
 * deterministic and unit-testable without a database.
 */

export interface ReadinessRows {
  baseCommitCurrent: boolean;
  publicationIntegrityValid: boolean;
  checks: { name: string; status: NormalizedCheckStatus }[];
  reviews: { actorId: string; state: ReviewState; codeOwner: boolean }[];
  unresolvedBlockingThreads: number;
  pullRequestDraft: boolean;
}

export function toMergeReadinessInput(rows: ReadinessRows): MergeReadinessInput {
  return {
    baseCommitCurrent: rows.baseCommitCurrent,
    publicationIntegrityValid: rows.publicationIntegrityValid,
    requiredChecks: rows.checks.map((check) => ({ name: check.name, status: check.status })),
    reviews: rows.reviews.map((review) => ({
      actorId: review.actorId,
      state: review.state,
      codeOwner: review.codeOwner,
    })),
    unresolvedBlockingThreads: rows.unresolvedBlockingThreads,
    blockingSecurityFindings: 0,
    pullRequestDraft: rows.pullRequestDraft,
  };
}

export function latestReviewStates(
  reviews: { reviewerLogin: string; state: ReviewState; submittedAt: string | null }[],
): { actorId: string; state: ReviewState; codeOwner: boolean }[] {
  const latest = new Map<string, ReviewState>();
  for (const review of reviews) latest.set(review.reviewerLogin, review.state);
  return [...latest.entries()].map(([actorId, state]) => ({ actorId, state, codeOwner: false }));
}

export interface PostMergeVerificationInput {
  mergeObserved: boolean;
  mergeCommitSha: string | null;
  approvedHeadSha: string | null;
  publishedCommitSha: string | null;
  requiredChecksPassed: boolean;
  originalFailureResolved: boolean;
  rollbackObserved: boolean;
  policy: Pick<PublicationPolicy, 'postMergeVerificationRequired'>;
}

export type PostMergeOutcome = 'PASSED' | 'FAILED';

export interface PostMergeDecision {
  outcome: PostMergeOutcome;
  blockers: string[];
}

export function decidePostMergeVerification(input: PostMergeVerificationInput): PostMergeDecision {
  const blockers: string[] = [];
  if (!input.mergeObserved || !input.mergeCommitSha) blockers.push('No merge commit was observed.');
  if (input.rollbackObserved) blockers.push('A rollback or revert was observed after merge.');
  if (
    input.approvedHeadSha &&
    input.publishedCommitSha &&
    input.approvedHeadSha !== input.publishedCommitSha
  ) {
    blockers.push('Merged head does not match the approved published commit.');
  }
  if (input.policy.postMergeVerificationRequired && !input.requiredChecksPassed) {
    blockers.push('Required checks did not pass on the merged head.');
  }
  if (!input.originalFailureResolved) {
    blockers.push('The original failure is not recorded as resolved.');
  }
  return { outcome: blockers.length === 0 ? 'PASSED' : 'FAILED', blockers };
}

export function requiredChecksPassed(
  policy: PublicationPolicy,
  checks: { name: string; status: NormalizedCheckStatus }[],
): boolean {
  return policy.requiredChecks.every((required) => {
    const check = checks.find((candidate) => candidate.name === required);
    return (
      check !== undefined &&
      (check.status === NormalizedCheckStatus.PASSED ||
        check.status === NormalizedCheckStatus.NEUTRAL)
    );
  });
}
