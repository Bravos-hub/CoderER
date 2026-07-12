import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IncidentIdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const parsed = IncidentIdSchema.safeParse(incidentId);
  if (!parsed.success)
    return NextResponse.json({ message: 'Invalid incident ID.' }, { status: 400 });
  const upstream = await codeerApiFetch(`/incidents/${encodeURIComponent(parsed.data)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Incident lookup failed.'), {
    status: upstream.status,
  });
}
