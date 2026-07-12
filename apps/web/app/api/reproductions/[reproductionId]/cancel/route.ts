import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ reproductionId: string }> },
): Promise<NextResponse> {
  const { reproductionId } = await context.params;
  const parsed = IdSchema.safeParse(reproductionId);
  if (!parsed.success)
    return NextResponse.json({ message: 'Invalid reproduction ID.' }, { status: 400 });
  const upstream = await codeerApiFetch(
    `/reproductions/${encodeURIComponent(parsed.data)}/cancel`,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Cancellation request failed.'), {
    status: upstream.status,
  });
}
