'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PublicationDecision,
  RecoveryRunStatus,
  TreatmentPlanStatus,
  type Investigation,
  type PatchVersion,
  type PullRequestPackage,
  type RecoveryEvent,
  type RecoveryRun,
  type RecoverySecurityReview,
  type RecoveryVerificationReport,
  type TreatmentPlan,
} from '@codeer/contracts';

type InvestigationList = { items: Investigation[]; nextCursor: string | null };
type RecoveryList = { items: RecoveryRun[]; nextCursor: string | null };
type RecoveryDetail = {
  recovery: RecoveryRun;
  patch: PatchVersion | null;
  securityReview: RecoverySecurityReview | null;
  verification: RecoveryVerificationReport | null;
  pullRequestPackage: PullRequestPackage | null;
};

const terminal = new Set<RecoveryRunStatus>([
  RecoveryRunStatus.PUBLISHED,
  RecoveryRunStatus.POLICY_BLOCKED,
  RecoveryRunStatus.CANCELLED,
  RecoveryRunStatus.PATCH_REJECTED,
  RecoveryRunStatus.SECURITY_REJECTED,
  RecoveryRunStatus.VERIFICATION_FAILED,
  RecoveryRunStatus.WORKTREE_FAILED,
  RecoveryRunStatus.MODEL_FAILED,
  RecoveryRunStatus.TOOL_FAILED,
  RecoveryRunStatus.BUDGET_EXCEEDED,
  RecoveryRunStatus.CLEANUP_FAILED,
]);

const resumable = new Set<RecoveryRunStatus>([
  RecoveryRunStatus.PATCH_REJECTED,
  RecoveryRunStatus.SECURITY_REJECTED,
  RecoveryRunStatus.VERIFICATION_FAILED,
  RecoveryRunStatus.WORKTREE_FAILED,
  RecoveryRunStatus.MODEL_FAILED,
  RecoveryRunStatus.TOOL_FAILED,
  RecoveryRunStatus.BUDGET_EXCEEDED,
]);

function errorMessage(value: unknown, fallback: string): string {
  return typeof value === 'object' &&
    value &&
    'message' in value &&
    typeof value.message === 'string'
    ? value.message
    : fallback;
}

export function RecoveryPanel({ incidentId }: { incidentId: string }) {
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryRun[]>([]);
  const [selected, setSelected] = useState<RecoveryDetail | null>(null);
  const [events, setEvents] = useState<RecoveryEvent[]>([]);
  const [planId, setPlanId] = useState('');
  const [baseCommitSha, setBaseCommitSha] = useState('');
  const [constraints, setConstraints] = useState(
    'Limit changes to approved treatment-plan components.',
  );
  const [decisionComment, setDecisionComment] = useState(
    'Reviewed the patch, evidence, security review, verification matrix, and rollback procedure.',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selected?.recovery.id;

  const loadLists = useCallback(async () => {
    const [investigationResponse, recoveryResponse] = await Promise.all([
      fetch(`/api/incidents/${encodeURIComponent(incidentId)}/investigations?limit=50`, {
        cache: 'no-store',
      }),
      fetch(`/api/incidents/${encodeURIComponent(incidentId)}/recoveries?limit=50`, {
        cache: 'no-store',
      }),
    ]);
    if (recoveryResponse.ok) {
      const list = (await recoveryResponse.json()) as RecoveryList;
      setRecoveries(list.items);
      if (!selectedId && list.items[0]) {
        const detailResponse = await fetch(`/api/recoveries/${list.items[0].id}`, {
          cache: 'no-store',
        });
        if (detailResponse.ok) setSelected((await detailResponse.json()) as RecoveryDetail);
      }
    }
    if (investigationResponse.ok) {
      const list = (await investigationResponse.json()) as InvestigationList;
      const planResults = await Promise.all(
        list.items.slice(0, 20).map(async (investigation) => {
          const response = await fetch(`/api/investigations/${investigation.id}/treatment-plans`, {
            cache: 'no-store',
          });
          return response.ok ? ((await response.json()) as TreatmentPlan[]) : [];
        }),
      );
      const approved = planResults
        .flat()
        .filter((plan) => plan.status === TreatmentPlanStatus.APPROVED);
      setPlans(approved);
      if (!planId && approved[0]) setPlanId(approved[0].id);
    }
  }, [incidentId, planId, selectedId]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) return;
    const [detailResponse, eventResponse] = await Promise.all([
      fetch(`/api/recoveries/${selectedId}`, { cache: 'no-store' }),
      fetch(`/api/recoveries/${selectedId}/events?limit=500`, { cache: 'no-store' }),
    ]);
    if (detailResponse.ok) setSelected((await detailResponse.json()) as RecoveryDetail);
    if (eventResponse.ok) setEvents((await eventResponse.json()) as RecoveryEvent[]);
  }, [selectedId]);

  useEffect(() => {
    void loadLists().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Recovery lookup failed.'),
    );
    const timer = window.setInterval(() => void loadLists(), 6_000);
    return () => window.clearInterval(timer);
  }, [loadLists]);

  useEffect(() => {
    void loadSelected();
    const timer = window.setInterval(() => void loadSelected(), 3_000);
    return () => window.clearInterval(timer);
  }, [loadSelected]);

  const active = useMemo(
    () =>
      recoveries.find(
        (run) => !terminal.has(run.status) && run.status !== RecoveryRunStatus.READY_TO_PUBLISH,
      ),
    [recoveries],
  );

  async function startRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/treatment-plans/${encodeURIComponent(planId)}/recoveries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            baseCommitSha: baseCommitSha.trim(),
            additionalConstraints: constraints
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          }),
        },
      );
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Recovery creation failed.'));
      const recovery = body as RecoveryRun;
      setSelected({
        recovery,
        patch: null,
        securityReview: null,
        verification: null,
        pullRequestPackage: null,
      });
      setEvents([]);
      await loadLists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recovery creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function selectRecovery(recoveryId: string) {
    const response = await fetch(`/api/recoveries/${recoveryId}`, { cache: 'no-store' });
    if (response.ok) setSelected((await response.json()) as RecoveryDetail);
  }

  async function action(name: 'cancel' | 'resume') {
    if (!selectedId) return;
    const response = await fetch(`/api/recoveries/${selectedId}/${name}`, { method: 'POST' });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) setError(errorMessage(body, `Recovery ${name} failed.`));
    await loadSelected();
  }

  async function decide(decision: PublicationDecision) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const endpoint =
      decision === PublicationDecision.APPROVE ? 'approve-publication' : 'reject-publication';
    try {
      const response = await fetch(`/api/recoveries/${selected.recovery.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          comment: decisionComment,
          expectedRecoveryVersion: selected.recovery.version,
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Publication decision failed.'));
      await loadSelected();
      await loadLists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication decision failed.');
    } finally {
      setBusy(false);
    }
  }

  async function requestRevision() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/recoveries/${selected.recovery.id}/request-revision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          comment: decisionComment,
          expectedRecoveryVersion: selected.recovery.version,
          additionalConstraints: constraints
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Revision request failed.'));
      await loadSelected();
      await loadLists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revision request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="recoverySection">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">CONTROLLED RECOVERY PLANE</p>
          <h2>Evidence-linked patch governance</h2>
        </div>
        <span className="readOnlyBadge">ISOLATED WORKTREE · NO AUTO-MERGE</span>
      </div>
      <div className="investigationGrid">
        <form className="panel incidentCreateForm" onSubmit={(event) => void startRecovery(event)}>
          <label>
            Approved treatment plan
            <select value={planId} onChange={(event) => setPlanId(event.target.value)} required>
              <option value="">Select approved plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  v{plan.version} · {plan.goal}
                </option>
              ))}
            </select>
          </label>
          <label>
            Immutable base commit SHA
            <input
              value={baseCommitSha}
              onChange={(event) => setBaseCommitSha(event.target.value.toLowerCase())}
              pattern="[0-9a-f]{40}"
              placeholder="40-character commit SHA"
              required
            />
          </label>
          <label>
            Additional constraints
            <textarea
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
            />
          </label>
          <p className="policyNote">
            Patch scope, file types, line budgets, dependency changes, migrations, workflows,
            security-sensitive files, and publication approvals are enforced server-side.
          </p>
          {plans.length === 0 ? (
            <p className="formError">A fully approved treatment plan is required.</p>
          ) : null}
          {error ? <p className="formError">{error}</p> : null}
          <button disabled={busy || Boolean(active) || !planId || baseCommitSha.length !== 40}>
            {busy ? 'Submitting…' : 'Start controlled recovery'}
          </button>
        </form>
        <article className="panel investigationRuns">
          <div className="panelHeader">
            <h3>Recovery history</h3>
            <span>{recoveries.length}</span>
          </div>
          <div className="investigationRunList">
            {recoveries.map((run) => (
              <button
                type="button"
                key={run.id}
                className={selectedId === run.id ? 'selectedRun' : ''}
                onClick={() => {
                  void selectRecovery(run.id);
                }}
              >
                <span>{run.status.replaceAll('_', ' ')}</span>
                <strong>{run.id.slice(0, 8)}</strong>
                <small>
                  Patch {run.patchVersion ?? 'pending'} · v{run.version}
                </small>
              </button>
            ))}
            {recoveries.length === 0 ? <p>No recoveries yet.</p> : null}
          </div>
        </article>
      </div>

      {selected ? (
        <>
          <section className="metricGrid investigationMetrics">
            <article>
              <span>Status</span>
              <strong>{selected.recovery.status.replaceAll('_', ' ')}</strong>
            </article>
            <article>
              <span>Patch version</span>
              <strong>{selected.patch?.version ?? 'Pending'}</strong>
            </article>
            <article>
              <span>Changed files</span>
              <strong>{selected.patch?.changedFiles ?? 0}</strong>
            </article>
            <article>
              <span>Changed lines</span>
              <strong>
                {selected.patch ? selected.patch.addedLines + selected.patch.deletedLines : 0}
              </strong>
            </article>
          </section>
          <div className="investigationEvidenceGrid">
            <article className="panel">
              <div className="panelHeader">
                <h3>Recovery timeline</h3>
                <div className="inlineActions">
                  {!terminal.has(selected.recovery.status) &&
                  selected.recovery.status !== RecoveryRunStatus.READY_TO_PUBLISH ? (
                    <button className="secondary" onClick={() => void action('cancel')}>
                      Cancel
                    </button>
                  ) : null}
                  {resumable.has(selected.recovery.status) ? (
                    <button className="secondary" onClick={() => void action('resume')}>
                      Resume
                    </button>
                  ) : null}
                </div>
              </div>
              <ol className="investigationTimeline">
                {events.map((item) => (
                  <li key={item.id}>
                    <span>{String(item.sequence).padStart(2, '0')}</span>
                    <div>
                      <strong>{item.type.replaceAll('_', ' ')}</strong>
                      <time>{new Date(item.occurredAt).toLocaleString()}</time>
                      <code>{item.eventHash.slice(0, 16)}…</code>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
            <article className="panel">
              <div className="panelHeader">
                <h3>Independent gates</h3>
              </div>
              <dl className="compactDl">
                <div>
                  <dt>Patch policy</dt>
                  <dd>{selected.patch?.policyDecision.allowed ? 'Passed' : 'Pending / blocked'}</dd>
                </div>
                <div>
                  <dt>Security review</dt>
                  <dd>{selected.securityReview?.decision ?? 'Pending'}</dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>{selected.verification?.status ?? 'Pending'}</dd>
                </div>
                <div>
                  <dt>Original failure</dt>
                  <dd>
                    {selected.verification?.originalFailureResolved ? 'Resolved' : 'Not yet proven'}
                  </dd>
                </div>
              </dl>
              {selected.securityReview ? (
                <>
                  <p>{selected.securityReview.summary}</p>
                  <ul className="evidenceList">
                    {selected.securityReview.findings.map((finding, index) => (
                      <li key={`${finding.category}-${index}`}>
                        <strong>
                          {finding.severity} · {finding.category}
                        </strong>
                        <span>{finding.message}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          </div>
          {selected.patch ? (
            <article className="panel recoveryDiffPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">IMMUTABLE PATCH v{selected.patch.version}</p>
                  <h3>File and hunk review</h3>
                </div>
                <code>{selected.patch.patchDigest.slice(0, 20)}…</code>
              </div>
              {selected.patch.files.map((file) => (
                <section className="recoveryFile" key={file.id}>
                  <header>
                    <strong>{file.newPath ?? file.oldPath}</strong>
                    <span>
                      +{file.addedLines} −{file.deletedLines}
                    </span>
                  </header>
                  {file.hunks.map((hunk) => (
                    <article key={hunk.id}>
                      <div className="hunkMeta">
                        <span>Plan step {hunk.treatmentPlanStep}</span>
                        <span>{hunk.evidenceCitations.length} citation(s)</span>
                        <code>{hunk.contentHash.slice(0, 16)}…</code>
                      </div>
                      <pre>{hunk.content}</pre>
                    </article>
                  ))}
                </section>
              ))}
            </article>
          ) : null}
          {selected.verification ? (
            <article className="panel verificationPanel">
              <div className="panelHeader">
                <h3>Verification matrix</h3>
                <span>{Math.round(selected.verification.confidence * 100)}% confidence</span>
              </div>
              <div className="verificationTable">
                {selected.verification.checks.map((check) => (
                  <div key={check.id}>
                    <strong>{check.name}</strong>
                    <span>{check.status}</span>
                    <small>{check.summary}</small>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
          {selected.pullRequestPackage ? (
            <article className="panel prPackagePanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">REVIEW PACKAGE v{selected.pullRequestPackage.version}</p>
                  <h3>{selected.pullRequestPackage.title}</h3>
                </div>
                <code>{selected.pullRequestPackage.packageHash.slice(0, 20)}…</code>
              </div>
              <p>{selected.pullRequestPackage.rootCauseSummary}</p>
              <pre className="prBodyPreview">{selected.pullRequestPackage.body}</pre>
              <div className="planGovernance">
                <div>
                  <strong>Rollback</strong>
                  <p>{selected.pullRequestPackage.rollbackInstructions}</p>
                </div>
                <div className="decisionControls">
                  <label>
                    Human decision record
                    <textarea
                      value={decisionComment}
                      onChange={(event) => setDecisionComment(event.target.value)}
                    />
                  </label>
                  <div className="inlineActions">
                    <button
                      disabled={
                        busy ||
                        selected.recovery.status !== RecoveryRunStatus.AWAITING_PUBLICATION_APPROVAL
                      }
                      onClick={() => void decide(PublicationDecision.APPROVE)}
                    >
                      Approve draft publication
                    </button>
                    <button
                      className="dangerButton"
                      disabled={busy}
                      onClick={() => void decide(PublicationDecision.REJECT)}
                    >
                      Reject
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void requestRevision()}
                    >
                      Request revision
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
