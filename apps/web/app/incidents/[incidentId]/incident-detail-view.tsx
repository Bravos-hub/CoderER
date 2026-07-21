'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IncidentDetail } from '@codeer/contracts';
import { isSeededReplayIncident } from '../../../lib/demo-replay';
import { SeededReplayBanner } from '../../../components/domain/seeded-replay-banner';
import { ReproductionPanel } from './reproduction-panel';
import { InvestigationPanel } from './investigation-panel';
import { RecoveryPanel } from './recovery-panel';

export function IncidentDetailView({ incidentId }: { incidentId: string }) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triaging, setTriaging] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as IncidentDetail | { message?: string };
      if (!response.ok)
        throw new Error('message' in body ? body.message : 'Incident lookup failed');
      setDetail(body as IncidentDetail);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Incident lookup failed');
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function retriage() {
    setTriaging(true);
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/triage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (!response.ok) throw new Error('Triage request failed');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Triage request failed');
    } finally {
      setTriaging(false);
    }
  }

  if (error && !detail)
    return (
      <section className="emptyState detailEmpty">
        <strong>Incident unavailable</strong>
        <span>{error}</span>
      </section>
    );
  if (!detail)
    return (
      <section className="emptyState detailEmpty">
        <strong>Loading incident evidence…</strong>
      </section>
    );

  const { incident, latestHealthSnapshot, latestSeverityAssessment } = detail;
  return (
    <>
      {isSeededReplayIncident(incidentId) ? <SeededReplayBanner /> : null}
      <section className="incidentDetailHeader">
        <div>
          <p className="eyebrow">{incident.shortCode}</p>
          <h1 className="detailTitle">{incident.title}</h1>
          <p className="lede">{incident.description}</p>
        </div>
        <div className="detailActions">
          <span className={`severity severity-${incident.severity.replace('-', '').toLowerCase()}`}>
            {incident.severity}
          </span>
          <button disabled={triaging} onClick={() => void retriage()}>
            {triaging ? 'Queueing…' : 'Run triage again'}
          </button>
        </div>
      </section>
      <section className="metricGrid detailMetrics">
        <article>
          <span>Status</span>
          <strong>{incident.status}</strong>
        </article>
        <article>
          <span>Stage</span>
          <strong>{incident.stage}</strong>
        </article>
        <article>
          <span>Severity score</span>
          <strong>{incident.severityScore}/100</strong>
        </article>
        <article>
          <span>Repository health</span>
          <strong>
            {latestHealthSnapshot ? `${latestHealthSnapshot.overallScore}/100` : 'Pending'}
          </strong>
        </article>
      </section>
      <section className="detailGrid">
        <article className="panel timelinePanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">IMMUTABLE CHAIN</p>
              <h2>Evidence timeline</h2>
            </div>
            <span
              className={detail.timelineIntegrity.valid ? 'integrityValid' : 'integrityInvalid'}
            >
              {detail.timelineIntegrity.valid
                ? `Verified · ${detail.timelineIntegrity.checkedEvents} events`
                : `Integrity failure at #${detail.timelineIntegrity.brokenSequence ?? 'unknown'}`}
            </span>
          </div>
          <ol className="timeline">
            {detail.timeline.map((event) => (
              <li key={event.id}>
                <span>{String(event.sequence).padStart(2, '0')}</span>
                <div>
                  <strong>{event.type.replaceAll('_', ' ')}</strong>
                  <time>{new Date(event.occurredAt).toLocaleString()}</time>
                  <code>{event.eventHash.slice(0, 16)}…</code>
                </div>
              </li>
            ))}
          </ol>
        </article>
        <div className="detailSide">
          <article className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">ASSESSMENT</p>
                <h2>Severity policy</h2>
              </div>
            </div>
            <p>{latestSeverityAssessment?.rationale ?? incident.severityReason}</p>
            <dl className="compactDl">
              <div>
                <dt>Policy</dt>
                <dd>{latestSeverityAssessment?.policyVersion ?? 'admission'}</dd>
              </div>
              <div>
                <dt>Calculated</dt>
                <dd>{latestSeverityAssessment?.calculatedSeverity ?? incident.severity}</dd>
              </div>
              <div>
                <dt>Override</dt>
                <dd>{latestSeverityAssessment?.overrideApplied ? 'Applied' : 'None'}</dd>
              </div>
            </dl>
          </article>
          <article className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">COLLECTED</p>
                <h2>Evidence</h2>
              </div>
              <span>{detail.evidence.length}</span>
            </div>
            <ul className="evidenceList">
              {detail.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <strong>{evidence.title}</strong>
                  <span>
                    {evidence.kind} · {evidence.sensitivity}
                  </span>
                  <code>{evidence.digest.slice(0, 16)}…</code>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>
      <ReproductionPanel incidentId={incidentId} />
      <InvestigationPanel incidentId={incidentId} />
      <RecoveryPanel incidentId={incidentId} />
    </>
  );
}
