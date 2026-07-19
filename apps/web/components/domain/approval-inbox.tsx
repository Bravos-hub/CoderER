'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  PlanApprovalDecision,
  RecoveryRunStatus,
  TreatmentPlanStatus,
  type Investigation,
  type RecoveryRun,
  type TreatmentPlan,
} from '@codeer/contracts';
import { apiRequest } from '../../lib/client-api';
import { EmptyState, ErrorState, LoadingState } from '../ui/data-state';
import { StatusBadge } from '../ui/status';

type InvestigationDetail = { investigation: Investigation; treatmentPlans: TreatmentPlan[] };
type PendingPlan = TreatmentPlan & { incidentId: string };

export function ApprovalInbox() {
  const [plans, setPlans] = useState<PendingPlan[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryRun[]>([]);
  const [comment, setComment] = useState(
    'I reviewed the cited evidence, proposed scope, verification plan, risks, and rollback procedure.',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [investigationList, recoveryList] = await Promise.all([
        apiRequest<{ items: Investigation[] }>('investigations?limit=100'),
        apiRequest<{ items: RecoveryRun[] }>('recoveries?limit=100'),
      ]);
      const details = await Promise.all(
        investigationList.items.map((item) =>
          apiRequest<InvestigationDetail>(`investigations/${item.id}`),
        ),
      );
      setPlans(
        details.flatMap((item) =>
          item.treatmentPlans
            .filter((plan) => plan.status === TreatmentPlanStatus.AWAITING_APPROVAL)
            .map((plan) => ({ ...plan, incidentId: item.investigation.incidentId })),
        ),
      );
      setRecoveries(
        recoveryList.items.filter(
          (item) => item.status === RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL,
        ),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load approval inbox.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function decidePlan(plan: TreatmentPlan, decision: PlanApprovalDecision) {
    const action =
      decision === PlanApprovalDecision.APPROVE
        ? 'approve'
        : decision === PlanApprovalDecision.REJECT
          ? 'reject'
          : 'request-revision';
    setBusy(plan.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`treatment-plans/${plan.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment, expectedVersion: plan.version }),
      });
      setNotice(`Treatment plan v${plan.version} decision recorded.`);
      setConfirmed(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Treatment-plan decision failed.');
    } finally {
      setBusy(null);
    }
  }

  async function decideRecovery(
    recovery: RecoveryRun,
    action: 'approve-publication' | 'reject-publication',
  ) {
    setBusy(recovery.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`recoveries/${recovery.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ comment, expectedRecoveryVersion: recovery.version }),
      });
      setNotice(`Recovery v${recovery.version} publication decision recorded.`);
      setConfirmed(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication decision failed.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingState label="Loading human decision queues…" />;
  if (error && !plans.length && !recoveries.length)
    return <ErrorState message={error} onRetry={() => void load()} />;
  const disabled = !confirmed || comment.trim().length < 10;
  return (
    <>
      <section className="panel approvalDecisionBar">
        <label>
          Decision rationale
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <label className="confirmationCheck">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{' '}
          I confirm this is my explicit human decision for the exact version shown.
        </label>
        {error ? (
          <p className="formError" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="formNotice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
      {!plans.length && !recoveries.length ? (
        <EmptyState
          title="No pending approvals"
          description="All human governance queues are clear."
        />
      ) : null}
      <section className="approvalGrid">
        {plans.map((plan) => (
          <article className="panel" key={plan.id}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">TREATMENT PLAN · v{plan.version}</p>
                <h2>{plan.goal}</h2>
              </div>
              <StatusBadge value={plan.status} />
            </div>
            <p>{plan.rollbackStrategy}</p>
            <div className="approvalMeta">
              <span>{plan.risk} risk</span>
              <span>{plan.steps.length} steps</span>
              <span>{plan.requiredApprovals} approval(s)</span>
            </div>
            <div className="inlineActions">
              <Link
                className="buttonLink secondaryLink"
                href={`/incidents/${plan.incidentId}/treatment-plan`}
              >
                Review
              </Link>
              <button
                disabled={disabled || busy === plan.id}
                onClick={() => void decidePlan(plan, PlanApprovalDecision.APPROVE)}
              >
                Approve
              </button>
              <button
                className="secondary"
                disabled={disabled || busy === plan.id}
                onClick={() => void decidePlan(plan, PlanApprovalDecision.REQUEST_REVISION)}
              >
                Revise
              </button>
              <button
                className="dangerButton"
                disabled={disabled || busy === plan.id}
                onClick={() => void decidePlan(plan, PlanApprovalDecision.REJECT)}
              >
                Reject
              </button>
            </div>
          </article>
        ))}
        {recoveries.map((recovery) => (
          <article className="panel" key={recovery.id}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">PUBLICATION · RECOVERY v{recovery.version}</p>
                <h2>{recovery.branchName}</h2>
              </div>
              <StatusBadge value={recovery.status} />
            </div>
            <p>
              Approve only after reviewing the immutable patch, independent verification matrix,
              security findings, and rollback package.
            </p>
            <div className="approvalMeta">
              <span>Patch v{recovery.patchVersion}</span>
              <span>Plan v{recovery.treatmentPlanVersion}</span>
              <span>No auto-merge</span>
            </div>
            <div className="inlineActions">
              <Link
                className="buttonLink secondaryLink"
                href={`/incidents/${recovery.incidentId}/publication`}
              >
                Review
              </Link>
              <button
                disabled={disabled || busy === recovery.id}
                onClick={() => void decideRecovery(recovery, 'approve-publication')}
              >
                Approve publication
              </button>
              <button
                className="dangerButton"
                disabled={disabled || busy === recovery.id}
                onClick={() => void decideRecovery(recovery, 'reject-publication')}
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
