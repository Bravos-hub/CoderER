import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.env',
  '.graphql',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.prisma',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);

export interface RepositoryTreeEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number | null;
}

export interface RepositoryFileRange {
  sourceId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  totalLines: number;
  digest: string;
  content: string;
  truncated: boolean;
}

export interface RepositorySearchMatch {
  sourceId: string;
  path: string;
  line: number;
  excerpt: string;
  digest: string;
}

function deterministicUuid(namespace: string): string {
  const bytes = createHash('sha256').update(namespace).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error('Repository path is outside the approved worktree.');
  }
  return normalized;
}

function safeQuery(value: string): string {
  const query = value.trim();
  if (
    query.length < 2 ||
    query.length > 240 ||
    [...query].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error('Repository search query is outside policy limits.');
  }
  return query;
}

function isProbablyText(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    TEXT_EXTENSIONS.has(path.extname(base)) ||
    ['dockerfile', 'makefile', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(base)
  );
}

export class RepositoryReadOnlyInspector {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async resolveWorktree(relativePath: string): Promise<string> {
    const normalized = normalizeRelativePath(relativePath);
    const candidate = path.resolve(this.root, normalized);
    this.assertWithinRoot(candidate);
    const [rootReal, candidateReal] = await Promise.all([realpath(this.root), realpath(candidate)]);
    const relative = path.relative(rootReal, candidateReal);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Resolved worktree escaped the repository workspace root.');
    }
    const metadata = await lstat(candidateReal);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Approved worktree is not a regular directory.');
    }
    return candidateReal;
  }

  async listTree(worktreePath: string, maximumEntries = 2_000): Promise<RepositoryTreeEntry[]> {
    const root = await this.approvedRoot(worktreePath);
    const pending = [''];
    const entries: RepositoryTreeEntry[] = [];
    const cap = Math.min(Math.max(maximumEntries, 1), 10_000);

    while (pending.length && entries.length < cap) {
      const current = pending.shift() ?? '';
      const directory = path.join(root, current);
      const children = await readdir(directory, { withFileTypes: true });
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (SKIPPED_DIRECTORIES.has(child.name)) continue;
        const relative = current ? `${current}/${child.name}` : child.name;
        const absolute = await this.approvedChild(root, relative);
        const metadata = await lstat(absolute);
        if (metadata.isSymbolicLink()) continue;
        if (metadata.isDirectory()) {
          entries.push({ path: relative, kind: 'directory', size: null });
          pending.push(relative);
        } else if (metadata.isFile()) {
          entries.push({ path: relative, kind: 'file', size: metadata.size });
        }
        if (entries.length >= cap) break;
      }
    }
    return entries;
  }

  async readFileRange(
    worktreePath: string,
    filePath: string,
    lineStart = 1,
    lineEnd = lineStart + 199,
    maximumBytes = 256 * 1024,
  ): Promise<RepositoryFileRange> {
    const root = await this.approvedRoot(worktreePath);
    const normalized = normalizeRelativePath(filePath);
    const absolute = await this.approvedChild(root, normalized);
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error('Requested path is not a regular file.');
    if (!isProbablyText(normalized))
      throw new Error('Requested file type is not approved for text inspection.');
    if (metadata.size > Math.min(Math.max(maximumBytes, 1_024), 2 * 1024 * 1024)) {
      throw new Error('Requested file exceeds the inspection size limit.');
    }
    const text = await readFile(absolute, 'utf8');
    if (text.includes('\u0000')) throw new Error('Binary file inspection is not allowed.');
    const lines = text.split(/\r?\n/);
    const start = Math.min(Math.max(Math.trunc(lineStart), 1), Math.max(lines.length, 1));
    const end = Math.min(Math.max(Math.trunc(lineEnd), start), Math.min(lines.length, start + 499));
    const content = lines.slice(start - 1, end).join('\n');
    return {
      sourceId: deterministicUuid(`repository-file:${normalized}`),
      path: normalized,
      lineStart: start,
      lineEnd: end,
      totalLines: lines.length,
      digest: createHash('sha256').update(text).digest('hex'),
      content,
      truncated: start > 1 || end < lines.length,
    };
  }

  async searchText(
    worktreePath: string,
    rawQuery: string,
    maximumMatches = 100,
  ): Promise<RepositorySearchMatch[]> {
    const query = safeQuery(rawQuery);
    const root = await this.approvedRoot(worktreePath);
    const tree = await this.listTree(root, 8_000);
    const matches: RepositorySearchMatch[] = [];
    const cap = Math.min(Math.max(maximumMatches, 1), 250);
    const needle = query.toLowerCase();

    for (const entry of tree) {
      if (entry.kind !== 'file' || !isProbablyText(entry.path) || (entry.size ?? 0) > 512 * 1024)
        continue;
      const absolute = await this.approvedChild(root, entry.path);
      const text = await readFile(absolute, 'utf8').catch(() => '');
      if (!text || text.includes('\u0000')) continue;
      const digest = createHash('sha256').update(text).digest('hex');
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (!line.toLowerCase().includes(needle)) continue;
        matches.push({
          sourceId: deterministicUuid(`repository-file:${entry.path}`),
          path: entry.path,
          line: index + 1,
          excerpt: line.slice(0, 500),
          digest,
        });
        if (matches.length >= cap) return matches;
      }
    }
    return matches;
  }

  async getManifest(worktreePath: string): Promise<unknown> {
    const root = await this.approvedRoot(worktreePath);
    const candidates = [
      'package.json',
      'pnpm-workspace.yaml',
      'yarn.lock',
      'pnpm-lock.yaml',
      'package-lock.json',
    ];
    const result: Record<string, unknown> = {};
    for (const candidate of candidates) {
      try {
        const file = await this.readFileRange(
          root,
          candidate,
          1,
          candidate === 'package.json' ? 500 : 80,
          512 * 1024,
        );
        result[candidate] = file;
      } catch {
        // Missing or unsupported manifests are represented by omission.
      }
    }
    return result;
  }

  async getConfigSummary(worktreePath: string): Promise<unknown> {
    const root = await this.approvedRoot(worktreePath);
    const tree = await this.listTree(root, 5_000);
    const names = new Set([
      'docker-compose.yml',
      'docker-compose.yaml',
      'next.config.js',
      'next.config.mjs',
      'next.config.ts',
      'nest-cli.json',
      'tsconfig.json',
      'vite.config.js',
      'vite.config.ts',
    ]);
    const candidates = tree
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path)
      .filter((entry) => names.has(path.basename(entry)) || entry.startsWith('.github/workflows/'))
      .slice(0, 50);
    const files = [];
    for (const candidate of candidates) {
      try {
        files.push(await this.readFileRange(root, candidate, 1, 250, 256 * 1024));
      } catch {
        // Skip files that fail the regular-file boundary.
      }
    }
    return { files };
  }

  async getDependencyGraph(worktreePath: string): Promise<unknown> {
    const root = await this.approvedRoot(worktreePath);
    const tree = await this.listTree(root, 8_000);
    const packageFiles = tree
      .filter((entry) => entry.kind === 'file' && path.basename(entry.path) === 'package.json')
      .slice(0, 200);
    const packages = [];
    for (const entry of packageFiles) {
      try {
        const absolute = await this.approvedChild(root, entry.path);
        const metadata = await stat(absolute);
        if (metadata.size > 512 * 1024) continue;
        const parsed = JSON.parse(await readFile(absolute, 'utf8')) as Record<string, unknown>;
        packages.push({
          sourceId: deterministicUuid(`repository-file:${entry.path}`),
          path: entry.path,
          digest: createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
          name: parsed.name ?? null,
          version: parsed.version ?? null,
          private: parsed.private ?? null,
          workspaces: parsed.workspaces ?? null,
          scripts: parsed.scripts ?? null,
          dependencies: parsed.dependencies ?? null,
          devDependencies: parsed.devDependencies ?? null,
          peerDependencies: parsed.peerDependencies ?? null,
        });
      } catch {
        // Invalid manifests are surfaced elsewhere as evidence, not executed here.
      }
    }
    return { packages };
  }

  private async approvedRoot(value: string): Promise<string> {
    const resolved = path.resolve(value);
    this.assertWithinRoot(resolved);
    const actual = await realpath(resolved);
    this.assertWithinRoot(actual);
    return actual;
  }

  private async approvedChild(root: string, relativePath: string): Promise<string> {
    const normalized = normalizeRelativePath(relativePath);
    const candidate = path.resolve(root, normalized);
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Repository path escaped its worktree.');
    const parentReal = await realpath(path.dirname(candidate));
    const parentRelative = path.relative(root, parentReal);
    if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) {
      throw new Error('Repository path traversed a symlink outside its worktree.');
    }
    return candidate;
  }

  private assertWithinRoot(target: string): void {
    const relative = path.relative(this.root, path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Repository inspection escaped the configured workspace root.');
    }
  }
}

export { deterministicUuid as deterministicRepositorySourceId };
