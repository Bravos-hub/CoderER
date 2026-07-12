import { NextResponse, type NextRequest } from 'next/server';
import { StartRecoverySchema } from '@codeer/contracts';
import { z } from 'zod';
import { codeerHumanApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
): Promise<NextResponse> {
  const { planId } = await context.params;
  const id = IdSchema.safeParse(planId);
  const body = StartRecoverySchema.safeParse(await request.json().catch(() => null));
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!id.success || !body.success || !idempotencyKey) {
    return NextResponse.json(
      { message: 'Controlled-recovery request is invalid.' },
      { status: 400 },
    );
  }
  const upstream = await codeerHumanApiFetch(
    request,
    `/treatment-plans/${encodeURIComponent(id.data)}/recoveries`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Recovery creation failed.'), {
    status: upstream.status,
  });
}
