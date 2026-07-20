import { createHash } from 'node:crypto';
import { canonicalJson } from '@codeer/incidents';
import { PublicationStatus, type PublicationPolicy } from './types.js';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const SHA40 = /^[a-f0-9]{40}$/i;

export class PublicationFailure extends Error {
  constructor(
    readonly failureStatus: PublicationStatus,
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PublicationFailure';
  }
}

export class GithubPublicationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GithubPublicationApiError';
  }
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export interface PublicationExecutionBundle {
  publication: {
    id: string;
    organizationId: string;
    repositoryId: string;
    status: PublicationStatus;
    version: number;
    attemptCount: number;
    policyVersion: string;
    baseBranch: string;
    headBranch: string;
    baseCommitSha: string;
    approvedPatchVersion: number;
    patchDigest: string;
    expectedTreeDigest: string;
    treeSha: string | null;
    commitSha: string | null;
    pullRequestNumber: number | null;
    pullRequestUrl: string | null;
  };
  recovery: {
    id: string;
    status: string;
    currentPatchVersion: number | null;
    baseCommitSha: string;
  };
  patch: {
    id: string;
    version: number;
    unifiedDiff: string;
    patchDigest: string;
  };
  pullRequestPackage: {
    title: string;
    body: string;
  };
  approvals: {
    approvedCount: number;
    latestApprovedAt: string | null;
  };
  securityReview: {
    decision: string;
  } | null;
  verification: {
    status: string;
  } | null;
  materialization: {
    treeDigest: string;
    messageDigest: string;
  } | null;
  policy: PublicationPolicy;
  installation: {
    installationId: string;
  };
  repository: {
    owner: string;
    name: string;
    providerRepoId: string;
  };
}

export interface MaterializedPublicationCommit {
  treeSha: string;
  commitSha: string;
  treeDigest: string;
  messageDigest: string;
}

export interface PublicationPullRequest {
  number: number;
  nodeId: string;
  url: string;
  title: string;
  body: string;
  draft: boolean;
  state: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
}

function failure(
  status: PublicationStatus,
  code: string,
  message: string,
): PublicationFailure {
  return new PublicationFailure(status, code, message);
}

/**
 * Re-verifies every invariant the API checked when the publication was
 * requested, this time against the persisted execution bundle. Nothing from
 * the original request is trusted at execution time.
 */
export function verifyPublicationBundle(bundle: PublicationExecutionBundle): void {
  const { publication, recovery, patch, approvals, securityReview, verification, policy } = bundle;
  if (recovery.status !== 'READY_TO_PUBLISH')
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_RECOVERY_NOT_PUBLISHABLE',
      `Recovery is ${recovery.status}, not READY_TO_PUBLISH.`,
    );
  if (
    recovery.currentPatchVersion !== publication.approvedPatchVersion ||
    patch.version !== publication.approvedPatchVersion
  )
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_PATCH_VERSION_STALE',
      'The approved patch version no longer matches the recovery.',
    );
  if (recovery.baseCommitSha !== publication.baseCommitSha)
    throw failure(
      PublicationStatus.BASE_BRANCH_STALE,
      'BASE_BRANCH_STALE',
      'The recovery base commit no longer matches the approved publication base.',
    );
  const actualPatchDigest = sha256Hex(patch.unifiedDiff.replace(/\r\n/g, '\n'));
  if (actualPatchDigest !== patch.patchDigest || patch.patchDigest !== publication.patchDigest)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_PATCH_DIGEST_MISMATCH',
      'The persisted patch does not match the approved patch digest.',
    );
  if (!policy.allowedBaseBranches.includes(publication.baseBranch))
    throw failure(
      PublicationStatus.SECURITY_BLOCKED,
      'PUBLICATION_POLICY_BASE_BRANCH',
      `Base branch ${publication.baseBranch} is not permitted by the repository publication policy.`,
    );
  if (!publication.headBranch.startsWith(policy.recoveryBranchPrefix))
    throw failure(
      PublicationStatus.SECURITY_BLOCKED,
      'PUBLICATION_POLICY_BRANCH_PREFIX',
      'The publication head branch does not use the configured recovery branch prefix.',
    );
  if (publication.headBranch === publication.baseBranch)
    throw failure(
      PublicationStatus.SECURITY_BLOCKED,
      'PUBLICATION_POLICY_PROTECTED_BRANCH',
      'The publication head branch cannot equal the protected base branch.',
    );
  if (policy.allowForcePush !== false || policy.allowProtectedBranchWrites !== false)
    throw failure(
      PublicationStatus.SECURITY_BLOCKED,
      'PUBLICATION_POLICY_UNSAFE_WRITE',
      'The repository publication policy permits unsafe writes.',
    );
  if (publication.attemptCount > policy.maximumPublicationAttempts)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_ATTEMPTS_EXCEEDED',
      'The maximum number of publication attempts has been exceeded.',
    );
  if (approvals.approvedCount < 1 || !approvals.latestApprovedAt)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_APPROVAL_MISSING',
      'A human publication approval is required before execution.',
    );
  if (verification?.status !== 'PASSED')
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_VERIFICATION_INCOMPLETE',
      'Independent recovery verification has not passed for the approved patch.',
    );
  if (securityReview?.decision !== 'ALLOW')
    throw failure(
      PublicationStatus.SECURITY_BLOCKED,
      'SECURITY_REVIEW_REJECTED',
      'The security review has not accepted the approved patch.',
    );
}

export interface ParsedFilePatch {
  oldPath: string | null;
  newPath: string | null;
  changeType: 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME';
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

function normalizePatchPath(value: string): string {
  const candidate = value.replace(/^"|"$/g, '').replace(/\\/g, '/');
  if (!candidate || candidate === '/dev/null') return candidate;
  if (candidate.includes('\u0000') || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate))
    throw new Error('Patch contains an absolute or invalid path.');
  const segments = candidate.split('/');
  if (segments.includes('..') || segments[0] === '.git')
    throw new Error('Patch path traversal is not allowed.');
  return segments.filter((segment, index) => segment !== '.' || index !== 0).join('/');
}

/** Parses a unified diff into per-file hunks suitable for Git Data API materialization. */
export function parseUnifiedDiffFiles(unifiedDiff: string): ParsedFilePatch[] {
  if (!unifiedDiff.trim()) throw new Error('Patch must not be empty.');
  if (unifiedDiff.includes('GIT binary patch') || unifiedDiff.includes('Binary files '))
    throw new Error('Binary patches are not allowed.');
  if (unifiedDiff.includes('\u0000')) throw new Error('Patch contains binary data.');
  const lines = unifiedDiff.replace(/\r\n/g, '\n').split('\n');
  const files: ParsedFilePatch[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = lines[index] ?? '';
    if (!header) {
      index += 1;
      continue;
    }
    const match = DIFF_HEADER.exec(header);
    if (!match)
      throw new Error(`Unexpected patch line outside file section: ${header.slice(0, 120)}`);
    let oldPath: string | null = normalizePatchPath(match[1] ?? '');
    let newPath: string | null = normalizePatchPath(match[2] ?? '');
    let newFile = false;
    let deletedFile = false;
    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    index += 1;
    while (
      index < lines.length &&
      !(lines[index] ?? '').startsWith('@@ ') &&
      !(lines[index] ?? '').startsWith('diff --git ')
    ) {
      const line = lines[index] ?? '';
      if (line.startsWith('new file mode ')) newFile = true;
      if (line.startsWith('deleted file mode ')) deletedFile = true;
      if (line.startsWith('rename from ')) renameFrom = normalizePatchPath(line.slice(12));
      if (line.startsWith('rename to ')) renameTo = normalizePatchPath(line.slice(10));
      if (line.startsWith('--- ')) {
        const value = line.slice(4).replace(/^a\//, '');
        oldPath = value === '/dev/null' ? null : normalizePatchPath(value);
      }
      if (line.startsWith('+++ ')) {
        const value = line.slice(4).replace(/^b\//, '');
        newPath = value === '/dev/null' ? null : normalizePatchPath(value);
      }
      index += 1;
    }
    if (renameFrom) oldPath = renameFrom;
    if (renameTo) newPath = renameTo;
    if (newFile) oldPath = null;
    if (deletedFile) newPath = null;
    const effectivePath = newPath ?? oldPath;
    if (!effectivePath) throw new Error('Patch file section has no usable path.');
    const hunks: ParsedFilePatch['hunks'] = [];
    while (index < lines.length && !(lines[index] ?? '').startsWith('diff --git ')) {
      const hunkHeader = lines[index] ?? '';
      if (!hunkHeader) {
        index += 1;
        continue;
      }
      const hunkMatch = HUNK_HEADER.exec(hunkHeader);
      if (!hunkMatch) throw new Error(`Malformed hunk header: ${hunkHeader.slice(0, 200)}`);
      const oldStart = Number(hunkMatch[1]);
      const oldLines = Number(hunkMatch[2] ?? 1);
      const newStart = Number(hunkMatch[3]);
      const newLines = Number(hunkMatch[4] ?? 1);
      index += 1;
      const hunkLines: string[] = [];
      let observedOld = 0;
      let observedNew = 0;
      while (
        index < lines.length &&
        !(lines[index] ?? '').startsWith('@@ ') &&
        !(lines[index] ?? '').startsWith('diff --git ')
      ) {
        const line = lines[index] ?? '';
        if (line === '' && index === lines.length - 1) {
          index += 1;
          break;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) observedNew += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) observedOld += 1;
        else if (line.startsWith(' ')) {
          observedOld += 1;
          observedNew += 1;
        } else if (line !== '\\ No newline at end of file') {
          throw new Error(`Invalid hunk content line: ${line.slice(0, 120)}`);
        }
        hunkLines.push(line);
        index += 1;
      }
      if (observedOld !== oldLines || observedNew !== newLines)
        throw new Error(`Hunk line counts do not match header for ${effectivePath}.`);
      hunks.push({ oldStart, oldLines, newStart, newLines, lines: hunkLines });
    }
    if (hunks.length === 0 && !renameFrom)
      throw new Error(`Patch file has no hunks: ${effectivePath}`);
    const changeType =
      oldPath === null ? 'ADD' : newPath === null ? 'DELETE' : renameFrom ? 'RENAME' : 'MODIFY';
    files.push({ oldPath, newPath, changeType, hunks });
  }
  if (files.length === 0) throw new Error('Patch contains no file changes.');
  return files;
}

/** Applies parsed hunks to base file content with strict context validation. */
export function applyFileHunks(baseContent: string, file: ParsedFilePatch, path: string): string {
  const baseLines = baseContent === '' ? [] : baseContent.split('\n');
  let endsWithNewline = false;
  if (baseLines.length > 0 && baseLines[baseLines.length - 1] === '') {
    baseLines.pop();
    endsWithNewline = true;
  }
  // A newly added file defaults to a trailing newline unless the diff says
  // otherwise; a modified file inherits the base file's terminator.
  let newEndsWithNewline = baseContent === '' ? true : endsWithNewline;
  const output: string[] = [];
  let oldIndex = 0;
  for (const hunk of file.hunks) {
    const startIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (startIndex < oldIndex)
      throw new Error(`Patch hunks overlap or are out of order for ${path}.`);
    output.push(...baseLines.slice(oldIndex, startIndex));
    oldIndex = startIndex;
    let previousKind = '';
    for (const line of hunk.lines) {
      if (line === '\\ No newline at end of file') {
        if (previousKind === '+' || previousKind === ' ') newEndsWithNewline = false;
        if (previousKind === '-') newEndsWithNewline = true;
        continue;
      }
      const kind = line[0] ?? '';
      const text = line.slice(1);
      if (kind === ' ') {
        if (oldIndex >= baseLines.length || baseLines[oldIndex] !== text)
          throw new Error(`Patch context does not match base content for ${path}.`);
        output.push(text);
        oldIndex += 1;
      } else if (kind === '-') {
        if (oldIndex >= baseLines.length || baseLines[oldIndex] !== text)
          throw new Error(`Patch removal does not match base content for ${path}.`);
        oldIndex += 1;
      } else if (kind === '+') {
        output.push(text);
      } else {
        throw new Error(`Invalid hunk line for ${path}.`);
      }
      previousKind = kind;
    }
  }
  output.push(...baseLines.slice(oldIndex));
  const joined = output.join('\n');
  return newEndsWithNewline && output.length > 0 ? `${joined}\n` : joined;
}

/** Deterministic digest over the blob entries of a Git tree, used for integrity verification. */
export function digestGitTreeEntries(entries: GitTreeEntry[]): string {
  const blobs = entries
    .filter((entry) => entry.type === 'blob')
    .map((entry) => ({ mode: entry.mode, path: entry.path, sha: entry.sha.toLowerCase() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256Hex(canonicalJson(blobs));
}

interface GithubRequestOptions {
  method: string;
  path: string;
  body?: unknown;
  allowNotFound?: boolean;
}

/**
 * Minimal GitHub REST client for controlled publication. The installation
 * token is held only in this short-lived instance, is sent exclusively in the
 * Authorization header, is redacted from every error, and is never logged or
 * persisted.
 */
export class GithubPublicationClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      baseUrl: string;
      owner: string;
      repo: string;
      token: string;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(request: GithubRequestOptions): Promise<T | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/repos/${encodeURIComponent(this.options.owner)}/${encodeURIComponent(this.options.repo)}${request.path}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      },
    );
    if (response.status === 404 && request.allowNotFound) return null;
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const message = `GitHub ${request.method} ${request.path} failed with status ${response.status}: ${detail.slice(0, 500)}`;
      throw new GithubPublicationApiError(
        response.status,
        message.split(this.options.token).join('[redacted]'),
      );
    }
    return (await response.json()) as T;
  }

  async getRef(branch: string): Promise<{ sha: string } | null> {
    const data = await this.request<{ object?: { sha?: string } }>({
      method: 'GET',
      path: `/git/ref/heads/${branch}`,
      allowNotFound: true,
    });
    const sha = data?.object?.sha;
    if (!sha) return null;
    if (!SHA40.test(sha))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed ref SHA.',
      );
    return { sha: sha.toLowerCase() };
  }

  async getCommit(sha: string): Promise<{ sha: string; treeSha: string; parents: string[] }> {
    const data = await this.request<{
      sha?: string;
      tree?: { sha?: string };
      parents?: Array<{ sha?: string }>;
    }>({ method: 'GET', path: `/git/commits/${sha}` });
    const treeSha = data?.tree?.sha;
    const parents = (data?.parents ?? []).map((parent) => parent.sha ?? '');
    if (!data?.sha || !treeSha || !SHA40.test(data.sha) || !SHA40.test(treeSha))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed commit object.',
      );
    return {
      sha: data.sha.toLowerCase(),
      treeSha: treeSha.toLowerCase(),
      parents: parents.map((parent) => parent.toLowerCase()),
    };
  }

  async getTree(sha: string): Promise<GitTreeEntry[]> {
    const data = await this.request<{
      tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
      truncated?: boolean;
    }>({ method: 'GET', path: `/git/trees/${sha}?recursive=1` });
    if (!data || !Array.isArray(data.tree))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed tree object.',
      );
    if (data.truncated)
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_TREE_TRUNCATED',
        'GitHub truncated the repository tree; publication integrity cannot be verified.',
      );
    return data.tree.map((entry) => ({
      path: entry.path ?? '',
      mode: entry.mode ?? '',
      type: entry.type ?? '',
      sha: (entry.sha ?? '').toLowerCase(),
    }));
  }

  async getBlobContent(sha: string): Promise<string> {
    const data = await this.request<{ content?: string; encoding?: string }>({
      method: 'GET',
      path: `/git/blobs/${sha}`,
    });
    if (!data || data.encoding !== 'base64' || typeof data.content !== 'string')
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed blob object.',
      );
    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  async createBlob(content: string): Promise<string> {
    const data = await this.request<{ sha?: string }>({
      method: 'POST',
      path: '/git/blobs',
      body: { content, encoding: 'utf-8' },
    });
    if (!data?.sha || !SHA40.test(data.sha))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed blob SHA.',
      );
    return data.sha.toLowerCase();
  }

  async createTree(
    baseTreeSha: string,
    entries: Array<{ path: string; mode?: string; type?: string; sha: string | null }>,
  ): Promise<string> {
    const data = await this.request<{ sha?: string }>({
      method: 'POST',
      path: '/git/trees',
      body: { base_tree: baseTreeSha, tree: entries },
    });
    if (!data?.sha || !SHA40.test(data.sha))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed tree SHA.',
      );
    return data.sha.toLowerCase();
  }

  async createCommit(input: {
    message: string;
    treeSha: string;
    parentSha: string;
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
  }): Promise<string> {
    const data = await this.request<{ sha?: string }>({
      method: 'POST',
      path: '/git/commits',
      body: {
        message: input.message,
        tree: input.treeSha,
        parents: [input.parentSha],
        author: input.author,
        committer: input.committer,
      },
    });
    if (!data?.sha || !SHA40.test(data.sha))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_INTEGRITY_FAILED',
        'GitHub returned a malformed commit SHA.',
      );
    return data.sha.toLowerCase();
  }

  async createRef(branch: string, sha: string): Promise<void> {
    await this.request({
      method: 'POST',
      path: '/git/refs',
      body: { ref: `refs/heads/${branch}`, sha },
    });
  }

  async findOpenPullRequest(headBranch: string): Promise<PublicationPullRequest | null> {
    const data = await this.request<
      Array<{
        number?: number;
        node_id?: string;
        html_url?: string;
        title?: string;
        body?: string | null;
        draft?: boolean;
        state?: string;
        head?: { ref?: string; sha?: string };
        base?: { ref?: string; sha?: string };
      }>
    >({
      method: 'GET',
      path: `/pulls?state=open&head=${encodeURIComponent(`${this.options.owner}:${headBranch}`)}&per_page=10`,
    });
    const candidate = data?.[0];
    if (!candidate || typeof candidate.number !== 'number') return null;
    return {
      number: candidate.number,
      nodeId: candidate.node_id ?? '',
      url: candidate.html_url ?? '',
      title: candidate.title ?? '',
      body: candidate.body ?? '',
      draft: candidate.draft === true,
      state: candidate.state ?? 'open',
      headRef: candidate.head?.ref ?? '',
      headSha: (candidate.head?.sha ?? '').toLowerCase(),
      baseRef: candidate.base?.ref ?? '',
      baseSha: (candidate.base?.sha ?? '').toLowerCase(),
    };
  }

  async createPullRequest(input: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<PublicationPullRequest> {
    const data = await this.request<{
      number?: number;
      node_id?: string;
      html_url?: string;
      title?: string;
      body?: string | null;
      draft?: boolean;
      state?: string;
      head?: { ref?: string; sha?: string };
      base?: { ref?: string; sha?: string };
    }>({
      method: 'POST',
      path: '/pulls',
      body: {
        title: input.title,
        body: input.body,
        head: input.headBranch,
        base: input.baseBranch,
        draft: true,
      },
    });
    if (!data || typeof data.number !== 'number' || data.draft !== true)
      throw failure(
        PublicationStatus.PR_CREATION_FAILED,
        'PUBLICATION_PR_INVALID',
        'GitHub did not return a valid draft pull request.',
      );
    return {
      number: data.number,
      nodeId: data.node_id ?? '',
      url: data.html_url ?? '',
      title: data.title ?? input.title,
      body: data.body ?? input.body,
      draft: true,
      state: data.state ?? 'open',
      headRef: data.head?.ref ?? input.headBranch,
      headSha: (data.head?.sha ?? '').toLowerCase(),
      baseRef: data.base?.ref ?? input.baseBranch,
      baseSha: (data.base?.sha ?? '').toLowerCase(),
    };
  }
}

function buildCommitMessage(bundle: PublicationExecutionBundle): string {
  return [
    bundle.pullRequestPackage.title,
    '',
    `CodeER-Publication: ${bundle.publication.id}`,
    `CodeER-Recovery: ${bundle.recovery.id}`,
    `CodeER-Patch-Version: ${bundle.publication.approvedPatchVersion}`,
    `CodeER-Patch-Digest: ${bundle.publication.patchDigest}`,
  ].join('\n');
}

/**
 * Materializes the approved patch as a real Git commit through the GitHub Git
 * Data API on the exact approved base tree, then verifies the returned tree
 * and commit against locally recomputed digests. No local git push is used.
 */
export async function materializePublicationCommit(
  bundle: PublicationExecutionBundle,
  client: GithubPublicationClient,
): Promise<MaterializedPublicationCommit> {
  const { publication } = bundle;
  const baseRef = await client.getRef(publication.baseBranch);
  if (!baseRef)
    throw failure(
      PublicationStatus.BASE_BRANCH_STALE,
      'BASE_BRANCH_STALE',
      `Base branch ${publication.baseBranch} was not found on the remote.`,
    );
  if (baseRef.sha !== publication.baseCommitSha)
    throw failure(
      PublicationStatus.BASE_BRANCH_STALE,
      'BASE_BRANCH_STALE',
      'The base branch moved after the recovery package was approved.',
    );
  const baseCommit = await client.getCommit(publication.baseCommitSha);
  const baseTree = await client.getTree(baseCommit.treeSha);

  let files: ParsedFilePatch[];
  try {
    files = parseUnifiedDiffFiles(bundle.patch.unifiedDiff);
  } catch (error) {
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_PATCH_INVALID',
      error instanceof Error ? error.message : 'The approved patch could not be parsed.',
    );
  }

  const baseBlobs = new Map(
    baseTree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry]),
  );
  const expectedBlobs = new Map(baseBlobs);
  const treeInput: Array<{ path: string; mode?: string; type?: string; sha: string | null }> = [];
  for (const file of files) {
    const targetPath = file.newPath ?? file.oldPath ?? '';
    if (file.changeType === 'DELETE') {
      if (!file.oldPath || !baseBlobs.has(file.oldPath))
        throw failure(
          PublicationStatus.PUBLICATION_BLOCKED,
          'PUBLICATION_PATCH_INVALID',
          `Patch deletes a file that is absent from the base tree: ${file.oldPath}.`,
        );
      expectedBlobs.delete(file.oldPath);
      treeInput.push({ path: file.oldPath, sha: null });
      continue;
    }
    if (file.changeType === 'ADD' && baseBlobs.has(targetPath))
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_PATCH_INVALID',
        `Patch adds a file that already exists in the base tree: ${targetPath}.`,
      );
    const baseEntry = file.oldPath ? baseBlobs.get(file.oldPath) : undefined;
    if ((file.changeType === 'MODIFY' || file.changeType === 'RENAME') && !baseEntry)
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_PATCH_INVALID',
        `Patch modifies a file that is absent from the base tree: ${file.oldPath}.`,
      );
    const baseContent = baseEntry ? await client.getBlobContent(baseEntry.sha) : '';
    let newContent: string;
    try {
      newContent = applyFileHunks(baseContent, file, targetPath);
    } catch (error) {
      throw failure(
        PublicationStatus.PUBLICATION_BLOCKED,
        'PUBLICATION_PATCH_INVALID',
        error instanceof Error ? error.message : 'The approved patch could not be applied.',
      );
    }
    const blobSha = await client.createBlob(newContent);
    const mode = baseEntry?.mode ?? '100644';
    expectedBlobs.set(targetPath, { path: targetPath, mode, type: 'blob', sha: blobSha });
    treeInput.push({ path: targetPath, mode, type: 'blob', sha: blobSha });
    if (file.changeType === 'RENAME' && file.oldPath) {
      expectedBlobs.delete(file.oldPath);
      treeInput.push({ path: file.oldPath, sha: null });
    }
  }

  const treeSha = await client.createTree(baseCommit.treeSha, treeInput);
  const createdTree = await client.getTree(treeSha);
  const expectedDigest = digestGitTreeEntries([...expectedBlobs.values()]);
  const createdDigest = digestGitTreeEntries(createdTree);
  if (expectedDigest !== createdDigest)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_TREE_DIGEST_MISMATCH',
      'The materialized tree does not match the approved patch contents.',
    );

  const message = buildCommitMessage(bundle);
  const identity = {
    name: 'CodeER Recovery',
    email: 'codeer-recovery@users.noreply.github.com',
    date: bundle.approvals.latestApprovedAt ?? new Date(0).toISOString(),
  };
  const commitSha = await client.createCommit({
    message,
    treeSha,
    parentSha: publication.baseCommitSha,
    author: identity,
    committer: identity,
  });
  const createdCommit = await client.getCommit(commitSha);
  if (createdCommit.treeSha !== treeSha || createdCommit.parents[0] !== publication.baseCommitSha)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_COMMIT_MISMATCH',
      'The materialized commit does not reference the expected tree and base parent.',
    );
  return { treeSha, commitSha, treeDigest: createdDigest, messageDigest: sha256Hex(message) };
}

/**
 * Re-verifies an already materialized commit on retry instead of duplicating
 * it. The tree digest recorded with the immutable PublishedCommit row is the
 * reference computed when the commit was first created and verified.
 */
export async function verifyExistingPublicationCommit(
  bundle: PublicationExecutionBundle,
  client: GithubPublicationClient,
): Promise<{ treeSha: string; commitSha: string }> {
  const { publication, materialization } = bundle;
  if (!publication.commitSha || !publication.treeSha || !materialization)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_COMMIT_MISSING',
      'The publication has no recorded materialized commit.',
    );
  const commit = await client.getCommit(publication.commitSha);
  if (commit.treeSha !== publication.treeSha || commit.parents[0] !== publication.baseCommitSha)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_COMMIT_MISMATCH',
      'The recorded commit no longer references the expected tree and base parent.',
    );
  const tree = await client.getTree(commit.treeSha);
  if (digestGitTreeEntries(tree) !== materialization.treeDigest)
    throw failure(
      PublicationStatus.PUBLICATION_BLOCKED,
      'PUBLICATION_TREE_DIGEST_MISMATCH',
      'The recorded tree no longer matches the approved patch contents.',
    );
  return { treeSha: publication.treeSha, commitSha: publication.commitSha };
}

/**
 * Creates the controlled branch ref without any force push. An existing ref
 * at the expected commit is reused; an existing ref anywhere else fails.
 */
export async function ensurePublicationBranch(
  client: GithubPublicationClient,
  input: { headBranch: string; commitSha: string },
): Promise<{ reused: boolean }> {
  const existing = await client.getRef(input.headBranch);
  if (existing) {
    if (existing.sha === input.commitSha) return { reused: true };
    throw failure(
      PublicationStatus.PUSH_FAILED,
      'PUBLICATION_BRANCH_MISMATCH',
      'The publication branch already exists at an unexpected commit.',
    );
  }
  try {
    await client.createRef(input.headBranch, input.commitSha);
    return { reused: false };
  } catch (error) {
    if (error instanceof GithubPublicationApiError && error.status === 422) {
      const raced = await client.getRef(input.headBranch);
      if (raced?.sha === input.commitSha) return { reused: true };
      throw failure(
        PublicationStatus.PUSH_FAILED,
        'PUBLICATION_BRANCH_EXISTS',
        'The publication branch was created concurrently at an unexpected commit.',
      );
    }
    throw error;
  }
}

/**
 * Creates the draft pull request with the approved title/body on the exact
 * approved base/head, or reuses the existing one when it matches.
 */
export async function ensureDraftPullRequest(
  client: GithubPublicationClient,
  input: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    baseCommitSha: string;
    commitSha: string;
  },
): Promise<{ pullRequest: PublicationPullRequest; reused: boolean }> {
  const baseRef = await client.getRef(input.baseBranch);
  if (!baseRef || baseRef.sha !== input.baseCommitSha)
    throw failure(
      PublicationStatus.BASE_BRANCH_STALE,
      'BASE_BRANCH_STALE',
      'The base branch moved before the draft pull request could be created.',
    );
  const matches = (pullRequest: PublicationPullRequest | null): pullRequest is PublicationPullRequest =>
    Boolean(
      pullRequest &&
        pullRequest.headRef === input.headBranch &&
        pullRequest.baseRef === input.baseBranch &&
        pullRequest.headSha === input.commitSha,
    );
  const existing = await client.findOpenPullRequest(input.headBranch);
  if (existing) {
    if (matches(existing)) return { pullRequest: existing, reused: true };
    throw failure(
      PublicationStatus.PR_CREATION_FAILED,
      'PUBLICATION_PR_MISMATCH',
      'An open pull request for the publication branch does not match the approved package.',
    );
  }
  try {
    const pullRequest = await client.createPullRequest({
      title: input.title,
      body: input.body,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
    });
    return { pullRequest, reused: false };
  } catch (error) {
    if (error instanceof GithubPublicationApiError && error.status === 422) {
      const raced = await client.findOpenPullRequest(input.headBranch);
      if (matches(raced)) return { pullRequest: raced, reused: true };
      throw failure(
        PublicationStatus.PR_CREATION_FAILED,
        'PUBLICATION_PR_EXISTS',
        'A pull request for the publication branch already exists and does not match.',
      );
    }
    throw error;
  }
}

const stageFailureStatus: Readonly<Record<string, PublicationStatus>> = {
  [PublicationStatus.POLICY_CHECK]: PublicationStatus.PUBLICATION_BLOCKED,
  [PublicationStatus.COMMIT_MATERIALIZING]: PublicationStatus.PUBLICATION_BLOCKED,
  [PublicationStatus.BRANCH_PUBLISHING]: PublicationStatus.PUSH_FAILED,
  [PublicationStatus.DRAFT_PR_CREATING]: PublicationStatus.PR_CREATION_FAILED,
};

/** Maps any pipeline error to the terminal status and code required by policy. */
export function classifyPublicationFailure(
  error: unknown,
  stage: PublicationStatus,
): { status: PublicationStatus; code: string; message: string } {
  const stageStatus = stageFailureStatus[stage] ?? PublicationStatus.PUBLICATION_BLOCKED;
  if (error instanceof PublicationFailure)
    return {
      status: error.failureStatus,
      code: error.failureCode,
      message: error.message.slice(0, 2_000),
    };
  const message = (error instanceof Error ? error.message : 'Unknown publication failure.').slice(
    0,
    2_000,
  );
  if (/cancel/i.test(message))
    return { status: PublicationStatus.CANCELLED, code: 'PUBLICATION_CANCELLED', message };
  if (error instanceof GithubPublicationApiError) {
    if (error.status === 401 || error.status === 403)
      return { status: PublicationStatus.PUBLICATION_BLOCKED, code: 'PUBLICATION_FORBIDDEN', message };
    if (error.status === 404)
      return { status: PublicationStatus.PUBLICATION_BLOCKED, code: 'PUBLICATION_NOT_FOUND', message };
    if (error.status === 409)
      return { status: stageStatus, code: 'PUBLICATION_CONFLICT', message };
    if (error.status === 422)
      return { status: stageStatus, code: 'PUBLICATION_VALIDATION_FAILED', message };
    if (error.status >= 500)
      return { status: stageStatus, code: 'PUBLICATION_GITHUB_UNAVAILABLE', message };
  }
  return { status: stageStatus, code: 'PUBLICATION_EXECUTION_FAILED', message };
}

/** Numeric stage used to skip already-completed steps on retry. */
export function publicationExecutionStage(status: PublicationStatus): number {
  switch (status) {
    case PublicationStatus.PUBLICATION_REQUESTED:
      return 0;
    case PublicationStatus.POLICY_CHECK:
      return 1;
    case PublicationStatus.COMMIT_MATERIALIZING:
      return 2;
    case PublicationStatus.BRANCH_PUBLISHING:
    case PublicationStatus.PUSH_FAILED:
      return 3;
    case PublicationStatus.DRAFT_PR_CREATING:
    case PublicationStatus.PR_CREATION_FAILED:
      return 4;
    default:
      return 5;
  }
}
