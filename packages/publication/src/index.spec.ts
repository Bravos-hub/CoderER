import { generateKeyPairSync, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApprovedRecoveryPackageSchema,
  MergeReadinessInputSchema,
  NormalizedCheckStatus,
  PublicationPolicySchema,
  PublicationStatus,
  ReviewState,
  WebhookReplayGuard,
  assertPublicationTransition,
  buildPullRequestBody,
  createGithubAppJwt,
  deterministicPublicationBranch,
  evaluateMergeReadiness,
  evaluatePublicationPolicy,
  normalizeGithubCheck,
  verifyGithubWebhookSignature,
} from './index.js';

const policy = PublicationPolicySchema.parse({
  version: 'v1',
  allowedBaseBranches: ['main'],
  recoveryBranchPrefix: 'codeer/recovery',
  requiredChecks: ['build', 'test'],
  requiredApprovals: 2,
  requireCodeOwnerApproval: true,
  maximumPublicationAttempts: 3,
  webhookReplayWindowSeconds: 600,
  postMergeVerificationRequired: true,
  retentionDays: 365,
});

const pkg = ApprovedRecoveryPackageSchema.parse({
  recoveryId: '11111111-1111-4111-8111-111111111111',
  incidentId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  repositoryId: '44444444-4444-4444-8444-444444444444',
  treatmentPlanId: '55555555-5555-4555-8555-555555555555',
  patchVersion: 1,
  baseCommitSha: 'a'.repeat(40),
  patchDigest: 'b'.repeat(64),
  treeDigest: 'c'.repeat(64),
  branchName: 'codeer/recovery/incident-v1',
  targetBaseBranch: 'main',
  publicationApprovalCount: 2,
  publicationApprovedAt: new Date().toISOString(),
  securityReviewApproved: true,
  verificationPassed: true,
  pullRequestTitle: 'Fix deterministic build failure',
  pullRequestBody: 'Initial package body',
});

describe('publication lifecycle', () => {
  it('allows the expected happy-path transition', () =>
    expect(() =>
      assertPublicationTransition(
        PublicationStatus.POLICY_CHECK,
        PublicationStatus.COMMIT_MATERIALIZING,
      ),
    ).not.toThrow());
  it('rejects skipping directly to merged', () =>
    expect(() =>
      assertPublicationTransition(PublicationStatus.POLICY_CHECK, PublicationStatus.MERGED),
    ).toThrow());
});

describe('publication policy', () => {
  it('approves a compliant recovery package', () =>
    expect(evaluatePublicationPolicy(pkg, policy).allowed).toBe(true));
  it('rejects protected-branch publication', () =>
    expect(evaluatePublicationPolicy({ ...pkg, branchName: 'main' }, policy).allowed).toBe(false));
  it('creates deterministic branch names', () =>
    expect(
      deterministicPublicationBranch('codeer/recovery', pkg.incidentId, pkg.recoveryId, 2),
    ).toContain('-v2'));
});

describe('check normalization and merge readiness', () => {
  it('normalizes GitHub conclusions', () =>
    expect(normalizeGithubCheck('completed', 'success')).toBe(NormalizedCheckStatus.PASSED));
  it('blocks a missing required check', () => {
    const input = MergeReadinessInputSchema.parse({
      baseCommitCurrent: true,
      publicationIntegrityValid: true,
      requiredChecks: [{ name: 'build', status: 'PASSED' }],
      reviews: [
        { actorId: 'a', state: 'APPROVED', codeOwner: true },
        { actorId: 'b', state: 'APPROVED', codeOwner: false },
      ],
      unresolvedBlockingThreads: 0,
      blockingSecurityFindings: 0,
      pullRequestDraft: true,
    });
    expect(evaluateMergeReadiness(input, policy).ready).toBe(false);
  });
  it('accepts a fully compliant PR', () => {
    const input = MergeReadinessInputSchema.parse({
      baseCommitCurrent: true,
      publicationIntegrityValid: true,
      requiredChecks: [
        { name: 'build', status: 'PASSED' },
        { name: 'test', status: 'PASSED' },
      ],
      reviews: [
        { actorId: 'a', state: ReviewState.APPROVED, codeOwner: true },
        { actorId: 'b', state: ReviewState.APPROVED, codeOwner: false },
      ],
      unresolvedBlockingThreads: 0,
      blockingSecurityFindings: 0,
      pullRequestDraft: true,
    });
    expect(evaluateMergeReadiness(input, policy)).toEqual({ ready: true, blockers: [] });
  });
});

describe('webhook security', () => {
  it('verifies sha256 signatures', () => {
    const body = Buffer.from('{"action":"opened"}');
    const secret = 'test-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(
      verifyGithubWebhookSignature({ secret, rawBody: body, signatureHeader: signature }),
    ).toBe(true);
  });
  it('rejects replayed delivery ids', () => {
    const guard = new WebhookReplayGuard(600, () => 1000);
    expect(guard.accept('12345678-abcd')).toBe(true);
    expect(guard.accept('12345678-abcd')).toBe(false);
  });
});

describe('GitHub App and package generation', () => {
  it('creates a signed app JWT', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      createGithubAppJwt(
        '123',
        privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        1000,
      ).split('.'),
    ).toHaveLength(3);
  });
  it('builds a deterministic PR body digest', () => {
    const first = buildPullRequestBody(pkg, {
      rootCause: 'Broken build script.',
      changedFiles: ['package.json'],
      verificationSummary: 'Passed.',
      securitySummary: 'Approved.',
      limitations: [],
      rollback: 'Revert commit.',
    });
    const second = buildPullRequestBody(pkg, {
      rootCause: 'Broken build script.',
      changedFiles: ['package.json'],
      verificationSummary: 'Passed.',
      securitySummary: 'Approved.',
      limitations: [],
      rollback: 'Revert commit.',
    });
    expect(first.digest).toBe(second.digest);
  });
});
