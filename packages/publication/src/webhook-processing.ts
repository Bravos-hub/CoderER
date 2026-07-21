import { createHash } from 'node:crypto';
import { normalizeGithubCheck } from './checks.js';
import type { NormalizedCheckStatus } from './types.js';

/**
 * Pure extraction and normalization for signed GitHub webhook payloads.
 * These functions never trust tenant identifiers from the payload — tenant
 * resolution happens against persisted GithubInstallation/Repository rows.
 * Only bounded metadata and digests are produced; raw bodies of pull
 * requests, reviews and comments never leave the ingress boundary.
 */

export const WEBHOOK_DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface WebhookIngressContext {
  installationExternalId: number | null;
  repositoryExternalId: string | null;
  action: string | null;
}

export function extractIngressContext(payload: unknown): WebhookIngressContext {
  const root = asRecord(payload);
  const installation = asRecord(root?.installation);
  const repository = asRecord(root?.repository);
  const repositoryId = asNumber(repository?.id);
  return {
    installationExternalId: asNumber(installation?.id) ?? null,
    repositoryExternalId: repositoryId !== undefined ? String(repositoryId) : null,
    action: asString(root?.action) ?? null,
  };
}

export interface NormalizedPullRequestEvent {
  number: number;
  nodeId: string;
  url: string;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  merged: boolean;
  mergedBy: string | null;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  bodyDigest: string | null;
}

export function mapPullRequestEvent(payload: unknown): NormalizedPullRequestEvent | null {
  const pullRequest = asRecord(asRecord(payload)?.pull_request);
  const head = asRecord(pullRequest?.head);
  const base = asRecord(pullRequest?.base);
  const headRef = asString(head?.ref);
  const headSha = asString(head?.sha);
  const baseRef = asString(base?.ref);
  const baseSha = asString(base?.sha);
  const number = asNumber(pullRequest?.number);
  const nodeId = asString(pullRequest?.node_id) ?? null;
  const url = asString(pullRequest?.html_url);
  if (!pullRequest || !headRef || !headSha || !baseRef || !baseSha || !number || !url) return null;
  const merged = pullRequest?.merged === true;
  const state = merged ? 'merged' : asString(pullRequest?.state) === 'open' ? 'open' : 'closed';
  const body = asString(pullRequest?.body);
  return {
    number,
    nodeId: nodeId ?? '',
    url,
    title: asString(pullRequest?.title) ?? '',
    state,
    draft: pullRequest?.draft === true,
    headBranch: headRef,
    headSha,
    baseBranch: baseRef,
    baseSha,
    merged,
    mergedBy: asString(asRecord(pullRequest?.merged_by)?.login) ?? null,
    mergedAt: asString(pullRequest?.merged_at) ?? null,
    mergeCommitSha: asString(pullRequest?.merge_commit_sha) ?? null,
    bodyDigest: body ? sha256(body) : null,
  };
}

export interface NormalizedReviewEvent {
  externalId: string;
  reviewerLogin: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt: string | null;
  bodyDigest: string | null;
  headSha: string | null;
  pullRequestNumber: number | null;
}

export function mapReviewEvent(payload: unknown): NormalizedReviewEvent | null {
  const root = asRecord(payload);
  const review = asRecord(root?.review);
  const pullRequest = asRecord(root?.pull_request);
  const reviewId = asNumber(review?.id);
  const reviewer = asString(asRecord(review?.user)?.login);
  if (!review || reviewId === undefined || !reviewer) return null;
  const rawState = (asString(review?.state) ?? '').toUpperCase();
  const state =
    rawState === 'APPROVED' ||
    rawState === 'CHANGES_REQUESTED' ||
    rawState === 'DISMISSED' ||
    rawState === 'COMMENTED'
      ? rawState
      : 'PENDING';
  const body = asString(review?.body);
  const head = asRecord(pullRequest?.head);
  return {
    externalId: String(reviewId),
    reviewerLogin: reviewer,
    state,
    submittedAt: asString(review?.submitted_at) ?? null,
    bodyDigest: body ? sha256(body) : null,
    headSha: asString(head?.sha) ?? null,
    pullRequestNumber: asNumber(pullRequest?.number) ?? null,
  };
}

export interface NormalizedCheckEvent {
  externalId: string;
  name: string;
  status: NormalizedCheckStatus;
  headSha: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  rawConclusion: string | null;
}

export function mapCheckEvent(eventName: string, payload: unknown): NormalizedCheckEvent | null {
  const root = asRecord(payload);
  const source =
    eventName === 'check_run' ? asRecord(root?.check_run) : asRecord(root?.check_suite);
  if (!source) return null;
  const id = asNumber(source.id);
  const name =
    asString(source.name) ??
    (eventName === 'check_suite' ? asString(asRecord(source.app)?.name) : undefined);
  if (id === undefined || !name) return null;
  const app = asString(asRecord(source.app)?.name);
  return {
    externalId: String(id),
    name: eventName === 'check_suite' && app ? app : name,
    status: normalizeGithubCheck(
      asString(source.status) ?? 'completed',
      asString(source.conclusion) ?? null,
    ),
    headSha: asString(source.head_sha) ?? null,
    detailsUrl: asString(source.details_url) ?? asString(source.html_url) ?? null,
    startedAt: asString(source.started_at) ?? null,
    completedAt: asString(source.completed_at) ?? null,
    rawConclusion: asString(source.conclusion) ?? null,
  };
}

export const SUPPORTED_WEBHOOK_EVENTS = new Set([
  'pull_request',
  'pull_request_review',
  'check_run',
  'check_suite',
]);

export function isSupportedWebhookEvent(eventName: string): boolean {
  return SUPPORTED_WEBHOOK_EVENTS.has(eventName);
}
