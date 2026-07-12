import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SandboxLogQuerySchema } from '@codeer/contracts';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reproductionId: string }> },
): Promise<NextResponse> {
  const { reproductionId } = await context.params;
  const parsedId = IdSchema.safeParse(reproductionId);
  const parsedQuery = SandboxLogQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsedId.success || !parsedQuery.success)
    return NextResponse.json({ message: 'Invalid log query.' }, { status: 400 });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsedQuery.data)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const upstream = await codeerApiFetch(
    `/reproductions/${encodeURIComponent(parsedId.data)}/logs?${query.toString()}`,
    {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Sandbox log lookup failed.'), {
    status: upstream.status,
  });
}
