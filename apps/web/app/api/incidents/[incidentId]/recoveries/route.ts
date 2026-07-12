import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const { incidentId } = await context.params;
  const id = IdSchema.safeParse(incidentId);
  if (!id.success) return NextResponse.json({ message: 'Invalid incident ID.' }, { status: 400 });
  const upstream = await codeerApiFetch(
    `/incidents/${encodeURIComponent(id.data)}/recoveries${request.nextUrl.search}`,
    { cache: 'no-store', signal: AbortSignal.timeout(15_000) },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Recovery lookup failed.'), {
    status: upstream.status,
  });
}
