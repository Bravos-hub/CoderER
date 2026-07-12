import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { InvestigationListQuerySchema, StartInvestigationSchema } from '@codeer/contracts';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const parsedId = IdSchema.safeParse(incidentId);
  const parsedQuery = InvestigationListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsedId.success || !parsedQuery.success) {
    return NextResponse.json({ message: 'Investigation query is invalid.' }, { status: 400 });
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsedQuery.data)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const upstream = await codeerApiFetch(
    `/incidents/${encodeURIComponent(parsedId.data)}/investigations?${query.toString()}`,
    { cache: 'no-store', signal: AbortSignal.timeout(15_000) },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Investigation lookup failed.'), {
    status: upstream.status,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const parsedId = IdSchema.safeParse(incidentId);
  const parsedBody = StartInvestigationSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json(
      {
        message: 'Investigation request is invalid.',
        issues: parsedBody.success ? undefined : parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }
  const upstream = await codeerApiFetch(
    `/incidents/${encodeURIComponent(parsedId.data)}/investigations`,
    {
      method: 'POST',
      headers: { 'idempotency-key': request.headers.get('idempotency-key') ?? crypto.randomUUID() },
      body: JSON.stringify(parsedBody.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Investigation request failed.'), {
    status: upstream.status,
  });
}
