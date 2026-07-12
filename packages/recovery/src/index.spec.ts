import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CitationSourceType,
  RecoveryRunStatus,
  type InvestigationCitation,
  type RecoveryPolicy,
} from '@codeer/contracts';
import { assertRecoveryTransition, evaluatePatchPolicy, parseUnifiedDiff } from './index.js';

const citation: InvestigationCitation = {
  sourceType: CitationSourceType.REPOSITORY_FILE,
  sourceId: randomUUID(),
  digest: 'a'.repeat(64),
  path: 'src/example.ts',
  lineStart: 1,
  lineEnd: 2,
  label: 'example',
};

const policy: RecoveryPolicy = {
  policyVersion: 'recovery-v1',
  allowedPaths: ['src'],
  deniedPaths: ['src/secrets'],
  allowedExtensions: ['.ts'],
  maximumChangedFiles: 5,
  maximumChangedLines: 50,
  maximumPatchHunks: 10,
  maximumPatchBytes: 100_000,
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

describe('controlled recovery lifecycle', () => {
  it('allows the durable happy path and rejects stage skipping', () => {
    expect(() =>
      assertRecoveryTransition(RecoveryRunStatus.REQUESTED, RecoveryRunStatus.POLICY_CHECK),
    ).not.toThrow();
    expect(() =>
      assertRecoveryTransition(RecoveryRunStatus.REQUESTED, RecoveryRunStatus.VERIFYING),
    ).toThrow(/Invalid recovery transition/);
  });
});

describe('unified diff governance', () => {
  it('parses a textual patch and enforces evidence provenance', () => {
    const diff = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,2 +1,2 @@',
      '-const oldValue = true;',
      '+const newValue = true;',
      ' export { newValue };',
    ].join('\n');
    const parsed = parseUnifiedDiff(diff, {
      'src/example.ts': { treatmentPlanStep: 1, citations: [citation] },
    });
    expect(parsed.changedFiles).toBe(1);
    expect(parsed.addedLines).toBe(1);
    expect(parsed.deletedLines).toBe(1);
    expect(evaluatePatchPolicy(policy, parsed.files, Buffer.byteLength(diff)).allowed).toBe(true);
  });

  it('rejects traversal, binary changes and unprovenanced files', () => {
    expect(() =>
      parseUnifiedDiff(
        'diff --git a/../secret b/../secret\n--- a/../secret\n+++ b/../secret\n@@ -1 +1 @@\n-a\n+b',
        {},
      ),
    ).toThrow();
    expect(() => parseUnifiedDiff('GIT binary patch', {})).toThrow(/Binary/);
  });

  it('blocks dependency, workflow and scope expansion by default', () => {
    const makeFile = (filePath: string) => ({
      id: randomUUID(),
      patchId: randomUUID(),
      oldPath: filePath,
      newPath: filePath,
      changeType: 'MODIFY' as const,
      oldDigest: null,
      newDigest: null,
      addedLines: 1,
      deletedLines: 1,
      binary: false,
      generated: false,
      sensitive: false,
      hunks: [
        {
          id: randomUUID(),
          fileId: randomUUID(),
          sequence: 1,
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          header: '@@ -1 +1 @@',
          content: '@@ -1 +1 @@\n-a\n+b',
          addedLines: 1,
          deletedLines: 1,
          treatmentPlanStep: 1,
          evidenceCitations: [citation],
          contentHash: 'b'.repeat(64),
        },
      ],
    });
    const decision = evaluatePatchPolicy(
      { ...policy, allowedPaths: ['.'], allowedExtensions: ['.json', '.yml'] },
      [makeFile('package.json'), makeFile('.github/workflows/ci.yml')],
      100,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/Dependency manifest/);
    expect(decision.reasons.join(' ')).toMatch(/Workflow changes/);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RecoveryWorktreeManager } from './worktree.js';

function governedFile(
  filePath: string,
  options: Partial<{
    changeType: 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME';
    addedLines: number;
    deletedLines: number;
    generated: boolean;
    sensitive: boolean;
  }> = {},
) {
  const fileId = randomUUID();
  return {
    id: fileId,
    patchId: randomUUID(),
    oldPath: options.changeType === 'ADD' ? null : filePath,
    newPath: options.changeType === 'DELETE' ? null : filePath,
    changeType: options.changeType ?? ('MODIFY' as const),
    oldDigest: null,
    newDigest: null,
    addedLines: options.addedLines ?? 1,
    deletedLines: options.deletedLines ?? 1,
    binary: false,
    generated: options.generated ?? false,
    sensitive: options.sensitive ?? false,
    hunks: [
      {
        id: randomUUID(),
        fileId,
        sequence: 1,
        oldStart: 1,
        oldLines: options.deletedLines ?? 1,
        newStart: 1,
        newLines: options.addedLines ?? 1,
        header: '@@ -1 +1 @@',
        content: '@@ -1 +1 @@\n-a\n+b',
        addedLines: options.addedLines ?? 1,
        deletedLines: options.deletedLines ?? 1,
        treatmentPlanStep: 1,
        evidenceCitations: [citation],
        contentHash: 'c'.repeat(64),
      },
    ],
  };
}

describe('enterprise recovery policy boundaries', () => {
  it('enforces file, line, hunk and byte budgets before application', () => {
    const files = [governedFile('src/a.ts'), governedFile('src/b.ts')];
    const decision = evaluatePatchPolicy(
      {
        ...policy,
        maximumChangedFiles: 1,
        maximumChangedLines: 1,
        maximumPatchHunks: 1,
        maximumPatchBytes: 10,
      },
      files,
      100,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/file budget/i);
    expect(decision.reasons.join(' ')).toMatch(/line budget/i);
    expect(decision.reasons.join(' ')).toMatch(/hunk budget/i);
    expect(decision.reasons.join(' ')).toMatch(/byte budget/i);
  });

  it('requires elevated policy for generated, lockfile, migration and security-sensitive changes', () => {
    const decision = evaluatePatchPolicy(
      { ...policy, allowedPaths: ['.'], allowedExtensions: ['.ts', '.json', '.prisma', '.lock'] },
      [
        governedFile('dist/generated.ts', { generated: true }),
        governedFile('package-lock.json'),
        governedFile('packages/database/prisma/schema.prisma'),
        governedFile('src/auth/authorization.ts', { sensitive: true }),
      ],
      500,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/Generated or vendored/i);
    expect(decision.reasons.join(' ')).toMatch(/Lockfile/i);
    expect(decision.reasons.join(' ')).toMatch(/Migration/i);
    expect(decision.reasons.join(' ')).toMatch(/Security-sensitive/i);
  });

  it('rejects malformed hunk counts and missing provenance', () => {
    const malformed = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,2 +1,2 @@',
      '-only-one-old-line',
      '+only-one-new-line',
    ].join('\n');
    expect(() =>
      parseUnifiedDiff(malformed, {
        'src/example.ts': { treatmentPlanStep: 1, citations: [citation] },
      }),
    ).toThrow(/line counts/i);
    expect(() => parseUnifiedDiff(malformed, {})).toThrow(/provenance/i);
  });
});

describe('isolated recovery worktrees', () => {
  it('creates from an immutable SHA, applies atomically, and removes the branch', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codeer-recovery-test-'));
    const repositoriesRoot = path.join(root, 'repositories');
    const recoveryRoot = path.join(root, 'recoveries');
    const repository = path.join(repositoriesRoot, 'fixture');
    await mkdir(repository, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'codeer-test@example.invalid'], {
      cwd: repository,
    });
    execFileSync('git', ['config', 'user.name', 'CodeER Test'], { cwd: repository });
    await writeFile(path.join(repository, 'example.txt'), 'before\n', 'utf8');
    execFileSync('git', ['add', 'example.txt'], { cwd: repository });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repository });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    const manager = new RecoveryWorktreeManager(repositoriesRoot, recoveryRoot);
    const descriptor = await manager.create('fixture', base, 'codeer/recovery-test', randomUUID());
    const patch = [
      'diff --git a/example.txt b/example.txt',
      'index 90be1bd..3b18e51 100644',
      '--- a/example.txt',
      '+++ b/example.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '',
    ].join('\n');
    await manager.applyPatchAtomically(descriptor.worktreePath, patch);
    expect(await readFile(path.join(descriptor.worktreePath, 'example.txt'), 'utf8')).toBe(
      'after\n',
    );
    expect(await manager.currentHead(descriptor.worktreePath)).toBe(base);
    expect(await manager.diff(descriptor.worktreePath, base)).toContain('+after');

    await expect(
      manager.applyPatchAtomically(descriptor.worktreePath, 'not a patch'),
    ).rejects.toThrow(/preflight/i);
    expect(await readFile(path.join(descriptor.worktreePath, 'example.txt'), 'utf8')).toBe(
      'after\n',
    );

    await manager.remove(repository, descriptor.worktreePath, descriptor.branchName);
    const branches = execFileSync('git', ['branch', '--list', descriptor.branchName], {
      cwd: repository,
      encoding: 'utf8',
    });
    expect(branches.trim()).toBe('');
    await rm(root, { recursive: true, force: true });
  }, 30_000);

  it('rejects traversal, protected branches and short commit identifiers', async () => {
    const manager = new RecoveryWorktreeManager(
      '/tmp/codeer-repositories',
      '/tmp/codeer-recoveries',
    );
    await expect(
      manager.create('../escape', 'a'.repeat(40), 'codeer/test', randomUUID()),
    ).rejects.toThrow();
    await expect(manager.create('missing', 'abc123', 'codeer/test', randomUUID())).rejects.toThrow(
      /full immutable SHA/i,
    );
    await expect(manager.create('missing', 'a'.repeat(40), 'main', randomUUID())).rejects.toThrow(
      /Protected branch/i,
    );
  });
});
