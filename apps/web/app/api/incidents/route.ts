import { NextResponse, type NextRequest } from 'next/server';
import { CreateIncidentSchema, IncidentListQuerySchema } from '@codeer/contracts';
import { codeerApiFetch, upstreamJson } from '../../../lib/codeer-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = IncidentListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Incident query is invalid.', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const upstream = await codeerApiFetch(`/incidents?${query.toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Incident lookup failed.'), {
    status: upstream.status,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = CreateIncidentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Incident input is invalid.', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const idempotencyKey = request.headers.get('idempotency-key') ?? crypto.randomUUID();
  const upstream = await codeerApiFetch('/incidents', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Incident creation failed.'), {
    status: upstream.status,
  });
}
