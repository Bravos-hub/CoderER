import { createSign } from 'node:crypto';

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function createGithubAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!/^\d+$/.test(appId)) throw new Error('GitHub App ID must be numeric.');
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKeyPem).toString('base64url')}`;
}

export interface GithubInstallationToken {
  token: string;
  expiresAt: string;
}

export class GithubAppTokenError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'GithubAppTokenError';
  }
}

export class GithubAppClient {
  constructor(
    private readonly baseUrl = 'https://api.github.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createInstallationToken(
    appJwt: string,
    installationId: string,
    repositoryIds: number[],
  ): Promise<GithubInstallationToken> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repository_ids: repositoryIds,
          permissions: {
            contents: 'write',
            pull_requests: 'write',
            checks: 'read',
            metadata: 'read',
          },
        }),
      },
    );
    if (!response.ok)
      throw new GithubAppTokenError(
        response.status,
        `GitHub installation token request failed with status ${response.status}.`,
      );
    const body = (await response.json()) as { token?: string; expires_at?: string };
    if (!body.token || !body.expires_at)
      throw new GithubAppTokenError(null, 'GitHub installation token response is incomplete.');
    return { token: body.token, expiresAt: body.expires_at };
  }
}
