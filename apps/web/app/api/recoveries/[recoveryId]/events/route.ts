import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IdSchema = z.string().uuid();
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ recoveryId: string }> },
): Promise<NextResponse> {
  const { recoveryId } = await context.params;
  const id = IdSchema.safeParse(recoveryId);
  if (!id.success) return NextResponse.json({ message: 'Invalid recovery ID.' }, { status: 400 });
  const upstream = await codeerApiFetch(
    `/recoveries/${encodeURIComponent(id.data)}/events${request.nextUrl.search}`,
    { cache: 'no-store', signal: AbortSignal.timeout(15_000) },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Recovery events lookup failed.'), {
    status: upstream.status,
  });
}
