import { describe, expect, it } from 'vitest';
import {
  NormalizedCheckStatus,
  ReviewState,
  decidePostMergeVerification,
  latestReviewStates,
  requiredChecksPassed,
  toMergeReadinessInput,
  type PublicationPolicy,
} from './index.js';

const policy: PublicationPolicy = {
  version: 'test-policy',
  allowedBaseBranches: ['main'],
  recoveryBranchPrefix: 'codeer/',
  requireDraftPullRequest: true,
  allowForcePush: false,
  allowProtectedBranchWrites: false,
  allowAutomaticMerge: false,
  requiredChecks: ['test:evaluation:publication'],
  requiredApprovals: 1,
  requireCodeOwnerApproval: false,
  maximumPublicationAttempts: 3,
  webhookReplayWindowSeconds: 600,
  postMergeVerificationRequired: true,
  retentionDays: 365,
};

describe('toMergeReadinessInput', () => {
  it('maps persisted rows into the readiness input shape', () => {
    const input = toMergeReadinessInput({
      baseCommitCurrent: true,
      publicationIntegrityValid: true,
      checks: [{ name: 'test:evaluation:publication', status: NormalizedCheckStatus.PASSED }],
      reviews: [{ actorId: 'reviewer-1', state: ReviewState.APPROVED, codeOwner: false }],
      unresolvedBlockingThreads: 0,
      pullRequestDraft: false,
    });
    expect(input.blockingSecurityFindings).toBe(0);
    expect(input.requiredChecks[0]?.name).toBe('test:evaluation:publication');
    expect(input.reviews[0]?.state).toBe(ReviewState.APPROVED);
  });
});

describe('latestReviewStates', () => {
  it('keeps only the latest state per reviewer', () => {
    const states = latestReviewStates([
      { reviewerLogin: 'a', state: ReviewState.CHANGES_REQUESTED, submittedAt: null },
      { reviewerLogin: 'a', state: ReviewState.APPROVED, submittedAt: null },
      { reviewerLogin: 'b', state: ReviewState.COMMENTED, submittedAt: null },
    ]);
    expect(states).toEqual([
      { actorId: 'a', state: ReviewState.APPROVED, codeOwner: false },
      { actorId: 'b', state: ReviewState.COMMENTED, codeOwner: false },
    ]);
  });
});

describe('requiredChecksPassed', () => {
  it('requires every required check to pass or be neutral', () => {
    expect(
      requiredChecksPassed(policy, [
        { name: 'test:evaluation:publication', status: NormalizedCheckStatus.PASSED },
      ]),
    ).toBe(true);
    expect(
      requiredChecksPassed(policy, [
        { name: 'test:evaluation:publication', status: NormalizedCheckStatus.RUNNING },
      ]),
    ).toBe(false);
    expect(requiredChecksPassed(policy, [])).toBe(false);
  });
});

describe('decidePostMergeVerification', () => {
  const base = {
    mergeObserved: true,
    mergeCommitSha: 'a'.repeat(40),
    approvedHeadSha: 'b'.repeat(40),
    publishedCommitSha: 'b'.repeat(40),
    requiredChecksPassed: true,
    originalFailureResolved: true,
    rollbackObserved: false,
    policy,
  };

  it('passes when merge observation, integrity and checks are green', () => {
    expect(decidePostMergeVerification(base)).toEqual({ outcome: 'PASSED', blockers: [] });
  });

  it('fails without an observed merge commit', () => {
    const decision = decidePostMergeVerification({
      ...base,
      mergeObserved: false,
      mergeCommitSha: null,
    });
    expect(decision.outcome).toBe('FAILED');
    expect(decision.blockers.join(' ')).toContain('No merge commit');
  });

  it('fails when the merged head does not match the approved commit', () => {
    const decision = decidePostMergeVerification({
      ...base,
      approvedHeadSha: 'c'.repeat(40),
    });
    expect(decision.outcome).toBe('FAILED');
    expect(decision.blockers.join(' ')).toContain('approved published commit');
  });

  it('fails on rollback observation or unresolved original failure', () => {
    expect(decidePostMergeVerification({ ...base, rollbackObserved: true }).outcome).toBe('FAILED');
    expect(decidePostMergeVerification({ ...base, originalFailureResolved: false }).outcome).toBe(
      'FAILED',
    );
  });
});
