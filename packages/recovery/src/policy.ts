import path from 'node:path';
import type { PatchFile, RecoveryPolicy } from '@codeer/contracts';

const GENERATED_PATH_PATTERNS = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)\.next\//,
  /(^|\/)generated\//,
  /(^|\/)vendor\//,
];
const DEPENDENCY_FILES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
const LOCK_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
]);
const INFRASTRUCTURE_FILES = new Set([
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  'terraform.tf',
]);
const SECURITY_SENSITIVE_PATTERNS = [
  /(^|\/)auth/i,
  /(^|\/)security/i,
  /(^|\/)permissions?/i,
  /(^|\/)rbac/i,
  /(^|\/)iam/i,
  /(^|\/)middleware/i,
  /(^|\/)\.env/i,
];

export interface RecoveryPolicyDecision {
  allowed: boolean;
  reasons: string[];
  policyVersion: string;
  evaluatedAt: string;
}

function normalize(value: string): string {
  const slash = value.replace(/\\/g, '/');
  if (slash.startsWith('/') || /^[A-Za-z]:\//.test(slash))
    throw new Error('Absolute paths are denied.');
  const normalized = path.posix.normalize(slash);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Invalid or traversing patch path.');
  }
  if (normalized === '.git' || normalized.startsWith('.git/'))
    throw new Error('Git metadata is immutable.');
  return normalized;
}

function matchesPrefix(filePath: string, candidate: string): boolean {
  const trimmed = candidate.replace(/\\/g, '/').replace(/\/$/, '');
  if (trimmed === '.' || trimmed === '') return true;
  if (trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)) {
    throw new Error('Absolute policy paths are denied.');
  }
  const normalizedCandidate = path.posix.normalize(trimmed);
  if (
    !normalizedCandidate ||
    normalizedCandidate === '..' ||
    normalizedCandidate.startsWith('../')
  ) {
    throw new Error('Invalid or traversing policy path.');
  }
  return filePath === normalizedCandidate || filePath.startsWith(`${normalizedCandidate}/`);
}

function baseName(filePath: string): string {
  return path.posix.basename(filePath);
}

function extension(filePath: string): string {
  const base = baseName(filePath);
  if (base === 'Dockerfile') return '.dockerfile';
  return path.posix.extname(base).toLowerCase();
}

export function isGeneratedPath(filePath: string): boolean {
  return GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function isSecuritySensitivePath(filePath: string): boolean {
  return SECURITY_SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function evaluatePatchPolicy(
  policy: RecoveryPolicy,
  files: readonly PatchFile[],
  patchBytes: number,
): RecoveryPolicyDecision {
  const reasons: string[] = [];
  const totalLines = files.reduce((sum, file) => sum + file.addedLines + file.deletedLines, 0);
  const totalHunks = files.reduce((sum, file) => sum + file.hunks.length, 0);

  if (files.length > policy.maximumChangedFiles) reasons.push('Changed-file budget exceeded.');
  if (totalLines > policy.maximumChangedLines) reasons.push('Changed-line budget exceeded.');
  if (totalHunks > policy.maximumPatchHunks) reasons.push('Patch-hunk budget exceeded.');
  if (patchBytes > policy.maximumPatchBytes) reasons.push('Patch byte budget exceeded.');

  for (const file of files) {
    let filePath: string;
    try {
      filePath = normalize(file.newPath ?? file.oldPath ?? '');
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : 'Invalid patch path.');
      continue;
    }
    if (!policy.allowedPaths.some((allowed) => matchesPrefix(filePath, allowed))) {
      reasons.push(`Path is outside approved scope: ${filePath}`);
    }
    if (policy.deniedPaths.some((denied) => matchesPrefix(filePath, denied))) {
      reasons.push(`Path is explicitly denied: ${filePath}`);
    }
    const ext = extension(filePath);
    if (!policy.allowedExtensions.includes(ext))
      reasons.push(`File type is not approved: ${filePath}`);
    if (file.binary) reasons.push(`Binary changes are denied: ${filePath}`);
    if (file.changeType === 'ADD' && !policy.allowNewFiles)
      reasons.push(`New files are denied: ${filePath}`);
    if (file.changeType === 'DELETE' && !policy.allowDeletedFiles)
      reasons.push(`File deletion is denied: ${filePath}`);
    if ((file.generated || isGeneratedPath(filePath)) && !policy.allowGeneratedFiles) {
      reasons.push(`Generated or vendored files are denied: ${filePath}`);
    }
    if (DEPENDENCY_FILES.has(baseName(filePath)) && !policy.allowDependencyChanges) {
      reasons.push(`Dependency manifest changes require elevated policy: ${filePath}`);
    }
    if (LOCK_FILES.has(baseName(filePath)) && !policy.allowLockfileChanges) {
      reasons.push(`Lockfile changes require elevated policy: ${filePath}`);
    }
    if (filePath.startsWith('.github/workflows/') && !policy.allowWorkflowChanges) {
      reasons.push(`Workflow changes require elevated policy: ${filePath}`);
    }
    if (
      (INFRASTRUCTURE_FILES.has(baseName(filePath)) || filePath.startsWith('infra/')) &&
      !policy.allowInfrastructureChanges
    ) {
      reasons.push(`Infrastructure changes require elevated policy: ${filePath}`);
    }
    if (
      (/migrations?\//i.test(filePath) || /schema\.prisma$/i.test(filePath)) &&
      !policy.allowMigrationChanges
    ) {
      reasons.push(`Migration changes require elevated policy: ${filePath}`);
    }
    if (
      (file.sensitive || isSecuritySensitivePath(filePath)) &&
      !policy.allowSecuritySensitiveChanges
    ) {
      reasons.push(`Security-sensitive changes require elevated policy: ${filePath}`);
    }
    for (const hunk of file.hunks) {
      if (hunk.treatmentPlanStep < 1 || hunk.evidenceCitations.length === 0) {
        reasons.push(`Patch hunk lacks evidence provenance: ${filePath}#${hunk.sequence}`);
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    policyVersion: policy.policyVersion,
    evaluatedAt: new Date().toISOString(),
  };
}

export function defaultRecoveryPolicy(
  allowedPaths: string[],
  allowedExtensions = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.json',
    '.md',
    '.css',
    '.scss',
    '.html',
    '.yml',
    '.yaml',
  ],
): RecoveryPolicy {
  return {
    policyVersion: 'recovery-policy-v1',
    allowedPaths,
    deniedPaths: ['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor'],
    allowedExtensions,
    maximumChangedFiles: 25,
    maximumChangedLines: 1_000,
    maximumPatchHunks: 200,
    maximumPatchBytes: 2 * 1024 * 1024,
    allowNewFiles: true,
    allowDeletedFiles: false,
    allowGeneratedFiles: false,
    allowDependencyChanges: false,
    allowLockfileChanges: false,
    allowWorkflowChanges: false,
    allowInfrastructureChanges: false,
    allowMigrationChanges: false,
    allowSecuritySensitiveChanges: false,
    requireSecurityReview: true,
    requireIndependentVerification: true,
    requireHumanPublicationApproval: true,
    requiredPublicationApprovals: 1,
    retentionDays: 90,
  };
}
