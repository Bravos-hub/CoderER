import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { PlanApprovalDecision, TreatmentPlanDecisionSchema } from '@codeer/contracts';
import { codeerHumanApiFetch, upstreamJson } from '../../../../../lib/codeer-api';

const IdSchema = z.string().uuid();
const ACTION = 'approve';
const DECISION = PlanApprovalDecision.APPROVE;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> },
): Promise<NextResponse> {
  const { planId } = await context.params;
  const parsedId = IdSchema.safeParse(planId);
  const raw: unknown = await request.json().catch(() => null);
  const parsedBody = TreatmentPlanDecisionSchema.safeParse({
    ...(typeof raw === 'object' && raw ? raw : {}),
    decision: DECISION,
  });
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ message: 'Treatment-plan decision is invalid.' }, { status: 400 });
  }
  const upstream = await codeerHumanApiFetch(
    request,
    `/treatment-plans/${encodeURIComponent(parsedId.data)}/${ACTION}`,
    {
      method: 'POST',
      body: JSON.stringify(parsedBody.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    },
  );
  return NextResponse.json(await upstreamJson(upstream, 'Treatment-plan decision failed.'), {
    status: upstream.status,
  });
}
