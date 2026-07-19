'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  IncidentDetail,
  PullRequestPackage,
  RecoveryRun,
  RecoveryVerificationReport,
} from '@codeer/contracts';
import { InvestigationPanel } from '../../app/incidents/[incidentId]/investigation-panel';
import { RecoveryPanel } from '../../app/incidents/[incidentId]/recovery-panel';
import { ReproductionPanel } from '../../app/incidents/[incidentId]/reproduction-panel';
import { apiRequest } from '../../lib/client-api';
import { EmptyState, ErrorState, LoadingState } from '../ui/data-state';
import { StatusBadge } from '../ui/status';

type RecoveryList = { items: RecoveryRun[]; nextCursor: string | null };
type RecoveryDetail = {
  recovery: RecoveryRun;
  verification: RecoveryVerificationReport | null;
  pullRequestPackage: PullRequestPackage | null;
};

function IncidentRecordView({ incidentId, section }: { incidentId: string; section: string }) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setDetail(await apiRequest<IncidentDetail>(`incidents/${incidentId}`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Incident lookup failed.');
    }
  }, [incidentId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return <LoadingState label="Loading incident evidence…" />;

  if (section === 'evidence') {
    return detail.evidence.length ? (
      <section className="evidenceCards" aria-label="Incident evidence">
        {detail.evidence.map((item) => (
          <article className="panel evidenceCard" key={item.id}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">
                  {item.source} · {item.kind}
                </p>
                <h2>{item.title}</h2>
              </div>
              <StatusBadge value={item.sensitivity} />
            </div>
            <p>{item.summary}</p>
            <dl className="compactDl">
              <div>
                <dt>Observed</dt>
                <dd>{new Date(item.observedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Payload</dt>
                <dd>{item.byteSize.toLocaleString()} bytes</dd>
              </div>
              <div>
                <dt>Digest</dt>
                <dd>
                  <code>{item.digest.slice(0, 16)}…</code>
                </dd>
              </div>
              <div>
                <dt>Redaction</dt>
                <dd>{item.redacted ? `${item.redactionCount} value(s)` : 'None'}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    ) : (
      <EmptyState
        title="No evidence"
        description="No evidence has been attached to this incident."
      />
    );
  }

  if (section === 'triage') {
    const assessment = detail.latestSeverityAssessment;
    const health = detail.latestHealthSnapshot;
    return (
      <section className="dashboardGrid">
        <article className="panel">
          <p className="eyebrow">SEVERITY ASSESSMENT</p>
          <h2>{assessment?.severity ?? detail.incident.severity}</h2>
          <p>{assessment?.rationale ?? detail.incident.severityReason}</p>
          <dl className="compactDl">
            <div>
              <dt>Score</dt>
              <dd>{assessment?.score ?? detail.incident.severityScore}/100</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{assessment?.policyVersion ?? 'Admission'}</dd>
            </div>
            <div>
              <dt>Override</dt>
              <dd>{assessment?.overrideApplied ? 'Applied' : 'None'}</dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <p className="eyebrow">REPOSITORY HEALTH</p>
          <h2>{health ? `${health.overallScore}/100` : 'Pending'}</h2>
          {health ? (
            <dl className="compactDl">
              {Object.entries(health.dimensions).map(([name, score]) => (
                <div key={name}>
                  <dt>{name.replaceAll(/([A-Z])/g, ' $1')}</dt>
                  <dd>{score}/100</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>Health evidence has not been calculated yet.</p>
          )}
        </article>
      </section>
    );
  }

  if (section === 'activity') {
    return (
      <article className="panel timelinePanel">
        <div className="panelHeader">
          <h2>Immutable activity</h2>
          <span className={detail.timelineIntegrity.valid ? 'integrityValid' : 'integrityInvalid'}>
            {detail.timelineIntegrity.valid ? 'Chain verified' : 'Integrity failure'}
          </span>
        </div>
        <ol className="timeline">
          {detail.timeline.map((item) => (
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
    );
  }

  return (
    <section className="dashboardGrid">
      <article className="panel span2">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">{detail.incident.shortCode}</p>
            <h2>{detail.incident.title}</h2>
          </div>
          <StatusBadge value={detail.incident.status} />
        </div>
        <p>{detail.incident.description}</p>
      </article>
      <article className="panel">
        <h2>Response state</h2>
        <dl className="compactDl">
          <div>
            <dt>Stage</dt>
            <dd>{detail.incident.stage}</dd>
          </div>
          <div>
            <dt>Severity</dt>
            <dd>{detail.incident.severity}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{detail.incident.version}</dd>
          </div>
        </dl>
      </article>
      <article className="panel">
        <h2>Evidence integrity</h2>
        <dl className="compactDl">
          <div>
            <dt>Evidence records</dt>
            <dd>{detail.evidence.length}</dd>
          </div>
          <div>
            <dt>Events checked</dt>
            <dd>{detail.timelineIntegrity.checkedEvents}</dd>
          </div>
          <div>
            <dt>Chain</dt>
            <dd>{detail.timelineIntegrity.valid ? 'Verified' : 'Invalid'}</dd>
          </div>
        </dl>
      </article>
    </section>
  );
}

function RecoveryArtifactView({
  incidentId,
  mode,
}: {
  incidentId: string;
  mode: 'verification' | 'publication';
}) {
  const [details, setDetails] = useState<RecoveryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiRequest<RecoveryList>(`incidents/${incidentId}/recoveries?limit=50`);
      const values = await Promise.all(
        list.items.map((item) => apiRequest<RecoveryDetail>(`recoveries/${item.id}`)),
      );
      setDetails(values);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to load ${mode} records.`);
    } finally {
      setLoading(false);
    }
  }, [incidentId, mode]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState label={`Loading ${mode} records…`} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  const available = details.filter((item) =>
    mode === 'verification' ? item.verification : item.pullRequestPackage,
  );
  if (!available.length)
    return (
      <EmptyState
        title={`No ${mode} record`}
        description={`The recovery pipeline has not produced a ${mode} artifact yet.`}
      />
    );
  return (
    <section className="evidenceCards">
      {available.map((item) =>
        mode === 'verification' && item.verification ? (
          <article className="panel verificationPanel" key={item.recovery.id}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">RECOVERY {item.recovery.id.slice(0, 8)}</p>
                <h2>Verification matrix</h2>
              </div>
              <StatusBadge value={item.verification.status} />
            </div>
            <p>{item.verification.summary}</p>
            <div className="verificationTable">
              {item.verification.checks.map((check) => (
                <div key={check.id}>
                  <strong>{check.name}</strong>
                  <StatusBadge value={check.status} />
                  <small>{check.summary}</small>
                </div>
              ))}
            </div>
            <dl className="compactDl">
              <div>
                <dt>Original failure</dt>
                <dd>{item.verification.originalFailureResolved ? 'Resolved' : 'Unresolved'}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round(item.verification.confidence * 100)}%</dd>
              </div>
              <div>
                <dt>Scope expanded</dt>
                <dd>{item.verification.scopeExpanded ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </article>
        ) : item.pullRequestPackage ? (
          <article className="panel prPackagePanel" key={item.recovery.id}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">REVIEW PACKAGE v{item.pullRequestPackage.version}</p>
                <h2>{item.pullRequestPackage.title}</h2>
              </div>
              <StatusBadge value={item.recovery.status} />
            </div>
            <p>{item.pullRequestPackage.rootCauseSummary}</p>
            <dl className="compactDl">
              <div>
                <dt>Base branch</dt>
                <dd>{item.pullRequestPackage.baseBranch}</dd>
              </div>
              <div>
                <dt>Head branch</dt>
                <dd>{item.pullRequestPackage.headBranch}</dd>
              </div>
              <div>
                <dt>Changed files</dt>
                <dd>{item.pullRequestPackage.changedFiles.length}</dd>
              </div>
              <div>
                <dt>Package digest</dt>
                <dd>
                  <code>{item.pullRequestPackage.packageHash.slice(0, 16)}…</code>
                </dd>
              </div>
            </dl>
            <h3>Verification</h3>
            <p>{item.pullRequestPackage.verificationSummary}</p>
            <h3>Rollback</h3>
            <p>{item.pullRequestPackage.rollbackInstructions}</p>
          </article>
        ) : null,
      )}
    </section>
  );
}

export function IncidentSectionContent({
  incidentId,
  section,
}: {
  incidentId: string;
  section: string;
}) {
  if (section === 'reproduction') return <ReproductionPanel incidentId={incidentId} />;
  if (section === 'investigation' || section === 'treatment-plan')
    return <InvestigationPanel incidentId={incidentId} />;
  if (section === 'recovery') return <RecoveryPanel incidentId={incidentId} />;
  if (section === 'verification')
    return <RecoveryArtifactView incidentId={incidentId} mode="verification" />;
  if (section === 'publication')
    return <RecoveryArtifactView incidentId={incidentId} mode="publication" />;
  return <IncidentRecordView incidentId={incidentId} section={section} />;
}
