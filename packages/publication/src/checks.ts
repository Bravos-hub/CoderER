import {
  NormalizedCheckStatus,
  ReviewState,
  type MergeReadinessDecision,
  type MergeReadinessInput,
  type PublicationPolicy,
} from './types.js';

export function normalizeGithubCheck(
  status: string,
  conclusion?: string | null,
): NormalizedCheckStatus {
  const normalizedStatus = status.toLowerCase();
  const normalizedConclusion = conclusion?.toLowerCase() ?? null;
  if (
    normalizedStatus === 'queued' ||
    normalizedStatus === 'requested' ||
    normalizedStatus === 'waiting' ||
    normalizedStatus === 'pending'
  )
    return NormalizedCheckStatus.QUEUED;
  if (normalizedStatus === 'in_progress' || normalizedStatus === 'running')
    return NormalizedCheckStatus.RUNNING;
  switch (normalizedConclusion) {
    case 'success':
      return NormalizedCheckStatus.PASSED;
    case 'failure':
    case 'action_required':
    case 'startup_failure':
      return NormalizedCheckStatus.FAILED;
    case 'cancelled':
      return NormalizedCheckStatus.CANCELLED;
    case 'timed_out':
      return NormalizedCheckStatus.TIMED_OUT;
    case 'neutral':
    case 'skipped':
      return NormalizedCheckStatus.NEUTRAL;
    case 'stale':
      return NormalizedCheckStatus.STALE;
    default:
      return NormalizedCheckStatus.RUNNING;
  }
}

export function evaluateMergeReadiness(
  input: MergeReadinessInput,
  policy: PublicationPolicy,
): MergeReadinessDecision {
  const blockers: string[] = [];
  if (!input.baseCommitCurrent) blockers.push('Base branch has moved since publication.');
  if (!input.publicationIntegrityValid)
    blockers.push('Published tree or patch digest no longer matches the approved package.');
  for (const required of policy.requiredChecks) {
    const check = input.requiredChecks.find((candidate) => candidate.name === required);
    if (!check) blockers.push(`Required check is missing: ${required}`);
    else if (
      check.status !== NormalizedCheckStatus.PASSED &&
      check.status !== NormalizedCheckStatus.NEUTRAL
    )
      blockers.push(`Required check has not passed: ${required}`);
  }
  const latestByActor = new Map<string, ReviewState>();
  const codeOwnerApprovers = new Set<string>();
  for (const review of input.reviews) {
    latestByActor.set(review.actorId, review.state);
    if (review.codeOwner && review.state === ReviewState.APPROVED)
      codeOwnerApprovers.add(review.actorId);
  }
  const approvals = [...latestByActor.values()].filter(
    (state) => state === ReviewState.APPROVED,
  ).length;
  if (approvals < policy.requiredApprovals)
    blockers.push(
      `Only ${approvals} of ${policy.requiredApprovals} required approvals are present.`,
    );
  if ([...latestByActor.values()].includes(ReviewState.CHANGES_REQUESTED))
    blockers.push('At least one reviewer has requested changes.');
  if (policy.requireCodeOwnerApproval && codeOwnerApprovers.size === 0)
    blockers.push('A code-owner approval is required.');
  if (input.unresolvedBlockingThreads > 0)
    blockers.push('Blocking review threads remain unresolved.');
  if (input.blockingSecurityFindings > 0) blockers.push('Blocking security findings remain open.');
  return { ready: blockers.length === 0, blockers };
}
