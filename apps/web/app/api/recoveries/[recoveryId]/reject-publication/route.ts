import { NextResponse, type NextRequest } from 'next/server';
import { PublicationDecision, PublicationDecisionSchema } from '@codeer/contracts';
import { z } from 'zod';
import { codeerHumanApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ recoveryId: string }> },
) {
  const { recoveryId } = await context.params;
  const id = IdSchema.safeParse(recoveryId);
  const raw = (await request.json().catch((): null => null)) as unknown;
  const input = PublicationDecisionSchema.safeParse({
    ...(typeof raw === 'object' && raw ? raw : {}),
    decision: PublicationDecision.REJECT,
  });
  if (!id.success || !input.success)
    return NextResponse.json({ message: 'Publication decision is invalid.' }, { status: 400 });
  const upstream = await codeerHumanApiFetch(
    request,
    `/recoveries/${encodeURIComponent(id.data)}/reject-publication`,
    {
      method: 'POST',
      body: JSON.stringify(input.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Publication decision failed.'), {
    status: upstream.status,
  });
}
