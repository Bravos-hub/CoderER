import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RepositoryReadOnlyInspector } from './inspector.js';

describe('RepositoryReadOnlyInspector', () => {
  it('reads bounded file ranges and returns stable provenance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeer-inspector-'));
    const worktree = path.join(root, 'worktrees', 'one');
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, 'package.json'), '{\n"name":"demo"\n}\n');
    const inspector = new RepositoryReadOnlyInspector(root);
    const resolved = await inspector.resolveWorktree('worktrees/one');
    const file = await inspector.readFileRange(resolved, 'package.json', 1, 2);
    expect(file.path).toBe('package.json');
    expect(file.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('blocks traversal and symlink escape', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeer-inspector-'));
    const worktree = path.join(root, 'worktrees', 'one');
    await mkdir(worktree, { recursive: true });
    await symlink(
      os.tmpdir(),
      path.join(worktree, 'outside'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const inspector = new RepositoryReadOnlyInspector(root);
    await expect(inspector.resolveWorktree('../outside')).rejects.toThrow(/outside|escaped/i);
    await expect(inspector.readFileRange(worktree, 'outside/secret.txt')).rejects.toThrow(
      /symlink|worktree/i,
    );
  });
});
