import type { NextRequest } from 'next/server';
import { codeerHumanApiFetch, upstreamJson } from '../../../../lib/codeer-api';

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const targetPath = `/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const method = request.method;
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  const idempotencyKey = request.headers.get('idempotency-key');
  const ifMatch = request.headers.get('if-match');
  if (contentType) headers.set('content-type', contentType);
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  if (ifMatch) headers.set('if-match', ifMatch);
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  const response = await codeerHumanApiFetch(request, targetPath, init);
  return Response.json(await upstreamJson(response, 'CodeER API request failed'), {
    status: response.status,
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
