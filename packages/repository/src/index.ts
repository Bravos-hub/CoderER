import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '@codeer/logger';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

export interface CloneRepositoryInput {
  owner: string;
  name: string;
  cloneUrl: string;
  defaultBranch: string;
  accessToken?: string | undefined;
  cloneDepth?: number | undefined;
  maximumFiles?: number | undefined;
  maximumBytes?: number | undefined;
}

export interface CloneRepositoryResult {
  absolutePath: string;
  relativePath: string;
  refreshed: boolean;
  fileCount: number;
  totalBytes: number;
}

export interface CreateWorktreeInput {
  repositoryPath: string;
  baseBranch: string;
  intakeId: string;
}

export interface CreateWorktreeResult {
  id: string;
  absolutePath: string;
  relativePath: string;
  branchName: string;
  baseSha: string;
}

interface GitResult {
  stdout: string;
  stderr: string;
}

interface RepositoryFootprint {
  fileCount: number;
  totalBytes: number;
}

function assertSafeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`${label} contains unsupported characters`);
  return value;
}

function assertSafeRef(value: string): string {
  if (
    !SAFE_REF.test(value) ||
    value.includes('..') ||
    value.endsWith('/') ||
    value.startsWith('-') ||
    value.includes('@{') ||
    value.includes('\\')
  ) {
    throw new Error('Git reference contains unsupported characters');
  }
  return value;
}

function validatedCloneUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error('Clone URL must use canonical credential-free GitHub HTTPS');
  }
  return url.toString();
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function gitEnvironment(accessToken?: string): NodeJS.ProcessEnv {
  const settings: Array<[string, string]> = [
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ['credential.helper', ''],
    ['core.hooksPath', os.devNull],
  ];

  if (accessToken) {
    const basic = Buffer.from(`x-access-token:${accessToken}`, 'utf8').toString('base64');
    settings.push(['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${basic}`]);
  }

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_COUNT: String(settings.length),
  };

  settings.forEach(([key, value], index) => {
    environment[`GIT_CONFIG_KEY_${index}`] = key;
    environment[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return environment;
}

async function runGit(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<GitResult> {
  return await new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: options.env ?? gitEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const maximumOutput = 2 * 1024 * 1024;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 120_000);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < maximumOutput) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < maximumOutput) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      const reason = timedOut ? 'timeout' : (signal ?? `exit ${String(code)}`);
      reject(new Error(`git ${args[0]} failed with ${reason}: ${stderr.trim().slice(0, 4_096)}`));
    });
  });
}

async function inspectFootprint(
  root: string,
  maximumFiles: number,
  maximumBytes: number,
): Promise<RepositoryFootprint> {
  const pending = [root];
  let fileCount = 0;
  let totalBytes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const entry = await lstat(current);

    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const children = await readdir(current);
      for (const child of children) pending.push(path.join(current, child));
      continue;
    }

    if (entry.isFile()) {
      fileCount += 1;
      totalBytes += entry.size;
      if (fileCount > maximumFiles) {
        throw new Error(`Repository exceeds the ${maximumFiles} file safety limit`);
      }
      if (totalBytes > maximumBytes) {
        throw new Error(`Repository exceeds the ${maximumBytes} byte safety limit`);
      }
    }
  }

  return { fileCount, totalBytes };
}

export class RepositoryWorkspace {
  readonly root: string;
  private readonly repositoriesRoot: string;
  private readonly worktreesRoot: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.repositoriesRoot = path.join(this.root, 'repositories');
    this.worktreesRoot = path.join(this.root, 'worktrees');
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.repositoriesRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.worktreesRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async cloneOrRefresh(input: CloneRepositoryInput): Promise<CloneRepositoryResult> {
    await this.initialize();
    const owner = assertSafeSegment(input.owner, 'Repository owner');
    const name = assertSafeSegment(input.name, 'Repository name');
    const defaultBranch = assertSafeRef(input.defaultBranch);
    const cloneUrl = validatedCloneUrl(input.cloneUrl);
    const cloneDepth = Math.max(1, Math.min(input.cloneDepth ?? 1, 1_000));
    const maximumFiles = input.maximumFiles ?? 100_000;
    const maximumBytes = input.maximumBytes ?? 2 * 1024 * 1024 * 1024;
    const repositoryPath = path.join(this.repositoriesRoot, owner, name);
    this.assertWithinRoot(repositoryPath);
    const gitDirectory = path.join(repositoryPath, '.git');
    const refreshed = await exists(gitDirectory);
    const env = gitEnvironment(input.accessToken);

    try {
      if (refreshed) {
        logger.info({ owner, name }, 'Refreshing existing repository clone');
        await runGit(['remote', 'set-url', 'origin', cloneUrl], { cwd: repositoryPath, env });
        await runGit(
          ['fetch', '--prune', '--no-tags', `--depth=${cloneDepth}`, 'origin', defaultBranch],
          { cwd: repositoryPath, env, timeoutMs: 300_000 },
        );
      } else {
        logger.info({ owner, name }, 'Cloning repository');
        await mkdir(path.dirname(repositoryPath), { recursive: true, mode: 0o700 });
        await runGit(
          [
            'clone',
            '--filter=blob:none',
            '--single-branch',
            `--depth=${cloneDepth}`,
            '--no-tags',
            '--origin',
            'origin',
            '--branch',
            defaultBranch,
            cloneUrl,
            repositoryPath,
          ],
          { env, timeoutMs: 300_000 },
        );
      }

      await runGit(['checkout', '--force', defaultBranch], { cwd: repositoryPath, env });
      await runGit(['reset', '--hard', `origin/${defaultBranch}`], { cwd: repositoryPath, env });
      await runGit(['clean', '-ffdx'], { cwd: repositoryPath, env });
      const footprint = await inspectFootprint(repositoryPath, maximumFiles, maximumBytes);

      return {
        absolutePath: repositoryPath,
        relativePath: path.relative(this.root, repositoryPath),
        refreshed,
        ...footprint,
      };
    } catch (error) {
      await rm(repositoryPath, { recursive: true, force: true });
      throw error;
    }
  }

  async createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
    const baseBranch = assertSafeRef(input.baseBranch);
    const id = randomUUID();
    const branchName = `codeer/recovery-${input.intakeId.slice(0, 8)}-${id.slice(0, 8)}`;
    const worktreePath = path.join(this.worktreesRoot, id);
    this.assertWithinRoot(input.repositoryPath);
    this.assertWithinRoot(worktreePath);
    const baseRef = `origin/${baseBranch}`;
    const env = gitEnvironment();
    const baseSha = (
      await runGit(['rev-parse', '--verify', `${baseRef}^{commit}`], {
        cwd: input.repositoryPath,
        env,
      })
    ).stdout;

    await rm(worktreePath, { recursive: true, force: true });
    await runGit(['worktree', 'prune'], { cwd: input.repositoryPath, env });
    await runGit(['worktree', 'add', '--detach', worktreePath, baseSha], {
      cwd: input.repositoryPath,
      env,
    });
    await runGit(['switch', '-c', branchName], { cwd: worktreePath, env });

    return {
      id,
      absolutePath: worktreePath,
      relativePath: path.relative(this.root, worktreePath),
      branchName,
      baseSha,
    };
  }

  private assertWithinRoot(target: string): void {
    const resolved = path.resolve(target);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Repository workspace path escaped the configured root');
    }
  }
}
