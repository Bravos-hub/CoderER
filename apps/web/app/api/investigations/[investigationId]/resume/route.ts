import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
const ACTION = 'resume';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ investigationId: string }> },
): Promise<NextResponse> {
  const { investigationId } = await context.params;
  const parsed = IdSchema.safeParse(investigationId);
  if (!parsed.success)
    return NextResponse.json({ message: 'Invalid investigation ID.' }, { status: 400 });
  const upstream = await codeerApiFetch(
    `/investigations/${encodeURIComponent(parsed.data)}/${ACTION}`,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, `Investigation ${ACTION} failed.`), {
    status: upstream.status,
  });
}
