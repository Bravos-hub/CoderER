import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ investigationId: string }> },
): Promise<NextResponse> {
  const { investigationId } = await context.params;
  const parsed = IdSchema.safeParse(investigationId);
  if (!parsed.success)
    return NextResponse.json({ message: 'Invalid investigation ID.' }, { status: 400 });
  const upstream = await codeerApiFetch(`/investigations/${encodeURIComponent(parsed.data)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Investigation lookup failed.'), {
    status: upstream.status,
  });
}
