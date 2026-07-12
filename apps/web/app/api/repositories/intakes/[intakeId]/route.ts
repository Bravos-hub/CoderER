import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { codeerApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';
const IntakeIdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ intakeId: string }> },
): Promise<NextResponse> {
  const { intakeId } = await context.params;
  const parsed = IntakeIdSchema.safeParse(intakeId);
  if (!parsed.success) {
    return NextResponse.json({ message: 'Invalid intake identifier.' }, { status: 400 });
  }

  const upstream = await codeerApiFetch(
    `/repositories/intakes/${encodeURIComponent(parsed.data)}`,
    {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Repository intake lookup failed.'), {
    status: upstream.status,
  });
}
