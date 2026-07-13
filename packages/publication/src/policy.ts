import { createHash } from 'node:crypto';
import type { ApprovedRecoveryPackage, PublicationPolicy } from './types.js';

export interface PublicationPolicyDecision {
  allowed: boolean;
  reasons: string[];
  digest: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function evaluatePublicationPolicy(
  pkg: ApprovedRecoveryPackage,
  policy: PublicationPolicy,
): PublicationPolicyDecision {
  const reasons: string[] = [];
  if (!policy.allowedBaseBranches.includes(pkg.targetBaseBranch))
    reasons.push('Target base branch is not permitted.');
  if (!pkg.branchName.startsWith(policy.recoveryBranchPrefix))
    reasons.push('Recovery branch does not use the required prefix.');
  if (!pkg.securityReviewApproved) reasons.push('Security review has not approved publication.');
  if (!pkg.verificationPassed) reasons.push('Recovery verification has not passed.');
  if (pkg.publicationApprovalCount < policy.requiredApprovals)
    reasons.push('Required publication approval threshold has not been met.');
  if (pkg.branchName === pkg.targetBaseBranch)
    reasons.push('Recovery branch cannot equal the protected base branch.');
  const payload = { package: pkg, policy, reasons };
  return {
    allowed: reasons.length === 0,
    reasons,
    digest: createHash('sha256').update(canonical(payload)).digest('hex'),
  };
}

export function deterministicPublicationBranch(
  prefix: string,
  incidentId: string,
  recoveryId: string,
  patchVersion: number,
): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `${prefix.replace(/\/$/, '')}/${clean(incidentId).slice(0, 12)}-${clean(recoveryId).slice(0, 12)}-v${patchVersion}`;
}
