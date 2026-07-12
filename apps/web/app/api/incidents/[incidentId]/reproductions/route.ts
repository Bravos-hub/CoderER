import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ReproductionListQuerySchema, StartReproductionSchema } from '@codeer/contracts';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IncidentIdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const parsedId = IncidentIdSchema.safeParse(incidentId);
  const parsedQuery = ReproductionListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsedId.success || !parsedQuery.success) {
    return NextResponse.json({ message: 'Reproduction query is invalid.' }, { status: 400 });
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsedQuery.data)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const upstream = await codeerApiFetch(
    `/incidents/${encodeURIComponent(parsedId.data)}/reproductions?${query.toString()}`,
    { cache: 'no-store', signal: AbortSignal.timeout(15_000) },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Reproduction lookup failed.'), {
    status: upstream.status,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const parsedId = IncidentIdSchema.safeParse(incidentId);
  const parsedBody = StartReproductionSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json(
      {
        message: 'Reproduction request is invalid.',
        issues: parsedBody.success ? undefined : parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }
  const upstream = await codeerApiFetch(
    `/incidents/${encodeURIComponent(parsedId.data)}/reproductions`,
    {
      method: 'POST',
      headers: { 'idempotency-key': request.headers.get('idempotency-key') ?? crypto.randomUUID() },
      body: JSON.stringify(parsedBody.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Reproduction request failed.'), {
    status: upstream.status,
  });
}
