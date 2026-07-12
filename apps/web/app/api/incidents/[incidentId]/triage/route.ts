import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RequestTriageSchema } from '@codeer/contracts';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IncidentIdSchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const parsedId = IncidentIdSchema.safeParse(incidentId);
  const parsedBody = RequestTriageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ message: 'Triage request is invalid.' }, { status: 400 });
  }
  const upstream = await codeerApiFetch(`/incidents/${encodeURIComponent(parsedId.data)}/triage`, {
    method: 'POST',
    body: JSON.stringify(parsedBody.data),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Triage request failed.'), {
    status: upstream.status,
  });
}
