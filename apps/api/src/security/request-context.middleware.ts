import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const suppliedRequestId = request.header('x-request-id');
  const requestId =
    suppliedRequestId && SAFE_REQUEST_ID.test(suppliedRequestId) ? suppliedRequestId : randomUUID();

  response.setHeader('x-request-id', requestId);
  response.locals.requestId = requestId;
  next();
}
