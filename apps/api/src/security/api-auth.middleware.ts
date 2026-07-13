import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface ApiAuthOptions {
  mode: 'disabled' | 'api-key';
  apiKey?: string | undefined;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isValidApiKey(
  expected: string | undefined,
  candidate: string | undefined,
): boolean {
  if (!expected || !candidate) return false;
  const expectedDigest = digest(expected);
  const candidateDigest = digest(candidate);
  return (
    expectedDigest.length === candidateDigest.length &&
    timingSafeEqual(expectedDigest, candidateDigest)
  );
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

export function createApiAuthMiddleware(options: ApiAuthOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      options.mode === 'disabled' ||
      request.path.startsWith('/api/v1/health') ||
      request.path.startsWith('/api/v1/webhooks/github')
    ) {
      next();
      return;
    }

    const authenticated = isValidApiKey(options.apiKey, bearerToken(request));

    if (!authenticated) {
      const requestId =
        typeof response.locals.requestId === 'string' ? response.locals.requestId : undefined;
      response.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'A valid CodeER bearer token is required.',
        requestId,
      });
      return;
    }

    next();
  };
}
