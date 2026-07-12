import { NextResponse, type NextRequest } from 'next/server';
import { AdmitRepositorySchema } from '@codeer/contracts';
import { codeerApiFetch, upstreamJson } from '../../../../lib/codeer-api';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = AdmitRepositorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Repository admission input is invalid.', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const upstream = await codeerApiFetch('/repositories/intakes', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Repository admission failed.'), {
    status: upstream.status,
  });
}

export async function GET(): Promise<NextResponse> {
  const upstream = await codeerApiFetch('/repositories/intakes', {
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  return NextResponse.json(await upstreamJson(upstream, 'Repository intake lookup failed.'), {
    status: upstream.status,
  });
}
