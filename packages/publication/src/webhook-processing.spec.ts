import { describe, expect, it } from 'vitest';
import {
  NormalizedCheckStatus,
  extractIngressContext,
  isSupportedWebhookEvent,
  mapCheckEvent,
  mapPullRequestEvent,
  mapReviewEvent,
} from './index.js';

const pullRequestPayload = {
  action: 'closed',
  installation: { id: 290043 },
  repository: { id: 987654321 },
  pull_request: {
    number: 42,
    node_id: 'PR_kwDOAAAAAc4AAAAA',
    html_url: 'https://github.com/Bravos-hub/CoderER/pull/42',
    title: 'Fix deterministic demo fixture failure',
    state: 'closed',
    draft: false,
    merged: true,
    merged_at: '2026-07-20T10:00:00Z',
    merge_commit_sha: 'a'.repeat(40),
    merged_by: { login: 'competition-demo-reviewer' },
    body: 'Body with potentially sensitive text',
    head: { ref: 'codeer/demo/primary-fixture-recovery', sha: 'b'.repeat(40) },
    base: { ref: 'main', sha: 'c'.repeat(40) },
  },
};

describe('webhook ingress extraction', () => {
  it('extracts installation, repository and action without trusting tenant claims', () => {
    expect(extractIngressContext(pullRequestPayload)).toEqual({
      installationExternalId: 290043,
      repositoryExternalId: '987654321',
      action: 'closed',
    });
  });

  it('handles missing installation and repository', () => {
    expect(extractIngressContext({ action: 'opened' })).toEqual({
      installationExternalId: null,
      repositoryExternalId: null,
      action: 'opened',
    });
    expect(extractIngressContext(null)).toEqual({
      installationExternalId: null,
      repositoryExternalId: null,
      action: null,
    });
  });
});

describe('pull_request normalization', () => {
  it('maps a merged pull request with digested body', () => {
    const mapped = mapPullRequestEvent(pullRequestPayload);
    expect(mapped).toMatchObject({
      number: 42,
      state: 'merged',
      merged: true,
      mergedBy: 'competition-demo-reviewer',
      mergedAt: '2026-07-20T10:00:00Z',
      mergeCommitSha: 'a'.repeat(40),
      headBranch: 'codeer/demo/primary-fixture-recovery',
      headSha: 'b'.repeat(40),
      baseBranch: 'main',
      baseSha: 'c'.repeat(40),
      draft: false,
    });
    expect(mapped?.bodyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mapped)).not.toContain('sensitive text');
  });

  it('maps an open pull request', () => {
    const mapped = mapPullRequestEvent({
      ...pullRequestPayload,
      action: 'opened',
      pull_request: {
        ...pullRequestPayload.pull_request,
        state: 'open',
        merged: false,
        merged_at: null,
        merge_commit_sha: null,
        merged_by: null,
        draft: true,
      },
    });
    expect(mapped).toMatchObject({ state: 'open', merged: false, draft: true });
  });

  it('rejects malformed pull request payloads', () => {
    expect(mapPullRequestEvent({ pull_request: { number: 1 } })).toBeNull();
    expect(mapPullRequestEvent(null)).toBeNull();
  });
});

describe('pull_request_review normalization', () => {
  it('maps review state and digests the body', () => {
    const mapped = mapReviewEvent({
      action: 'submitted',
      review: {
        id: 777,
        user: { login: 'reviewer-1' },
        state: 'approved',
        submitted_at: '2026-07-20T11:00:00Z',
        body: 'looks good',
      },
      pull_request: { number: 42, head: { sha: 'b'.repeat(40) } },
    });
    expect(mapped).toMatchObject({
      externalId: '777',
      reviewerLogin: 'reviewer-1',
      state: 'APPROVED',
      submittedAt: '2026-07-20T11:00:00Z',
      pullRequestNumber: 42,
      headSha: 'b'.repeat(40),
    });
    expect(mapped?.bodyDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps changes_requested and falls back to PENDING for unknown states', () => {
    expect(
      mapReviewEvent({ review: { id: 1, user: { login: 'a' }, state: 'changes_requested' } })
        ?.state,
    ).toBe('CHANGES_REQUESTED');
    expect(
      mapReviewEvent({ review: { id: 1, user: { login: 'a' }, state: 'something_new' } })?.state,
    ).toBe('PENDING');
  });
});

describe('check normalization', () => {
  it('maps a completed check_run', () => {
    const mapped = mapCheckEvent('check_run', {
      check_run: {
        id: 555,
        name: 'test:evaluation:publication',
        status: 'completed',
        conclusion: 'success',
        head_sha: 'b'.repeat(40),
        details_url: 'https://github.com/x/y/runs/1',
        started_at: '2026-07-20T09:00:00Z',
        completed_at: '2026-07-20T09:05:00Z',
      },
    });
    expect(mapped).toMatchObject({
      externalId: '555',
      name: 'test:evaluation:publication',
      status: NormalizedCheckStatus.PASSED,
      headSha: 'b'.repeat(40),
      rawConclusion: 'success',
    });
  });

  it('maps in-progress and failed states', () => {
    expect(
      mapCheckEvent('check_run', {
        check_run: { id: 1, name: 'ci', status: 'in_progress', head_sha: 'a'.repeat(40) },
      })?.status,
    ).toBe(NormalizedCheckStatus.RUNNING);
    expect(
      mapCheckEvent('check_suite', {
        check_suite: {
          id: 2,
          app: { name: 'ci-app' },
          status: 'completed',
          conclusion: 'failure',
          head_sha: 'a'.repeat(40),
        },
      })?.status,
    ).toBe(NormalizedCheckStatus.FAILED);
  });
});

describe('event support matrix', () => {
  it('supports the competition-minimum events only', () => {
    expect(isSupportedWebhookEvent('pull_request')).toBe(true);
    expect(isSupportedWebhookEvent('pull_request_review')).toBe(true);
    expect(isSupportedWebhookEvent('check_run')).toBe(true);
    expect(isSupportedWebhookEvent('check_suite')).toBe(true);
    expect(isSupportedWebhookEvent('push')).toBe(false);
    expect(isSupportedWebhookEvent('installation')).toBe(false);
  });
});
