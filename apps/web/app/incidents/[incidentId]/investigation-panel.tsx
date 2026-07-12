'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  InvestigationStatus,
  PlanApprovalDecision,
  SandboxResult,
  TreatmentPlanStatus,
  type Diagnosis,
  type Investigation,
  type InvestigationEvent,
  type InvestigationToolCall,
  type Reproduction,
  type TreatmentPlan,
} from '@codeer/contracts';

type InvestigationList = { items: Investigation[]; nextCursor: string | null };
type ReproductionList = { items: Reproduction[]; nextCursor: string | null };
type ErrorBody = { message?: string };

const terminal = new Set<InvestigationStatus>([
  InvestigationStatus.APPROVED,
  InvestigationStatus.REJECTED,
  InvestigationStatus.POLICY_BLOCKED,
  InvestigationStatus.INSUFFICIENT_EVIDENCE,
  InvestigationStatus.CANCELLED,
  InvestigationStatus.TIMED_OUT,
  InvestigationStatus.MODEL_FAILED,
  InvestigationStatus.TOOL_FAILED,
  InvestigationStatus.BUDGET_EXCEEDED,
  InvestigationStatus.SECURITY_REJECTED,
]);

const resumable = new Set<InvestigationStatus>([
  InvestigationStatus.TIMED_OUT,
  InvestigationStatus.MODEL_FAILED,
  InvestigationStatus.TOOL_FAILED,
  InvestigationStatus.BUDGET_EXCEEDED,
]);

function messageFrom(body: unknown, fallback: string): string {
  return typeof body === 'object' && body && 'message' in body && typeof body.message === 'string'
    ? body.message
    : fallback;
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function InvestigationPanel({ incidentId }: { incidentId: string }) {
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [reproductions, setReproductions] = useState<Reproduction[]>([]);
  const [selected, setSelected] = useState<Investigation | null>(null);
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<InvestigationToolCall[]>([]);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [selectedReproductionId, setSelectedReproductionId] = useState('');
  const [focusAreas, setFocusAreas] = useState('build failure, repository configuration');
  const [additionalContext, setAdditionalContext] = useState('');
  const [decisionComment, setDecisionComment] = useState(
    'Reviewed against cited evidence and organizational recovery policy.',
  );
  const [submitting, setSubmitting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selected?.id;

  const loadLists = useCallback(async () => {
    const [investigationsResponse, reproductionsResponse] = await Promise.all([
      fetch(`/api/incidents/${encodeURIComponent(incidentId)}/investigations?limit=50`, {
        cache: 'no-store',
      }),
      fetch(`/api/incidents/${encodeURIComponent(incidentId)}/reproductions?limit=50`, {
        cache: 'no-store',
      }),
    ]);
    const investigationBody = (await investigationsResponse.json()) as
      InvestigationList | ErrorBody;
    if (!investigationsResponse.ok) {
      throw new Error(messageFrom(investigationBody, 'Investigation lookup failed.'));
    }
    const reproductionBody = (await reproductionsResponse.json()) as ReproductionList | ErrorBody;
    if (!reproductionsResponse.ok) {
      throw new Error(messageFrom(reproductionBody, 'Reproduction lookup failed.'));
    }
    const nextInvestigations = (investigationBody as InvestigationList).items;
    const nextReproductions = (reproductionBody as ReproductionList).items;
    setInvestigations(nextInvestigations);
    setReproductions(nextReproductions);
    if (!selectedId && nextInvestigations[0]) setSelected(nextInvestigations[0]);
    if (!selectedReproductionId) {
      const eligible = nextReproductions.find(
        (item) => item.result === SandboxResult.REPRODUCED && item.cleanup?.verifiedAbsent,
      );
      if (eligible) setSelectedReproductionId(eligible.id);
    }
  }, [incidentId, selectedId, selectedReproductionId]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) return;
    const [detailResponse, eventsResponse, toolsResponse, diagnosisResponse, plansResponse] =
      await Promise.all([
        fetch(`/api/investigations/${selectedId}`, { cache: 'no-store' }),
        fetch(`/api/investigations/${selectedId}/events?limit=500`, { cache: 'no-store' }),
        fetch(`/api/investigations/${selectedId}/tool-calls?limit=500`, { cache: 'no-store' }),
        fetch(`/api/investigations/${selectedId}/diagnosis`, { cache: 'no-store' }),
        fetch(`/api/investigations/${selectedId}/treatment-plans`, { cache: 'no-store' }),
      ]);
    if (detailResponse.ok) setSelected((await detailResponse.json()) as Investigation);
    if (eventsResponse.ok) setEvents((await eventsResponse.json()) as InvestigationEvent[]);
    if (toolsResponse.ok) setToolCalls((await toolsResponse.json()) as InvestigationToolCall[]);
    if (diagnosisResponse.ok) setDiagnosis((await diagnosisResponse.json()) as Diagnosis);
    else if (diagnosisResponse.status === 404) setDiagnosis(null);
    if (plansResponse.ok) setPlans((await plansResponse.json()) as TreatmentPlan[]);
  }, [selectedId]);

  useEffect(() => {
    void loadLists().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Investigation lookup failed.'),
    );
    const timer = window.setInterval(() => void loadLists(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadLists]);

  useEffect(() => {
    void loadSelected();
    const timer = window.setInterval(() => void loadSelected(), 3_000);
    return () => window.clearInterval(timer);
  }, [loadSelected]);

  const eligibleReproductions = useMemo(
    () =>
      reproductions.filter(
        (item) => item.result === SandboxResult.REPRODUCED && item.cleanup?.verifiedAbsent,
      ),
    [reproductions],
  );
  const active = useMemo(
    () => investigations.find((item) => !terminal.has(item.status)),
    [investigations],
  );
  const currentPlan = plans[0] ?? null;

  async function startInvestigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReproductionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/investigations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            reproductionId: selectedReproductionId,
            focusAreas: focusAreas
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
            ...(additionalContext.trim() ? { additionalContext: additionalContext.trim() } : {}),
          }),
        },
      );
      const body = (await response.json()) as Investigation | ErrorBody;
      if (!response.ok) throw new Error(messageFrom(body, 'Investigation request failed.'));
      setSelected(body as Investigation);
      setDiagnosis(null);
      setPlans([]);
      setEvents([]);
      setToolCalls([]);
      await loadLists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Investigation request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function lifecycleAction(action: 'cancel' | 'resume') {
    if (!selected) return;
    const response = await fetch(`/api/investigations/${selected.id}/${action}`, {
      method: 'POST',
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) setError(messageFrom(body, `Investigation ${action} failed.`));
    await loadSelected();
    await loadLists();
  }

  async function decidePlan(decision: PlanApprovalDecision) {
    if (!currentPlan) return;
    setDeciding(true);
    setError(null);
    const path =
      decision === PlanApprovalDecision.APPROVE
        ? 'approve'
        : decision === PlanApprovalDecision.REJECT
          ? 'reject'
          : 'request-revision';
    try {
      const response = await fetch(`/api/treatment-plans/${currentPlan.id}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: decisionComment, expectedVersion: currentPlan.version }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageFrom(body, 'Treatment-plan decision failed.'));
      await loadSelected();
      await loadLists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Treatment-plan decision failed.');
    } finally {
      setDeciding(false);
    }
  }

  return (
    <section className="investigationSection">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">EVIDENCE-GROUNDED INTELLIGENCE</p>
          <h2>Codex investigation and treatment governance</h2>
        </div>
        <span className="readOnlyBadge">READ-ONLY · HUMAN APPROVAL REQUIRED</span>
      </div>
      <div className="investigationGrid">
        <form
          className="panel incidentCreateForm"
          onSubmit={(event) => void startInvestigation(event)}
        >
          <label>
            Verified failure reproduction
            <select
              value={selectedReproductionId}
              onChange={(event) => setSelectedReproductionId(event.target.value)}
              required
            >
              <option value="">Select reproduced failure</option>
              {eligibleReproductions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id.slice(0, 8)} · {item.result} ·{' '}
                  {item.confidence === null ? 'unscored' : percentage(item.confidence)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Investigation focus areas
            <input
              value={focusAreas}
              onChange={(event) => setFocusAreas(event.target.value)}
              required
            />
          </label>
          <label>
            Operator context (optional and treated as untrusted input)
            <textarea
              value={additionalContext}
              onChange={(event) => setAdditionalContext(event.target.value)}
            />
          </label>
          <p className="policyNote">
            Agents receive only redacted, bounded evidence through tenant-scoped read-only tools.
            They cannot execute commands, modify files, access credentials, approve plans, or create
            pull requests.
          </p>
          {eligibleReproductions.length === 0 ? (
            <p className="formError">
              A completed reproduced failure with verified cleanup is required.
            </p>
          ) : null}
          {error ? <p className="formError">{error}</p> : null}
          <button disabled={submitting || Boolean(active) || !selectedReproductionId}>
            {submitting ? 'Admitting investigation…' : 'Start controlled investigation'}
          </button>
        </form>
        <article className="panel investigationRuns">
          <div className="panelHeader">
            <h3>Investigation history</h3>
            <span>{investigations.length}</span>
          </div>
          <div className="investigationRunList">
            {investigations.map((item) => (
              <button
                type="button"
                key={item.id}
                className={selected?.id === item.id ? 'selectedRun' : ''}
                onClick={() => {
                  setSelected(item);
                  setEvents([]);
                  setToolCalls([]);
                  setDiagnosis(null);
                  setPlans([]);
                }}
              >
                <span>{item.status.replaceAll('_', ' ')}</span>
                <strong>{item.id.slice(0, 8)}</strong>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </button>
            ))}
            {investigations.length === 0 ? <p>No investigations yet.</p> : null}
          </div>
        </article>
      </div>

      {selected ? (
        <>
          <section className="metricGrid investigationMetrics">
            <article>
              <span>Status</span>
              <strong>{selected.status.replaceAll('_', ' ')}</strong>
            </article>
            <article>
              <span>Input tokens</span>
              <strong>{selected.totalInputTokens.toLocaleString()}</strong>
            </article>
            <article>
              <span>Output tokens</span>
              <strong>{selected.totalOutputTokens.toLocaleString()}</strong>
            </article>
            <article>
              <span>Estimated cost</span>
              <strong>${selected.estimatedCostUsd.toFixed(4)}</strong>
            </article>
          </section>
          <div className="investigationEvidenceGrid">
            <article className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">DURABLE ORCHESTRATION</p>
                  <h3>Agent timeline</h3>
                </div>
                <div className="inlineActions">
                  {!terminal.has(selected.status) ? (
                    <button className="secondary" onClick={() => void lifecycleAction('cancel')}>
                      Cancel
                    </button>
                  ) : null}
                  {resumable.has(selected.status) ? (
                    <button className="secondary" onClick={() => void lifecycleAction('resume')}>
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
                <div>
                  <p className="eyebrow">AUDITED TOOLS</p>
                  <h3>Read-only calls</h3>
                </div>
                <span>{toolCalls.length}</span>
              </div>
              <ul className="evidenceList">
                {toolCalls.map((call) => (
                  <li key={call.id}>
                    <strong>{call.toolName}</strong>
                    <span>
                      {call.agentKind} · {call.status} · {call.durationMs ?? 0}ms
                    </span>
                    <code>{call.outputHash?.slice(0, 16) ?? call.inputHash.slice(0, 16)}…</code>
                  </li>
                ))}
                {toolCalls.length === 0 ? (
                  <li>Tool evidence will appear after context building.</li>
                ) : null}
              </ul>
            </article>
          </div>

          {diagnosis ? (
            <section className="panel diagnosisPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">CITATION-VALID DIAGNOSIS</p>
                  <h3>{diagnosis.summary}</h3>
                </div>
                <span className="confidenceBadge">
                  {diagnosis.confidenceBand} · {percentage(diagnosis.confidence)}
                </span>
              </div>
              <div className="diagnosisGrid">
                <div>
                  <h4>Failure mechanism</h4>
                  <p>{diagnosis.failureMechanism}</p>
                  <h4>Blast radius</h4>
                  <p>{diagnosis.blastRadius}</p>
                  <h4>Security impact</h4>
                  <p>{diagnosis.securityImpact}</p>
                </div>
                <div>
                  <h4>Competing hypotheses</h4>
                  <ol className="hypothesisList">
                    {diagnosis.hypotheses.map((hypothesis) => (
                      <li key={hypothesis.id}>
                        <strong>
                          {hypothesis.disposition} · {hypothesis.title}
                        </strong>
                        <span>{percentage(hypothesis.confidence)}</span>
                        <p>{hypothesis.mechanism}</p>
                        <small>
                          {hypothesis.supportingEvidence.length} supporting ·{' '}
                          {hypothesis.contradictingEvidence.length} contradicting ·{' '}
                          {hypothesis.missingEvidence.length} missing
                        </small>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <details>
                <summary>{diagnosis.citations.length} validated evidence citations</summary>
                <ul className="citationList">
                  {diagnosis.citations.map((citation, index) => (
                    <li key={`${citation.sourceId}-${index}`}>
                      <strong>{citation.label}</strong>
                      <code>
                        {citation.path
                          ? `${citation.path}${citation.lineStart ? `:${citation.lineStart}-${citation.lineEnd}` : ''}`
                          : citation.sourceType}
                      </code>
                      <span>{citation.digest.slice(0, 16)}…</span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ) : null}

          {currentPlan ? (
            <section className="panel planPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">VERSIONED TREATMENT PLAN</p>
                  <h3>{currentPlan.goal}</h3>
                </div>
                <span className={`riskBadge risk-${currentPlan.risk.toLowerCase()}`}>
                  {currentPlan.risk} · v{currentPlan.version}
                </span>
              </div>
              <ol className="planSteps">
                {currentPlan.steps.map((step) => (
                  <li key={step.sequence}>
                    <span>{step.sequence}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.objective}</p>
                      <small>{step.affectedComponents.join(', ')}</small>
                      <details>
                        <summary>Verification and rollback</summary>
                        <p>{step.expectedResults.join(' · ')}</p>
                        <p>{step.rollbackProcedure}</p>
                      </details>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="planGovernance">
                <div>
                  <strong>Rollback strategy</strong>
                  <p>{currentPlan.rollbackStrategy}</p>
                  <small>
                    Required approvals: {currentPlan.requiredApprovals} · Status:{' '}
                    {currentPlan.status}
                  </small>
                </div>
                {currentPlan.status === TreatmentPlanStatus.AWAITING_APPROVAL ? (
                  <div className="decisionControls">
                    <label>
                      Decision rationale
                      <textarea
                        value={decisionComment}
                        onChange={(event) => setDecisionComment(event.target.value)}
                      />
                    </label>
                    <div className="inlineActions">
                      <button
                        disabled={deciding || decisionComment.trim().length < 10}
                        onClick={() => void decidePlan(PlanApprovalDecision.APPROVE)}
                      >
                        Approve plan
                      </button>
                      <button
                        className="secondary"
                        disabled={deciding || decisionComment.trim().length < 10}
                        onClick={() => void decidePlan(PlanApprovalDecision.REQUEST_REVISION)}
                      >
                        Request revision
                      </button>
                      <button
                        className="dangerButton"
                        disabled={deciding || decisionComment.trim().length < 10}
                        onClick={() => void decidePlan(PlanApprovalDecision.REJECT)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
