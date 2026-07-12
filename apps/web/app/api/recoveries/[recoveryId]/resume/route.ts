import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerHumanApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ recoveryId: string }> },
): Promise<NextResponse> {
  const { recoveryId } = await context.params;
  const id = IdSchema.safeParse(recoveryId);
  if (!id.success) return NextResponse.json({ message: 'Invalid recovery ID.' }, { status: 400 });
  const upstream = await codeerHumanApiFetch(
    request,
    `/recoveries/${encodeURIComponent(id.data)}/resume`,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Recovery resume failed.'), {
    status: upstream.status,
  });
}
