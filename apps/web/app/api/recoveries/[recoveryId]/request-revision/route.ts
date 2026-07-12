import { NextResponse, type NextRequest } from 'next/server';
import { RecoveryRevisionRequestSchema } from '@codeer/contracts';
import { z } from 'zod';
import { codeerHumanApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ recoveryId: string }> },
) {
  const { recoveryId } = await context.params;
  const id = IdSchema.safeParse(recoveryId);
  const input = RecoveryRevisionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success)
    return NextResponse.json({ message: 'Recovery revision is invalid.' }, { status: 400 });
  const upstream = await codeerHumanApiFetch(
    request,
    `/recoveries/${encodeURIComponent(id.data)}/request-revision`,
    {
      method: 'POST',
      body: JSON.stringify(input.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Recovery revision failed.'), {
    status: upstream.status,
  });
}
