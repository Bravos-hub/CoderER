import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GithubAppClient,
  GithubAppTokenError,
  GithubPublicationApiError,
  GithubPublicationClient,
  PublicationFailure,
  PublicationPolicySchema,
  PublicationStatus,
  classifyPublicationFailure,
  digestGitTreeEntries,
  ensureDraftPullRequest,
  ensurePublicationBranch,
  materializePublicationCommit,
  verifyExistingPublicationCommit,
  verifyPublicationBundle,
  type GitTreeEntry,
  type PublicationExecutionBundle,
} from './index.js';

const sha1Hex = (value: string) => createHash('sha1').update(value).digest('hex');
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

const OWNER = 'octo';
const REPO = 'repo';
const BASE_BRANCH = 'main';
const HEAD_BRANCH = 'codeer/recovery/fix-v1';
const BASE_COMMIT_SHA = 'a'.repeat(40);
const TOKEN = 'ghs_test_installation_token_0000000001';

const BASE_FILES: Record<string, string> = {
  'src/app.ts': 'line one\nline two\nline three\n',
};

const UNIFIED_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 0000000..1111111 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 line one
-line two
+line two fixed
 line three
`;

const PATCH_DIGEST = sha256Hex(UNIFIED_DIFF);

const policy = PublicationPolicySchema.parse({
  version: 'v1',
  allowedBaseBranches: ['main'],
  recoveryBranchPrefix: 'codeer/recovery',
  requiredChecks: ['build', 'test'],
  requiredApprovals: 1,
  requireCodeOwnerApproval: false,
  maximumPublicationAttempts: 3,
  webhookReplayWindowSeconds: 600,
  postMergeVerificationRequired: true,
  retentionDays: 365,
});

function createBundle(overrides: {
  publication?: Partial<PublicationExecutionBundle['publication']>;
  recovery?: Partial<PublicationExecutionBundle['recovery']>;
  patch?: Partial<PublicationExecutionBundle['patch']>;
  approvals?: Partial<PublicationExecutionBundle['approvals']>;
  securityReview?: PublicationExecutionBundle['securityReview'];
  verification?: PublicationExecutionBundle['verification'];
  materialization?: PublicationExecutionBundle['materialization'];
  policyOverrides?: Partial<typeof policy>;
}): PublicationExecutionBundle {
  return {
    publication: {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '33333333-3333-4333-8333-333333333333',
      repositoryId: '44444444-4444-4444-8444-444444444444',
      status: PublicationStatus.PUBLICATION_REQUESTED,
      version: 1,
      attemptCount: 1,
      policyVersion: 'v1',
      baseBranch: BASE_BRANCH,
      headBranch: HEAD_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      approvedPatchVersion: 1,
      patchDigest: PATCH_DIGEST,
      expectedTreeDigest: 'c'.repeat(64),
      treeSha: null,
      commitSha: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      ...overrides.publication,
    },
    recovery: {
      id: '55555555-5555-4555-8555-555555555555',
      status: 'READY_TO_PUBLISH',
      currentPatchVersion: 1,
      baseCommitSha: BASE_COMMIT_SHA,
      ...overrides.recovery,
    },
    patch: {
      id: '66666666-6666-4666-8666-666666666666',
      version: 1,
      unifiedDiff: UNIFIED_DIFF,
      patchDigest: PATCH_DIGEST,
      ...overrides.patch,
    },
    pullRequestPackage: {
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
    },
    approvals: {
      approvedCount: 1,
      latestApprovedAt: '2026-07-20T00:00:00.000Z',
      ...overrides.approvals,
    },
    securityReview:
      overrides.securityReview === undefined ? { decision: 'ALLOW' } : overrides.securityReview,
    verification:
      overrides.verification === undefined ? { status: 'PASSED' } : overrides.verification,
    materialization: overrides.materialization === undefined ? null : overrides.materialization,
    policy: { ...policy, ...overrides.policyOverrides },
    installation: { installationId: '123456' },
    repository: { owner: OWNER, name: REPO, providerRepoId: '777' },
  };
}

interface FakeRequest {
  method: string;
  path: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

interface FakePullRequest {
  number: number;
  node_id: string;
  html_url: string;
  title: string;
  body: string;
  draft: boolean;
  state: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}

interface FakeGithubServer {
  baseUrl: string;
  fetch: typeof fetch;
  requests: FakeRequest[];
  refs: Map<string, string>;
  pulls: FakePullRequest[];
}

interface FakeTreeChange {
  path: string;
  mode?: string;
  type?: string;
  sha: string | null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function headersRecord(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key] = value;
    return result;
  }
  for (const [key, value] of Object.entries(headers)) result[key] = value;
  return result;
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'string') throw new Error('Expected JSON request body to be a string.');
  return JSON.parse(body) as unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${label} to be a string.`);
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  const items = value as unknown[];
  if (!items.every((item): item is string => typeof item === 'string'))
    throw new Error(`Expected ${label} to contain only strings.`);
  return items;
}

function asTreeChanges(value: unknown): FakeTreeChange[] {
  if (!Array.isArray(value)) throw new Error('Expected tree changes to be an array.');
  return (value as unknown[]).map((item): FakeTreeChange => {
    const record = asRecord(item, 'tree change');
    const sha = record.sha;
    if (sha !== null && typeof sha !== 'string')
      throw new Error('Expected tree change sha to be a string or null.');
    const mode = record.mode;
    const type = record.type;
    return {
      path: asString(record.path, 'tree change path'),
      ...(typeof mode === 'string' ? { mode } : {}),
      ...(typeof type === 'string' ? { type } : {}),
      sha,
    };
  });
}

function createFakeGithubServer(options?: {
  baseSha?: string;
  tamperTrees?: boolean;
  failOn?: { method: string; pathIncludes: string; status: number; body?: string };
  seedPullRequest?: Partial<FakePullRequest>;
}): FakeGithubServer {
  const baseUrl = 'https://api.github.test';
  const blobs = new Map<string, string>();
  const trees = new Map<string, GitTreeEntry[]>();
  const commits = new Map<
    string,
    { sha: string; treeSha: string; parents: string[]; message: string }
  >();
  const refs = new Map<string, string>();
  const pulls: FakePullRequest[] = [];
  const requests: FakeRequest[] = [];

  const blobSha = (content: string) => sha1Hex(`blob:${content}`);
  const treeSha = (entries: GitTreeEntry[]) =>
    sha1Hex(JSON.stringify([...entries].sort((a, b) => a.path.localeCompare(b.path))));
  const commitSha = (value: unknown) => sha1Hex(JSON.stringify(value));

  const baseEntries: GitTreeEntry[] = Object.entries(BASE_FILES).map(([path, content]) => {
    const sha = blobSha(content);
    blobs.set(sha, content);
    return { path, mode: '100644', type: 'blob', sha };
  });
  const baseTreeSha = treeSha(baseEntries);
  trees.set(baseTreeSha, baseEntries);
  commits.set(BASE_COMMIT_SHA, {
    sha: BASE_COMMIT_SHA,
    treeSha: baseTreeSha,
    parents: [],
    message: 'Base commit',
  });
  refs.set(BASE_BRANCH, options?.baseSha ?? BASE_COMMIT_SHA);

  if (options?.seedPullRequest) {
    pulls.push({
      number: 41,
      node_id: 'PR_41',
      html_url: `https://github.test/${OWNER}/${REPO}/pull/41`,
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
      draft: true,
      state: 'open',
      head: { ref: HEAD_BRANCH, sha: '0'.repeat(40) },
      base: { ref: BASE_BRANCH, sha: BASE_COMMIT_SHA },
      ...options.seedPullRequest,
    });
  }

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    const url = new URL(requestUrl(input));
    const method = init?.method ?? 'GET';
    const body = parseRequestBody(init?.body);
    const path = url.pathname.replace(`/repos/${OWNER}/${REPO}`, '');
    requests.push({
      method,
      path,
      url: url.toString(),
      body,
      headers: headersRecord(init?.headers),
    });

    if (
      options?.failOn &&
      method === options.failOn.method &&
      path.includes(options.failOn.pathIncludes)
    ) {
      return new Response(options.failOn.body ?? 'failure', { status: options.failOn.status });
    }

    if (method === 'GET' && path.startsWith('/git/ref/heads/')) {
      const branch = path.slice('/git/ref/heads/'.length);
      const sha = refs.get(branch);
      if (!sha) return new Response('Not Found', { status: 404 });
      return json({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const commit = commits.get(path.slice('/git/commits/'.length));
      if (!commit) return new Response('Not Found', { status: 404 });
      return json({
        sha: commit.sha,
        tree: { sha: commit.treeSha },
        parents: commit.parents.map((sha) => ({ sha })),
      });
    }
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      const entries = trees.get(path.slice('/git/trees/'.length));
      if (!entries) return new Response('Not Found', { status: 404 });
      return json({ sha: treeSha(entries), tree: entries, truncated: false });
    }
    if (method === 'GET' && path.startsWith('/git/blobs/')) {
      const content = blobs.get(path.slice('/git/blobs/'.length));
      if (content === undefined) return new Response('Not Found', { status: 404 });
      return json({ content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' });
    }
    if (method === 'POST' && path === '/git/blobs') {
      const blobBody = asRecord(body, 'create blob body');
      const content = asString(blobBody.content, 'blob content');
      const sha = blobSha(content);
      blobs.set(sha, content);
      return json({ sha }, 201);
    }
    if (method === 'POST' && path === '/git/trees') {
      const treeBody = asRecord(body, 'create tree body');
      const entries = [...(trees.get(asString(treeBody.base_tree, 'base tree sha')) ?? [])];
      for (const change of asTreeChanges(treeBody.tree)) {
        const index = entries.findIndex((entry) => entry.path === change.path);
        if (change.sha === null) {
          if (index >= 0) entries.splice(index, 1);
        } else if (index >= 0) {
          entries[index] = {
            path: change.path,
            mode: change.mode ?? '100644',
            type: change.type ?? 'blob',
            sha: change.sha,
          };
        } else {
          entries.push({
            path: change.path,
            mode: change.mode ?? '100644',
            type: change.type ?? 'blob',
            sha: change.sha,
          });
        }
      }
      if (options?.tamperTrees) {
        const sha = blobSha('tampered');
        blobs.set(sha, 'tampered');
        entries.push({ path: 'tampered.txt', mode: '100644', type: 'blob', sha });
      }
      const sha = treeSha(entries);
      trees.set(sha, entries);
      return json({ sha }, 201);
    }
    if (method === 'POST' && path === '/git/commits') {
      const commitBody = asRecord(body, 'create commit body');
      const message = asString(commitBody.message, 'commit message');
      const tree = asString(commitBody.tree, 'commit tree');
      const parents = asStringArray(commitBody.parents, 'commit parents');
      const author = asRecord(commitBody.author, 'commit author');
      const committer = asRecord(commitBody.committer, 'commit committer');
      const sha = commitSha({
        message,
        tree,
        parents,
        author,
        committer,
      });
      commits.set(sha, {
        sha,
        treeSha: tree,
        parents,
        message,
      });
      return json({ sha, tree: { sha: tree }, parents: parents.map((p) => ({ sha: p })) }, 201);
    }
    if (method === 'POST' && path === '/git/refs') {
      const refBody = asRecord(body, 'create ref body');
      const ref = asString(refBody.ref, 'ref');
      const sha = asString(refBody.sha, 'ref sha');
      const branch = ref.replace('refs/heads/', '');
      if (refs.has(branch)) return new Response('Reference already exists', { status: 422 });
      refs.set(branch, sha);
      return json({ ref, object: { sha, type: 'commit' } }, 201);
    }
    if (method === 'GET' && path === '/pulls') {
      const head = url.searchParams.get('head')?.split(':')[1];
      return json(pulls.filter((pull) => pull.state === 'open' && pull.head.ref === head));
    }
    if (method === 'POST' && path === '/pulls') {
      const pullBody = asRecord(body, 'create pull request body');
      const head = asString(pullBody.head, 'pull request head');
      if (pulls.some((pull) => pull.state === 'open' && pull.head.ref === head))
        return new Response('Validation Failed', { status: 422 });
      const base = asString(pullBody.base, 'pull request base');
      const number = 100 + pulls.length;
      const pull: FakePullRequest = {
        number,
        node_id: `PR_${number}`,
        html_url: `https://github.test/${OWNER}/${REPO}/pull/${number}`,
        title: asString(pullBody.title, 'pull request title'),
        body: asString(pullBody.body, 'pull request body'),
        draft: pullBody.draft === true,
        state: 'open',
        head: { ref: head, sha: refs.get(head) ?? '' },
        base: { ref: base, sha: refs.get(base) ?? '' },
      };
      pulls.push(pull);
      return json(pull, 201);
    }
    return new Response(`Unexpected request: ${method} ${path}`, { status: 500 });
  }) as typeof fetch;

  return { baseUrl, fetch: fetchImpl, requests, refs, pulls };
}

function clientFor(server: FakeGithubServer, token = TOKEN): GithubPublicationClient {
  return new GithubPublicationClient({
    baseUrl: server.baseUrl,
    owner: OWNER,
    repo: REPO,
    token,
    fetchImpl: server.fetch,
  });
}

describe('GitHub App installation token exchange', () => {
  it('requests a repository-scoped token with minimum permissions', async () => {
    type TokenRequestBody = { repository_ids?: number[]; permissions?: Record<string, string> };
    const seen: { body: TokenRequestBody | undefined } = { body: undefined };
    const client = new GithubAppClient('https://api.github.test', (_input, init) => {
      seen.body = parseRequestBody(init?.body) as TokenRequestBody;
      return Promise.resolve(
        new Response(JSON.stringify({ token: 'ghs_x', expires_at: '2026-07-20T01:00:00Z' }), {
          status: 201,
        }),
      );
    });
    const token = await client.createInstallationToken('jwt', '123456', [777]);
    expect(token.token).toBe('ghs_x');
    expect(seen.body?.repository_ids).toEqual([777]);
    expect(seen.body?.permissions).toEqual({
      contents: 'write',
      pull_requests: 'write',
      checks: 'read',
      metadata: 'read',
    });
  });

  it('rejects a failed token response with the status attached', async () => {
    const client = new GithubAppClient('https://api.github.test', () =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    );
    const error = await client
      .createInstallationToken('jwt', '123456', [777])
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(GithubAppTokenError);
    expect((error as GithubAppTokenError).status).toBe(401);
  });

  it('rejects an incomplete token response', async () => {
    const client = new GithubAppClient('https://api.github.test', () =>
      Promise.resolve(
        new Response(JSON.stringify({ expires_at: '2026-07-20T01:00:00Z' }), { status: 201 }),
      ),
    );
    await expect(client.createInstallationToken('jwt', '123456', [777])).rejects.toBeInstanceOf(
      GithubAppTokenError,
    );
  });
});

describe('verifyPublicationBundle', () => {
  function expectBundleFailure(
    bundle: PublicationExecutionBundle,
    expected: { failureStatus?: PublicationStatus; failureCode?: string },
  ): void {
    try {
      verifyPublicationBundle(bundle);
    } catch (error) {
      expect(error).toBeInstanceOf(PublicationFailure);
      const failure = error as PublicationFailure;
      if (expected.failureStatus) expect(failure.failureStatus).toBe(expected.failureStatus);
      if (expected.failureCode) expect(failure.failureCode).toBe(expected.failureCode);
      return;
    }
    throw new Error('Expected verifyPublicationBundle to reject the bundle.');
  }

  it('accepts a fully approved bundle', () => {
    expect(() => verifyPublicationBundle(createBundle({}))).not.toThrow();
  });

  it('blocks when the base branch is not allowed by policy', () => {
    expectBundleFailure(createBundle({ publication: { baseBranch: 'release' } }), {
      failureStatus: PublicationStatus.SECURITY_BLOCKED,
      failureCode: 'PUBLICATION_POLICY_BASE_BRANCH',
    });
  });

  it('enforces the configured head branch prefix', () => {
    expectBundleFailure(createBundle({ publication: { headBranch: 'feature/fix' } }), {
      failureStatus: PublicationStatus.SECURITY_BLOCKED,
      failureCode: 'PUBLICATION_POLICY_BRANCH_PREFIX',
    });
  });

  it('detects a stale base commit', () => {
    expectBundleFailure(createBundle({ recovery: { baseCommitSha: 'b'.repeat(40) } }), {
      failureStatus: PublicationStatus.BASE_BRANCH_STALE,
      failureCode: 'BASE_BRANCH_STALE',
    });
  });

  it('blocks when the patch digest does not match', () => {
    expectBundleFailure(createBundle({ publication: { patchDigest: 'd'.repeat(64) } }), {
      failureCode: 'PUBLICATION_PATCH_DIGEST_MISMATCH',
    });
  });

  it('requires a human publication approval', () => {
    expectBundleFailure(createBundle({ approvals: { approvedCount: 0, latestApprovedAt: null } }), {
      failureStatus: PublicationStatus.PUBLICATION_BLOCKED,
      failureCode: 'PUBLICATION_APPROVAL_MISSING',
    });
  });

  it('requires passed verification and an accepted security review', () => {
    expectBundleFailure(createBundle({ verification: { status: 'FAILED' } }), {
      failureStatus: PublicationStatus.PUBLICATION_BLOCKED,
      failureCode: 'PUBLICATION_VERIFICATION_INCOMPLETE',
    });
    expectBundleFailure(createBundle({ securityReview: { decision: 'BLOCK' } }), {
      failureStatus: PublicationStatus.SECURITY_BLOCKED,
      failureCode: 'SECURITY_REVIEW_REJECTED',
    });
  });
});

describe('materializePublicationCommit', () => {
  it('materializes the approved patch on the exact base tree and verifies digests', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const bundle = createBundle({});
    verifyPublicationBundle(bundle);
    const materialized = await materializePublicationCommit(bundle, client);

    expect(materialized.treeSha).toMatch(/^[a-f0-9]{40}$/);
    expect(materialized.commitSha).toMatch(/^[a-f0-9]{40}$/);

    const createdTree = await client.getTree(materialized.treeSha);
    expect(digestGitTreeEntries(createdTree)).toBe(materialized.treeDigest);
    const appEntry = createdTree.find((entry) => entry.path === 'src/app.ts');
    expect(appEntry).toBeDefined();
    const content = await client.getBlobContent(appEntry?.sha ?? '');
    expect(content).toBe('line one\nline two fixed\nline three\n');

    const createdCommit = await client.getCommit(materialized.commitSha);
    expect(createdCommit.treeSha).toBe(materialized.treeSha);
    expect(createdCommit.parents).toEqual([BASE_COMMIT_SHA]);
  });

  it('is deterministic so a retried attempt recreates the identical commit', async () => {
    const first = await materializePublicationCommit(
      createBundle({}),
      clientFor(createFakeGithubServer()),
    );
    const second = await materializePublicationCommit(
      createBundle({}),
      clientFor(createFakeGithubServer()),
    );
    expect(second.commitSha).toBe(first.commitSha);
    expect(second.treeSha).toBe(first.treeSha);
  });

  it('fails closed when the base branch moved after approval', async () => {
    const server = createFakeGithubServer({ baseSha: 'e'.repeat(40) });
    const error = await materializePublicationCommit(createBundle({}), clientFor(server)).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(PublicationFailure);
    expect((error as PublicationFailure).failureStatus).toBe(PublicationStatus.BASE_BRANCH_STALE);
  });

  it('rejects a materialized tree that does not match the approved patch', async () => {
    const server = createFakeGithubServer({ tamperTrees: true });
    const error = await materializePublicationCommit(createBundle({}), clientFor(server)).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(PublicationFailure);
    expect((error as PublicationFailure).failureCode).toBe('PUBLICATION_TREE_DIGEST_MISMATCH');
  });

  it('materializes newly added files without a base blob', async () => {
    const addDiff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+alpha
+beta
`;
    const bundle = createBundle({
      patch: { unifiedDiff: addDiff, patchDigest: sha256Hex(addDiff) },
    });
    const server = createFakeGithubServer();
    const materialized = await materializePublicationCommit(bundle, clientFor(server));
    const createdTree = await clientFor(server).getTree(materialized.treeSha);
    const added = createdTree.find((entry) => entry.path === 'src/new.ts');
    expect(added).toBeDefined();
    expect(await clientFor(server).getBlobContent(added?.sha ?? '')).toBe('alpha\nbeta\n');
  });
});

describe('verifyExistingPublicationCommit', () => {
  it('re-verifies a previously materialized commit on retry', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const bundle = createBundle({});
    const materialized = await materializePublicationCommit(bundle, client);
    const retried = createBundle({
      publication: { treeSha: materialized.treeSha, commitSha: materialized.commitSha },
      materialization: {
        treeDigest: materialized.treeDigest,
        messageDigest: materialized.messageDigest,
      },
    });
    await expect(verifyExistingPublicationCommit(retried, client)).resolves.toEqual({
      treeSha: materialized.treeSha,
      commitSha: materialized.commitSha,
    });
  });

  it('rejects a recorded commit that no longer matches the approved base', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const materialized = await materializePublicationCommit(createBundle({}), client);
    const retried = createBundle({
      publication: {
        treeSha: materialized.treeSha,
        commitSha: materialized.commitSha,
        baseCommitSha: 'f'.repeat(40),
      },
      materialization: {
        treeDigest: materialized.treeDigest,
        messageDigest: materialized.messageDigest,
      },
    });
    const error = await verifyExistingPublicationCommit(retried, client).catch(
      (failure: unknown) => failure,
    );
    expect((error as PublicationFailure).failureCode).toBe('PUBLICATION_COMMIT_MISMATCH');
  });
});

describe('ensurePublicationBranch', () => {
  it('creates the controlled branch ref with a create-only call', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const commit = await materializePublicationCommit(createBundle({}), client);
    const result = await ensurePublicationBranch(client, {
      headBranch: HEAD_BRANCH,
      commitSha: commit.commitSha,
    });
    expect(result).toEqual({ reused: false });
    expect(server.refs.get(HEAD_BRANCH)).toBe(commit.commitSha);
    const mutations = server.requests.filter((request) => request.path === '/git/refs');
    expect(mutations.map((request) => request.method)).toEqual(['POST']);
  });

  it('reuses an existing branch ref that already points at the expected commit', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const commit = await materializePublicationCommit(createBundle({}), client);
    server.refs.set(HEAD_BRANCH, commit.commitSha);
    const result = await ensurePublicationBranch(client, {
      headBranch: HEAD_BRANCH,
      commitSha: commit.commitSha,
    });
    expect(result).toEqual({ reused: true });
    expect(server.requests.some((request) => request.path === '/git/refs')).toBe(false);
  });

  it('never force-pushes: an existing branch at another commit fails without any update', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const commit = await materializePublicationCommit(createBundle({}), client);
    server.refs.set(HEAD_BRANCH, '9'.repeat(40));
    const error = await ensurePublicationBranch(client, {
      headBranch: HEAD_BRANCH,
      commitSha: commit.commitSha,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PublicationFailure);
    expect((error as PublicationFailure).failureStatus).toBe(PublicationStatus.PUSH_FAILED);
    expect(server.refs.get(HEAD_BRANCH)).toBe('9'.repeat(40));
    expect(
      server.requests.some((request) => ['PATCH', 'PUT', 'DELETE'].includes(request.method)),
    ).toBe(false);
    expect(server.requests.some((request) => request.path === '/git/refs')).toBe(false);
  });

  it('treats a create race that lands on the expected commit as reuse', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const commit = await materializePublicationCommit(createBundle({}), client);
    const wrappedFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && requestUrl(input).includes('/git/refs')) {
        server.refs.set(HEAD_BRANCH, commit.commitSha);
        return Promise.resolve(new Response('Reference already exists', { status: 422 }));
      }
      return server.fetch(input, init);
    };
    const raced = new GithubPublicationClient({
      baseUrl: server.baseUrl,
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetchImpl: wrappedFetch,
    });
    await expect(
      ensurePublicationBranch(raced, { headBranch: HEAD_BRANCH, commitSha: commit.commitSha }),
    ).resolves.toEqual({ reused: true });
  });
});

describe('ensureDraftPullRequest', () => {
  async function materializedOn(server: FakeGithubServer) {
    const client = clientFor(server);
    const commit = await materializePublicationCommit(createBundle({}), client);
    server.refs.set(HEAD_BRANCH, commit.commitSha);
    return commit;
  }

  it('creates a draft pull request with the approved title/body and exact base/head', async () => {
    const server = createFakeGithubServer();
    const commit = await materializedOn(server);
    const result = await ensureDraftPullRequest(clientFor(server), {
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: commit.commitSha,
    });
    expect(result.reused).toBe(false);
    expect(result.pullRequest.draft).toBe(true);
    expect(result.pullRequest.baseRef).toBe(BASE_BRANCH);
    expect(result.pullRequest.headRef).toBe(HEAD_BRANCH);
    expect(result.pullRequest.headSha).toBe(commit.commitSha);
    const createRequest = server.requests.find(
      (request) => request.method === 'POST' && request.path === '/pulls',
    );
    expect(createRequest?.body).toMatchObject({
      draft: true,
      base: BASE_BRANCH,
      head: HEAD_BRANCH,
    });
  });

  it('reuses the existing open pull request for the head branch', async () => {
    const server = createFakeGithubServer();
    const commit = await materializedOn(server);
    server.pulls.push({
      number: 41,
      node_id: 'PR_41',
      html_url: `https://github.test/${OWNER}/${REPO}/pull/41`,
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
      draft: true,
      state: 'open',
      head: { ref: HEAD_BRANCH, sha: commit.commitSha },
      base: { ref: BASE_BRANCH, sha: BASE_COMMIT_SHA },
    });
    const result = await ensureDraftPullRequest(clientFor(server), {
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: commit.commitSha,
    });
    expect(result.reused).toBe(true);
    expect(result.pullRequest.number).toBe(41);
    expect(
      server.requests.some((request) => request.method === 'POST' && request.path === '/pulls'),
    ).toBe(false);
  });

  it('maps a creation conflict to reuse when the concurrent pull request matches', async () => {
    const server = createFakeGithubServer();
    const commit = await materializedOn(server);
    const wrappedFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && requestUrl(input).includes('/pulls')) {
        server.pulls.push({
          number: 55,
          node_id: 'PR_55',
          html_url: `https://github.test/${OWNER}/${REPO}/pull/55`,
          title: 'Fix deterministic build failure',
          body: 'Approved package body with provenance.',
          draft: true,
          state: 'open',
          head: { ref: HEAD_BRANCH, sha: commit.commitSha },
          base: { ref: BASE_BRANCH, sha: BASE_COMMIT_SHA },
        });
        return Promise.resolve(new Response('Validation Failed', { status: 422 }));
      }
      return server.fetch(input, init);
    };
    const raced = new GithubPublicationClient({
      baseUrl: server.baseUrl,
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetchImpl: wrappedFetch,
    });
    const result = await ensureDraftPullRequest(raced, {
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: commit.commitSha,
    });
    expect(result).toMatchObject({ reused: true, pullRequest: { number: 55 } });
  });

  it('fails when the base branch moved before pull request creation', async () => {
    const server = createFakeGithubServer();
    const client = clientFor(server);
    const commit = await materializePublicationCommit(createBundle({}), client);
    server.refs.set(HEAD_BRANCH, commit.commitSha);
    server.refs.set(BASE_BRANCH, 'e'.repeat(40));
    const error = await ensureDraftPullRequest(client, {
      title: 'Fix deterministic build failure',
      body: 'Approved package body with provenance.',
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: commit.commitSha,
    }).catch((failure: unknown) => failure);
    expect((error as PublicationFailure).failureStatus).toBe(PublicationStatus.BASE_BRANCH_STALE);
  });
});

describe('idempotent retry across the full pipeline', () => {
  it('re-running materialization, branch and pull request creation duplicates nothing', async () => {
    const server = createFakeGithubServer();
    const bundle = createBundle({});
    const client = clientFor(server);

    const first = await materializePublicationCommit(bundle, client);
    const firstBranch = await ensurePublicationBranch(client, {
      headBranch: HEAD_BRANCH,
      commitSha: first.commitSha,
    });
    const firstPr = await ensureDraftPullRequest(client, {
      title: bundle.pullRequestPackage.title,
      body: bundle.pullRequestPackage.body,
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: first.commitSha,
    });

    const retriedBundle = createBundle({
      publication: { treeSha: first.treeSha, commitSha: first.commitSha },
      materialization: { treeDigest: first.treeDigest, messageDigest: first.messageDigest },
    });
    const second = await verifyExistingPublicationCommit(retriedBundle, client);
    const secondBranch = await ensurePublicationBranch(client, {
      headBranch: HEAD_BRANCH,
      commitSha: second.commitSha,
    });
    const secondPr = await ensureDraftPullRequest(client, {
      title: bundle.pullRequestPackage.title,
      body: bundle.pullRequestPackage.body,
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: second.commitSha,
    });

    expect(second.commitSha).toBe(first.commitSha);
    expect(firstBranch.reused).toBe(false);
    expect(secondBranch.reused).toBe(true);
    expect(firstPr.reused).toBe(false);
    expect(secondPr.reused).toBe(true);
    expect(secondPr.pullRequest.number).toBe(firstPr.pullRequest.number);
    expect(server.pulls).toHaveLength(1);
  });
});

describe('classifyPublicationFailure', () => {
  const stageCases = [
    [PublicationStatus.POLICY_CHECK, PublicationStatus.PUBLICATION_BLOCKED],
    [PublicationStatus.COMMIT_MATERIALIZING, PublicationStatus.PUBLICATION_BLOCKED],
    [PublicationStatus.BRANCH_PUBLISHING, PublicationStatus.PUSH_FAILED],
    [PublicationStatus.DRAFT_PR_CREATING, PublicationStatus.PR_CREATION_FAILED],
  ] as const;

  it.each(stageCases)('maps stage %s failures to %s', (stage, expected) => {
    const failure = classifyPublicationFailure(new Error('network unreachable'), stage);
    expect(failure.status).toBe(expected);
    expect(failure.code).toBe('PUBLICATION_EXECUTION_FAILED');
  });

  it.each([401, 403])('maps HTTP %s to PUBLICATION_BLOCKED', (status) => {
    for (const [stage] of stageCases) {
      const failure = classifyPublicationFailure(
        new GithubPublicationApiError(status, 'forbidden'),
        stage,
      );
      expect(failure.status).toBe(PublicationStatus.PUBLICATION_BLOCKED);
      expect(failure.code).toBe('PUBLICATION_FORBIDDEN');
    }
  });

  it('maps HTTP 409 to the stage failure status with a conflict code', () => {
    const failure = classifyPublicationFailure(
      new GithubPublicationApiError(409, 'conflict'),
      PublicationStatus.BRANCH_PUBLISHING,
    );
    expect(failure).toMatchObject({
      status: PublicationStatus.PUSH_FAILED,
      code: 'PUBLICATION_CONFLICT',
    });
  });

  it('maps HTTP 422 to the stage failure status with a validation code', () => {
    const failure = classifyPublicationFailure(
      new GithubPublicationApiError(422, 'validation failed'),
      PublicationStatus.DRAFT_PR_CREATING,
    );
    expect(failure).toMatchObject({
      status: PublicationStatus.PR_CREATION_FAILED,
      code: 'PUBLICATION_VALIDATION_FAILED',
    });
  });

  it('maps HTTP 500 to the stage failure status with an availability code', () => {
    const failure = classifyPublicationFailure(
      new GithubPublicationApiError(500, 'internal error'),
      PublicationStatus.DRAFT_PR_CREATING,
    );
    expect(failure).toMatchObject({
      status: PublicationStatus.PR_CREATION_FAILED,
      code: 'PUBLICATION_GITHUB_UNAVAILABLE',
    });
  });

  it('passes through deliberate publication failures', () => {
    const failure = classifyPublicationFailure(
      new PublicationFailure(PublicationStatus.SECURITY_BLOCKED, 'SECURITY_REVIEW_REJECTED', 'no'),
      PublicationStatus.POLICY_CHECK,
    );
    expect(failure).toMatchObject({
      status: PublicationStatus.SECURITY_BLOCKED,
      code: 'SECURITY_REVIEW_REJECTED',
    });
  });

  it('maps cancellations to CANCELLED', () => {
    const failure = classifyPublicationFailure(
      new Error('Publication cancellation was requested.'),
      PublicationStatus.COMMIT_MATERIALIZING,
    );
    expect(failure.status).toBe(PublicationStatus.CANCELLED);
  });
});

describe('installation token hygiene', () => {
  it('sends the token only in Authorization headers, never in URLs or bodies', async () => {
    const server = createFakeGithubServer();
    const bundle = createBundle({});
    const client = clientFor(server, TOKEN);
    const materialized = await materializePublicationCommit(bundle, client);
    await ensurePublicationBranch(client, {
      headBranch: HEAD_BRANCH,
      commitSha: materialized.commitSha,
    });
    await ensureDraftPullRequest(client, {
      title: bundle.pullRequestPackage.title,
      body: bundle.pullRequestPackage.body,
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      baseCommitSha: BASE_COMMIT_SHA,
      commitSha: materialized.commitSha,
    });
    expect(server.requests.length).toBeGreaterThan(5);
    for (const request of server.requests) {
      expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(request.url).not.toContain(TOKEN);
      expect(JSON.stringify(request.body ?? {})).not.toContain(TOKEN);
    }
  });

  it('redacts the token from API error messages', async () => {
    const server = createFakeGithubServer({
      failOn: {
        method: 'GET',
        pathIncludes: '/git/ref/',
        status: 500,
        body: `internal error echoing ${TOKEN}`,
      },
    });
    const client = clientFor(server, TOKEN);
    const error = await materializePublicationCommit(createBundle({}), client).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(GithubPublicationApiError);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).toContain('[redacted]');
  });
});
