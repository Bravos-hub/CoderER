function scalarMessage(value: unknown): string {
  return typeof value === 'string' ? value : 'CodeER API request failed';
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? scalarMessage(body.message)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

export function createIdempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}
