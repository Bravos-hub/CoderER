import { NextResponse, type NextRequest } from 'next/server';
import { AdmitRepositorySchema } from '@codeer/contracts';

export const dynamic = 'force-dynamic';

const apiUrl = process.env.CODEER_API_URL_INTERNAL ?? 'http://localhost:4100/api/v1';
const apiKey = process.env.CODEER_INTERNAL_API_KEY;

function headers(): HeadersInit {
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = AdmitRepositorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Repository admission input is invalid.', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const upstream = await fetch(`${apiUrl}/repositories/intakes`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await upstream
    .json()
    .catch(() => ({ message: 'Repository admission failed.' }));
  return NextResponse.json(body, { status: upstream.status });
}

export async function GET(): Promise<NextResponse> {
  const upstream = await fetch(`${apiUrl}/repositories/intakes`, {
    headers: headers(),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await upstream
    .json()
    .catch(() => ({ message: 'Repository intake lookup failed.' }));
  return NextResponse.json(body, { status: upstream.status });
}
