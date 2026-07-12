import { RecoveryRunStatus } from '@codeer/contracts';

const terminalStatuses = new Set<RecoveryRunStatus>([
  RecoveryRunStatus.PUBLISHED,
  RecoveryRunStatus.POLICY_BLOCKED,
  RecoveryRunStatus.CANCELLED,
  RecoveryRunStatus.TIMED_OUT,
  RecoveryRunStatus.PATCH_REJECTED,
  RecoveryRunStatus.SECURITY_REJECTED,
  RecoveryRunStatus.VERIFICATION_FAILED,
  RecoveryRunStatus.WORKTREE_FAILED,
  RecoveryRunStatus.MODEL_FAILED,
  RecoveryRunStatus.TOOL_FAILED,
  RecoveryRunStatus.BUDGET_EXCEEDED,
  RecoveryRunStatus.CLEANUP_FAILED,
]);

const transitions: Readonly<Record<RecoveryRunStatus, readonly RecoveryRunStatus[]>> = {
  [RecoveryRunStatus.REQUESTED]: [RecoveryRunStatus.POLICY_CHECK, RecoveryRunStatus.CANCELLED],
  [RecoveryRunStatus.POLICY_CHECK]: [
    RecoveryRunStatus.WORKTREE_PREPARING,
    RecoveryRunStatus.POLICY_BLOCKED,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.WORKTREE_PREPARING]: [
    RecoveryRunStatus.PATCH_PLANNING,
    RecoveryRunStatus.WORKTREE_FAILED,
    RecoveryRunStatus.CANCELLED,
    RecoveryRunStatus.TIMED_OUT,
  ],
  [RecoveryRunStatus.PATCH_PLANNING]: [
    RecoveryRunStatus.PATCH_GENERATING,
    RecoveryRunStatus.MODEL_FAILED,
    RecoveryRunStatus.BUDGET_EXCEEDED,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.PATCH_GENERATING]: [
    RecoveryRunStatus.PATCH_VALIDATING,
    RecoveryRunStatus.MODEL_FAILED,
    RecoveryRunStatus.TOOL_FAILED,
    RecoveryRunStatus.BUDGET_EXCEEDED,
    RecoveryRunStatus.CANCELLED,
    RecoveryRunStatus.TIMED_OUT,
  ],
  [RecoveryRunStatus.PATCH_VALIDATING]: [
    RecoveryRunStatus.SECURITY_REVIEW,
    RecoveryRunStatus.PATCH_REJECTED,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.SECURITY_REVIEW]: [
    RecoveryRunStatus.VERIFYING,
    RecoveryRunStatus.SECURITY_REJECTED,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.VERIFYING]: [
    RecoveryRunStatus.PACKAGE_BUILDING,
    RecoveryRunStatus.VERIFICATION_FAILED,
    RecoveryRunStatus.CANCELLED,
    RecoveryRunStatus.TIMED_OUT,
  ],
  [RecoveryRunStatus.PACKAGE_BUILDING]: [
    RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
    RecoveryRunStatus.TOOL_FAILED,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL]: [
    RecoveryRunStatus.READY_TO_PUBLISH,
    RecoveryRunStatus.PATCH_PLANNING,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.READY_TO_PUBLISH]: [
    RecoveryRunStatus.PUBLISHED,
    RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
    RecoveryRunStatus.CANCELLED,
  ],
  [RecoveryRunStatus.PUBLISHED]: [],
  [RecoveryRunStatus.POLICY_BLOCKED]: [],
  [RecoveryRunStatus.CANCELLED]: [],
  [RecoveryRunStatus.TIMED_OUT]: [],
  [RecoveryRunStatus.PATCH_REJECTED]: [RecoveryRunStatus.PATCH_PLANNING],
  [RecoveryRunStatus.SECURITY_REJECTED]: [RecoveryRunStatus.PATCH_PLANNING],
  [RecoveryRunStatus.VERIFICATION_FAILED]: [RecoveryRunStatus.PATCH_PLANNING],
  [RecoveryRunStatus.WORKTREE_FAILED]: [RecoveryRunStatus.WORKTREE_PREPARING],
  [RecoveryRunStatus.MODEL_FAILED]: [RecoveryRunStatus.PATCH_PLANNING],
  [RecoveryRunStatus.TOOL_FAILED]: [RecoveryRunStatus.PATCH_PLANNING],
  [RecoveryRunStatus.BUDGET_EXCEEDED]: [],
  [RecoveryRunStatus.CLEANUP_FAILED]: [],
};

export function isRecoveryTerminal(status: RecoveryRunStatus): boolean {
  return terminalStatuses.has(status);
}

export function assertRecoveryTransition(
  current: RecoveryRunStatus,
  next: RecoveryRunStatus,
): void {
  if (current === next) return;
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid recovery transition: ${current} -> ${next}`);
  }
}
