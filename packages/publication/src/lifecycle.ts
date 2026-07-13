import { PublicationStatus } from './types.js';

const terminal = new Set<PublicationStatus>([
  PublicationStatus.CLOSED,
  PublicationStatus.PUBLICATION_BLOCKED,
  PublicationStatus.CANCELLED,
  PublicationStatus.TIMED_OUT,
  PublicationStatus.POST_MERGE_FAILED,
  PublicationStatus.MERGE_REVERTED,
]);

const transitions: Record<PublicationStatus, readonly PublicationStatus[]> = {
  [PublicationStatus.PUBLICATION_REQUESTED]: [
    PublicationStatus.POLICY_CHECK,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.POLICY_CHECK]: [
    PublicationStatus.COMMIT_MATERIALIZING,
    PublicationStatus.PUBLICATION_BLOCKED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.COMMIT_MATERIALIZING]: [
    PublicationStatus.BRANCH_PUBLISHING,
    PublicationStatus.PUBLICATION_BLOCKED,
    PublicationStatus.TIMED_OUT,
  ],
  [PublicationStatus.BRANCH_PUBLISHING]: [
    PublicationStatus.DRAFT_PR_CREATING,
    PublicationStatus.PUSH_FAILED,
    PublicationStatus.TIMED_OUT,
  ],
  [PublicationStatus.DRAFT_PR_CREATING]: [
    PublicationStatus.CI_MONITORING,
    PublicationStatus.PR_CREATION_FAILED,
    PublicationStatus.TIMED_OUT,
  ],
  [PublicationStatus.CI_MONITORING]: [
    PublicationStatus.REVIEW_MONITORING,
    PublicationStatus.CI_FAILED,
    PublicationStatus.SECURITY_BLOCKED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.REVIEW_MONITORING]: [
    PublicationStatus.AWAITING_REVIEW,
    PublicationStatus.CHANGES_REQUESTED,
    PublicationStatus.SECURITY_BLOCKED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.AWAITING_REVIEW]: [
    PublicationStatus.READY_FOR_HUMAN_MERGE,
    PublicationStatus.CHANGES_REQUESTED,
    PublicationStatus.BASE_BRANCH_STALE,
    PublicationStatus.CI_FAILED,
    PublicationStatus.SECURITY_BLOCKED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.READY_FOR_HUMAN_MERGE]: [
    PublicationStatus.MERGED,
    PublicationStatus.CHANGES_REQUESTED,
    PublicationStatus.BASE_BRANCH_STALE,
    PublicationStatus.CI_FAILED,
    PublicationStatus.SECURITY_BLOCKED,
  ],
  [PublicationStatus.MERGED]: [
    PublicationStatus.POST_MERGE_VERIFYING,
    PublicationStatus.MERGE_REVERTED,
  ],
  [PublicationStatus.POST_MERGE_VERIFYING]: [
    PublicationStatus.RECOVERY_CONFIRMED,
    PublicationStatus.POST_MERGE_FAILED,
    PublicationStatus.MERGE_REVERTED,
  ],
  [PublicationStatus.RECOVERY_CONFIRMED]: [PublicationStatus.CLOSED],
  [PublicationStatus.CLOSED]: [],
  [PublicationStatus.PUBLICATION_BLOCKED]: [],
  [PublicationStatus.PUSH_FAILED]: [
    PublicationStatus.BRANCH_PUBLISHING,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.PR_CREATION_FAILED]: [
    PublicationStatus.DRAFT_PR_CREATING,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.CI_FAILED]: [
    PublicationStatus.CI_MONITORING,
    PublicationStatus.REVISION_REQUIRED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.CHANGES_REQUESTED]: [
    PublicationStatus.REVISION_REQUIRED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.REVISION_REQUIRED]: [
    PublicationStatus.POLICY_CHECK,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.BASE_BRANCH_STALE]: [
    PublicationStatus.REVISION_REQUIRED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.SECURITY_BLOCKED]: [
    PublicationStatus.REVISION_REQUIRED,
    PublicationStatus.CANCELLED,
  ],
  [PublicationStatus.POST_MERGE_FAILED]: [],
  [PublicationStatus.MERGE_REVERTED]: [],
  [PublicationStatus.CANCELLED]: [],
  [PublicationStatus.TIMED_OUT]: [],
};

export function isTerminalPublicationStatus(status: PublicationStatus): boolean {
  return terminal.has(status);
}

export function assertPublicationTransition(from: PublicationStatus, to: PublicationStatus): void {
  if (from === to) return;
  if (!transitions[from].includes(to))
    throw new Error(`Invalid publication transition: ${from} -> ${to}`);
}
