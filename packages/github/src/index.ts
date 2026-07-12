import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import {
  GitHubRepositoryLocatorSchema,
  RepositoryProvider,
  RepositoryVisibility,
  type GitHubRepositoryLocator,
  type RepositoryBranch,
} from '@codeer/contracts';

export interface GitHubAuthenticationOptions {
  appId?: string | undefined;
  privateKey?: string | undefined;
  installationId?: number | undefined;
  token?: string | undefined;
  apiUrl?: string | undefined;
  maxBranches?: number | undefined;
  requestTimeoutMs?: number | undefined;
}

export interface GitHubRepositoryMetadata {
  provider: RepositoryProvider.GITHUB;
  providerRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  visibility: RepositoryVisibility;
  headSha: string;
  branches: RepositoryBranch[];
}

function validatedHttpsUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS URL without embedded credentials`);
  }
  return url;
}

export function parseGitHubRepositoryUrl(repositoryUrl: string): GitHubRepositoryLocator {
  if (/^https:\/\/github\.com:\d+\//i.test(repositoryUrl)) {
    throw new Error('Repository URL must not include an explicit port');
  }
  const url = validatedHttpsUrl(repositoryUrl, 'Repository URL');
  if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash) {
    throw new Error(
      'Repository URL must use the canonical https://github.com/owner/repository form',
    );
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2) throw new Error('Repository URL must be in owner/repository form');

  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/i, '');
  return GitHubRepositoryLocatorSchema.parse({ owner, name });
}

export async function resolveGitHubToken(
  options: GitHubAuthenticationOptions,
): Promise<string | undefined> {
  if (options.installationId && options.appId && options.privateKey) {
    const auth = createAppAuth({
      appId: options.appId,
      privateKey: options.privateKey.replace(/\\n/g, '\n'),
    });
    const authentication = await auth({
      type: 'installation',
      installationId: options.installationId,
    });
    return authentication.token;
  }

  return options.token;
}

function visibilityOf(value: string | undefined, isPrivate: boolean): RepositoryVisibility {
  if (value === 'internal') return RepositoryVisibility.INTERNAL;
  return isPrivate ? RepositoryVisibility.PRIVATE : RepositoryVisibility.PUBLIC;
}

async function listBranchesBounded(
  octokit: Octokit,
  locator: GitHubRepositoryLocator,
  maximum: number,
): Promise<RepositoryBranch[]> {
  const branches: RepositoryBranch[] = [];
  const perPage = Math.min(100, maximum);
  let page = 1;

  while (branches.length < maximum) {
    const response = await octokit.rest.repos.listBranches({
      owner: locator.owner,
      repo: locator.name,
      per_page: perPage,
      page,
    });

    branches.push(
      ...response.data.slice(0, maximum - branches.length).map((branch) => ({
        name: branch.name,
        sha: branch.commit.sha,
        protected: branch.protected,
      })),
    );

    if (response.data.length < perPage) break;
    page += 1;
  }

  return branches;
}

export async function readGitHubRepository(
  locator: GitHubRepositoryLocator,
  options: GitHubAuthenticationOptions,
): Promise<GitHubRepositoryMetadata & { accessToken?: string }> {
  const accessToken = await resolveGitHubToken(options);
  const apiUrl = validatedHttpsUrl(options.apiUrl ?? 'https://api.github.com', 'GitHub API URL');
  const octokit = new Octokit({
    ...(accessToken ? { auth: accessToken } : {}),
    baseUrl: apiUrl.toString().replace(/\/$/, ''),
    request: { timeout: options.requestTimeoutMs ?? 30_000 },
  });
  const repositoryResponse = await octokit.rest.repos.get({
    owner: locator.owner,
    repo: locator.name,
  });
  const repository = repositoryResponse.data;
  const defaultBranch = repository.default_branch;
  const maximumBranches = Math.max(1, Math.min(options.maxBranches ?? 500, 5_000));

  const [headResponse, branches] = await Promise.all([
    octokit.rest.repos.getBranch({
      owner: locator.owner,
      repo: locator.name,
      branch: defaultBranch,
    }),
    listBranchesBounded(octokit, locator, maximumBranches),
  ]);

  const cloneUrl = validatedHttpsUrl(repository.clone_url, 'Git clone URL');
  if (cloneUrl.hostname.toLowerCase() !== 'github.com') {
    throw new Error('GitHub returned an unexpected clone host');
  }

  return {
    provider: RepositoryProvider.GITHUB,
    providerRepositoryId: String(repository.id),
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    cloneUrl: cloneUrl.toString(),
    defaultBranch,
    visibility: visibilityOf(repository.visibility, repository.private),
    headSha: headResponse.data.commit.sha,
    branches,
    ...(accessToken ? { accessToken } : {}),
  };
}
