import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const apiUrl = process.env.CODEER_API_URL_INTERNAL ?? 'http://localhost:4100/api/v1';
const apiKey = process.env.CODEER_INTERNAL_API_KEY;
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

  const upstream = await fetch(
    `${apiUrl}/repositories/intakes/${encodeURIComponent(parsed.data)}`,
    {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body: unknown = await upstream
    .json()
    .catch(() => ({ message: 'Repository intake lookup failed.' }));
  return NextResponse.json(body, { status: upstream.status });
}
