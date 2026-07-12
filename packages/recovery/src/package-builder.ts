import { randomUUID } from 'node:crypto';
import { RecoverySecurityDecision, RecoveryVerificationStatus } from '@codeer/contracts';
import type {
  PatchVersion,
  PullRequestPackage,
  RecoverySecurityReview,
  RecoveryVerificationReport,
} from '@codeer/contracts';
import { canonicalJson } from '@codeer/incidents';
import { sha256Hex } from '@codeer/security';

export interface PullRequestPackageInput {
  recoveryId: string;
  patch: PatchVersion;
  diagnosis: { summary: string };
  treatmentPlan: {
    goal: string;
    risk: string;
    steps: Array<{ title: string }>;
    knownLimitations: string[];
    rollbackStrategy: string;
  };
  securityReview: RecoverySecurityReview;
  verification: RecoveryVerificationReport;
  headBranch: string;
  baseBranch: string;
}

export function buildPullRequestPackage(input: PullRequestPackageInput): PullRequestPackage {
  if (input.securityReview.decision !== RecoverySecurityDecision.ALLOW) {
    throw new Error('Pull-request packaging is blocked by security review.');
  }
  if (
    input.verification.status !== RecoveryVerificationStatus.PASSED ||
    !input.verification.originalFailureResolved
  ) {
    throw new Error('Pull-request packaging requires successful independent verification.');
  }
  if (input.verification.scopeExpanded || input.verification.unexpectedChanges.length > 0) {
    throw new Error('Pull-request packaging is blocked by unexpected changes.');
  }
  const changedFiles = input.patch.files.map((file) => file.newPath ?? file.oldPath ?? 'unknown');
  const title = input.treatmentPlan.steps[0]?.title
    ? `fix: ${input.treatmentPlan.steps[0].title}`.slice(0, 240)
    : 'fix: apply approved CodeER recovery plan';
  const body = [
    '## Root cause',
    input.diagnosis.summary,
    '',
    '## Approved treatment plan',
    input.treatmentPlan.goal,
    '',
    '## Changes',
    ...changedFiles.map((file) => `- \`${file}\``),
    '',
    '## Patch statistics',
    `- Files changed: ${input.patch.changedFiles}`,
    `- Lines added: ${input.patch.addedLines}`,
    `- Lines deleted: ${input.patch.deletedLines}`,
    `- Patch digest: \`${input.patch.patchDigest}\``,
    '',
    '## Security review',
    input.securityReview.summary,
    '',
    '## Independent verification',
    input.verification.summary,
    '',
    '## Known limitations',
    ...(input.treatmentPlan.knownLimitations.length
      ? input.treatmentPlan.knownLimitations.map((item) => `- ${item}`)
      : ['- None recorded.']),
    '',
    '## Rollback',
    input.treatmentPlan.rollbackStrategy,
    '',
    '> Prepared by CodeER. Human review is required. This package does not authorize merge.',
  ].join('\n');
  const content = {
    recoveryId: input.recoveryId,
    patchId: input.patch.id,
    title,
    body,
    headBranch: input.headBranch,
    baseBranch: input.baseBranch,
    rootCauseSummary: input.diagnosis.summary,
    changedFiles,
    riskSummary: `${input.treatmentPlan.risk}: ${input.securityReview.summary}`,
    verificationSummary: input.verification.summary,
    knownLimitations: input.treatmentPlan.knownLimitations,
    rollbackInstructions: input.treatmentPlan.rollbackStrategy,
  };
  return {
    id: randomUUID(),
    version: input.patch.version,
    ...content,
    packageHash: sha256Hex(canonicalJson(content)),
    createdAt: new Date().toISOString(),
  };
}
