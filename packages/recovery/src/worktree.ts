import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RecoveryWorktreeDescriptor {
  id: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  baseCommitSha: string;
}

function safeBranchName(value: string): string {
  const normalized = value.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(normalized) ||
    normalized.includes('..') ||
    normalized.includes('//') ||
    normalized.endsWith('/') ||
    normalized.endsWith('.') ||
    normalized.startsWith('-')
  ) {
    throw new Error('Recovery branch name is outside policy.');
  }
  if (['main', 'master', 'develop', 'production', 'release'].includes(normalized.toLowerCase())) {
    throw new Error('Protected branch names cannot be used for recovery worktrees.');
  }
  return normalized;
}

function safeCommit(value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error('Base commit must be a full immutable SHA.');
  return value;
}

async function runGit(
  cwd: string,
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<GitCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Git command timed out.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (value: string) => {
      stdout += value.slice(0, 2 * 1024 * 1024 - stdout.length);
    });
    child.stderr.on('data', (value: string) => {
      stderr += value.slice(0, 2 * 1024 * 1024 - stderr.length);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

export class RecoveryWorktreeManager {
  private readonly repositoriesRoot: string;
  private readonly recoveryRoot: string;

  constructor(repositoriesRoot: string, recoveryRoot: string) {
    this.repositoriesRoot = path.resolve(repositoriesRoot);
    this.recoveryRoot = path.resolve(recoveryRoot);
  }

  async create(
    repositoryRelativePath: string,
    baseCommitSha: string,
    requestedBranchName: string,
    recoveryId: string,
  ): Promise<RecoveryWorktreeDescriptor> {
    const branchName = safeBranchName(requestedBranchName);
    const commit = safeCommit(baseCommitSha);
    const repositoryPath = await this.resolveRepository(repositoryRelativePath);
    const commitCheck = await runGit(repositoryPath, ['cat-file', '-e', `${commit}^{commit}`]);
    if (commitCheck.exitCode !== 0)
      throw new Error('Base commit is not present in the approved repository.');
    const dirtyCheck = await runGit(repositoryPath, [
      'status',
      '--porcelain=v1',
      '--untracked-files=no',
    ]);
    if (dirtyCheck.exitCode !== 0 || dirtyCheck.stdout.trim()) {
      throw new Error('Source repository must be clean before worktree creation.');
    }
    await mkdir(this.recoveryRoot, { recursive: true, mode: 0o700 });
    const worktreePath = path.join(this.recoveryRoot, recoveryId);
    this.assertWithin(this.recoveryRoot, worktreePath);
    await runGit(repositoryPath, ['worktree', 'remove', '--force', worktreePath]).catch(
      () => undefined,
    );
    await rm(worktreePath, { recursive: true, force: true });
    await runGit(repositoryPath, ['worktree', 'prune', '--expire', 'now']).catch(() => undefined);
    const existingBranch = await runGit(repositoryPath, [
      'show-ref',
      '--verify',
      '--hash',
      `refs/heads/${branchName}`,
    ]);
    if (existingBranch.exitCode === 0) {
      if (existingBranch.stdout.trim() !== commit) {
        throw new Error('Existing recovery branch does not match the approved base commit.');
      }
      const deleted = await runGit(repositoryPath, ['branch', '-D', branchName]);
      if (deleted.exitCode !== 0)
        throw new Error('Unable to reset the stale recovery branch safely.');
    }
    const result = await runGit(repositoryPath, [
      'worktree',
      'add',
      '-b',
      branchName,
      worktreePath,
      commit,
    ]);
    if (result.exitCode !== 0) throw new Error('Git worktree creation failed.');
    try {
      const head = await runGit(worktreePath, ['rev-parse', 'HEAD']);
      if (head.exitCode !== 0 || head.stdout.trim() !== commit) {
        throw new Error('Recovery worktree base commit verification failed.');
      }
      return {
        id: randomUUID(),
        repositoryPath,
        worktreePath,
        branchName,
        baseCommitSha: commit,
      };
    } catch (error) {
      await this.remove(repositoryPath, worktreePath).catch(() => undefined);
      throw error;
    }
  }

  async applyPatchAtomically(worktreePath: string, unifiedDiff: string): Promise<void> {
    const approved = await this.approvedWorktree(worktreePath);
    const check = await this.runGitWithInput(
      approved,
      ['apply', '--check', '--whitespace=error-all', '-'],
      unifiedDiff,
    );
    if (check.exitCode !== 0) throw new Error('Patch failed Git preflight validation.');
    const apply = await this.runGitWithInput(
      approved,
      ['apply', '--index', '--whitespace=error-all', '-'],
      unifiedDiff,
    );
    if (apply.exitCode !== 0) {
      await runGit(approved, ['reset', '--hard', 'HEAD']).catch(() => undefined);
      await runGit(approved, ['clean', '-fd']).catch(() => undefined);
      throw new Error('Patch application failed and was rolled back.');
    }
  }

  async diff(worktreePath: string, baseCommitSha: string): Promise<string> {
    const approved = await this.approvedWorktree(worktreePath);
    const result = await runGit(approved, [
      'diff',
      '--no-ext-diff',
      '--no-renames',
      safeCommit(baseCommitSha),
      '--',
    ]);
    if (result.exitCode !== 0) throw new Error('Unable to calculate recovery diff.');
    return result.stdout;
  }

  async remove(repositoryPath: string, worktreePath: string, branchName?: string): Promise<void> {
    const repository = await realpath(repositoryPath);
    const target = path.resolve(worktreePath);
    this.assertWithin(this.recoveryRoot, target);
    const result = await runGit(repository, ['worktree', 'remove', '--force', target]);
    if (result.exitCode !== 0) await rm(target, { recursive: true, force: true });
    await runGit(repository, ['worktree', 'prune', '--expire', 'now']).catch(() => undefined);
    if (branchName) {
      const safe = safeBranchName(branchName);
      const deleted = await runGit(repository, ['branch', '-D', safe]);
      if (deleted.exitCode !== 0 && !/not found|not a valid branch/i.test(deleted.stderr)) {
        throw new Error('Recovery branch cleanup failed.');
      }
    }
  }

  async verifyClean(worktreePath: string): Promise<boolean> {
    const approved = await this.approvedWorktree(worktreePath);
    const result = await runGit(approved, ['status', '--porcelain=v1']);
    if (result.exitCode !== 0) throw new Error('Unable to inspect recovery worktree status.');
    return result.stdout.trim().length === 0;
  }

  async currentHead(worktreePath: string): Promise<string> {
    const approved = await this.approvedWorktree(worktreePath);
    const result = await runGit(approved, ['rev-parse', 'HEAD']);
    if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(result.stdout.trim())) {
      throw new Error('Unable to resolve recovery worktree head.');
    }
    return result.stdout.trim();
  }

  private async resolveRepository(relativePath: string): Promise<string> {
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
      throw new Error('Repository path is invalid.');
    }
    const candidate = path.resolve(this.repositoriesRoot, relativePath);
    this.assertWithin(this.repositoriesRoot, candidate);
    const actual = await realpath(candidate);
    this.assertWithin(this.repositoriesRoot, actual);
    const metadata = await stat(actual);
    if (!metadata.isDirectory()) throw new Error('Approved repository path is not a directory.');
    const probe = await runGit(actual, ['rev-parse', '--is-inside-work-tree']);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true') {
      throw new Error('Approved repository path is not a Git worktree.');
    }
    return actual;
  }

  private async approvedWorktree(value: string): Promise<string> {
    const candidate = path.resolve(value);
    this.assertWithin(this.recoveryRoot, candidate);
    const actual = await realpath(candidate);
    this.assertWithin(this.recoveryRoot, actual);
    return actual;
  }

  private assertWithin(root: string, target: string): void {
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path escaped the approved recovery root.');
    }
  }

  private async runGitWithInput(
    cwd: string,
    args: readonly string[],
    input: string,
  ): Promise<GitCommandResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn('git', [...args], {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (value: string) => {
        stdout += value.slice(0, 2 * 1024 * 1024 - stdout.length);
      });
      child.stderr.on('data', (value: string) => {
        stderr += value.slice(0, 2 * 1024 * 1024 - stderr.length);
      });
      child.once('error', reject);
      child.once('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
      child.stdin.end(input);
    });
  }
}
