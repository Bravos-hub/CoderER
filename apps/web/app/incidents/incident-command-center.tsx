'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  type Incident,
  type IncidentList,
} from '@codeer/contracts';

interface CreateFormState {
  repositoryId: string;
  title: string;
  description: string;
  environment: 'development' | 'test' | 'staging' | 'production';
  deploymentBlocked: boolean;
  failingTests: boolean;
  authenticationBroken: boolean;
  securityExposure: boolean;
}

const initialForm: CreateFormState = {
  repositoryId: '',
  title: '',
  description: '',
  environment: 'production',
  deploymentBlocked: true,
  failingTests: false,
  authenticationBroken: false,
  securityExposure: false,
};

function severityClass(severity: IncidentSeverity): string {
  return `severity severity-${severity.replace('-', '').toLowerCase()}`;
}

export function IncidentCommandCenter() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [form, setForm] = useState<CreateFormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/incidents?limit=50', { cache: 'no-store' });
      const body = (await response.json()) as IncidentList | { message?: string };
      if (!response.ok)
        throw new Error('message' in body ? body.message : 'Incident lookup failed');
      setIncidents((body as IncidentList).items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Incident lookup failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => {
    const terminalStatuses = new Set<IncidentStatus>([
      IncidentStatus.VERIFIED,
      IncidentStatus.CANCELLED,
    ]);
    return {
      active: incidents.filter((incident) => !terminalStatuses.has(incident.status)).length,
      critical: incidents.filter((incident) => incident.severity === IncidentSeverity.SEV1).length,
      investigating: incidents.filter(
        (incident) => incident.status === IncidentStatus.INVESTIGATING,
      ).length,
      verified: incidents.filter((incident) => incident.status === IncidentStatus.VERIFIED).length,
    };
  }, [incidents]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          repositoryId: form.repositoryId,
          title: form.title,
          description: form.description,
          source: IncidentSource.MANUAL,
          impact: {
            availability: form.authenticationBroken ? 4 : form.deploymentBlocked ? 2 : 1,
            affectedUsers: form.authenticationBroken ? 1000 : 0,
            revenueImpact: form.environment === 'production' ? 2 : 0,
            dataIntegrity: 0,
            securityImpact: form.securityExposure ? 5 : 0,
            environment: form.environment,
          },
          signals: {
            deploymentBlocked: form.deploymentBlocked,
            failingTests: form.failingTests,
            authenticationBroken: form.authenticationBroken,
            securityExposure: form.securityExposure,
            productionUnavailable: form.environment === 'production' && form.authenticationBroken,
          },
        }),
      });
      const body = (await response.json()) as Incident | { message?: string };
      if (!response.ok)
        throw new Error('message' in body ? body.message : 'Incident creation failed');
      setForm(initialForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Incident creation failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="commandHeader">
        <div>
          <p className="eyebrow">LIVE OPERATIONS</p>
          <h1 className="commandTitle">Software incident response.</h1>
          <p className="lede">
            Admit a failure, preserve evidence, calculate severity and repository health, then move
            into controlled diagnosis.
          </p>
        </div>
        <button className="secondary" type="button" onClick={() => void load()}>
          Refresh evidence
        </button>
      </section>

      <section className="metricGrid" aria-label="Incident metrics">
        <article>
          <span>Active incidents</span>
          <strong>{summary.active}</strong>
        </article>
        <article>
          <span>SEV-1 critical</span>
          <strong>{summary.critical}</strong>
        </article>
        <article>
          <span>Investigating</span>
          <strong>{summary.investigating}</strong>
        </article>
        <article>
          <span>Verified recoveries</span>
          <strong>{summary.verified}</strong>
        </article>
      </section>

      <section className="commandGrid">
        <article className="panel incidentTablePanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">ACTIVE CASES</p>
              <h2>Incident queue</h2>
            </div>
            <span>{loading ? 'Synchronizing…' : `${incidents.length} records`}</span>
          </div>
          {incidents.length === 0 && !loading ? (
            <div className="emptyState">
              <strong>No incidents admitted.</strong>
              <span>Create the first evidence-backed software incident.</span>
            </div>
          ) : (
            <div className="incidentTable" role="table">
              {incidents.map((incident) => (
                <Link className="incidentRow" href={`/incidents/${incident.id}`} key={incident.id}>
                  <div>
                    <strong>{incident.shortCode}</strong>
                    <span>{incident.title}</span>
                  </div>
                  <span className={severityClass(incident.severity)}>{incident.severity}</span>
                  <span>{incident.status}</span>
                  <span>{incident.stage}</span>
                  <time>{new Date(incident.lastActivityAt).toLocaleString()}</time>
                </Link>
              ))}
            </div>
          )}
        </article>

        <form className="panel incidentCreateForm" onSubmit={(event) => void submit(event)}>
          <div className="panelHeader">
            <div>
              <p className="eyebrow">ADMIT</p>
              <h2>New incident</h2>
            </div>
          </div>
          <label>
            Repository ID
            <input
              required
              value={form.repositoryId}
              onChange={(event) => setForm({ ...form, repositoryId: event.target.value })}
              placeholder="UUID returned by repository intake"
            />
          </label>
          <label>
            Incident title
            <input
              required
              minLength={3}
              maxLength={160}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Production build blocked"
            />
          </label>
          <label>
            Description
            <textarea
              required
              minLength={3}
              maxLength={10000}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Describe the observed failure and its impact."
            />
          </label>
          <label>
            Environment
            <select
              value={form.environment}
              onChange={(event) =>
                setForm({
                  ...form,
                  environment: event.target.value as CreateFormState['environment'],
                })
              }
            >
              <option value="development">Development</option>
              <option value="test">Test</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </label>
          <div className="signalGrid">
            {(
              [
                ['deploymentBlocked', 'Deployment blocked'],
                ['failingTests', 'Tests failing'],
                ['authenticationBroken', 'Authentication broken'],
                ['securityExposure', 'Security exposure'],
              ] as const
            ).map(([key, label]) => (
              <label className="checkLabel" key={key}>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <button disabled={submitting} type="submit">
            {submitting ? 'Admitting incident…' : 'Admit and queue triage'}
          </button>
          {error ? <p className="formError">{error}</p> : null}
        </form>
      </section>
    </>
  );
}
