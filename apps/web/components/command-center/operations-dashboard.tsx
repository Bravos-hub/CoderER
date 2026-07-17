'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/client-api';

type Dashboard = {
  repositories?: unknown[];
  incidents?: unknown[];
  recoveries?: unknown[];
  publications?: unknown[];
};
export function OperationsDashboard() {
  const [data, setData] = useState<Dashboard>({});
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      const entries = await Promise.allSettled([
        apiRequest<unknown[]>('repositories'),
        apiRequest<unknown[]>('incidents'),
        apiRequest<unknown[]>('recoveries'),
        apiRequest<unknown[]>('publications'),
      ]);
      if (!active) return;
      setConnected(entries.some((entry) => entry.status === 'fulfilled'));
      setData({
        repositories: entries[0].status === 'fulfilled' ? entries[0].value : [],
        incidents: entries[1].status === 'fulfilled' ? entries[1].value : [],
        recoveries: entries[2].status === 'fulfilled' ? entries[2].value : [],
        publications: entries[3].status === 'fulfilled' ? entries[3].value : [],
      });
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const count = (value?: unknown[]) => (Array.isArray(value) ? value.length : 0);
  return (
    <>
      {!connected && (
        <div className="connectionBanner">
          Backend unavailable. Command center is showing a degraded state and will retry
          automatically.
        </div>
      )}
      <section className="metricGrid commandMetrics">
        <article>
          <span>Repositories</span>
          <strong>{count(data.repositories)}</strong>
          <small>Connected sources</small>
        </article>
        <article>
          <span>Active incidents</span>
          <strong>{count(data.incidents)}</strong>
          <small>Across all severities</small>
        </article>
        <article>
          <span>Recoveries</span>
          <strong>{count(data.recoveries)}</strong>
          <small>Controlled executions</small>
        </article>
        <article>
          <span>Publications</span>
          <strong>{count(data.publications)}</strong>
          <small>GitHub lifecycle</small>
        </article>
      </section>
      <section className="dashboardGrid">
        <article className="panel span2">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">OPERATIONS</p>
              <h2>Response pipeline</h2>
            </div>
            <Link href="/incidents">View incidents</Link>
          </div>
          <div className="pipeline">
            {['Admit', 'Triage', 'Reproduce', 'Investigate', 'Recover', 'Publish', 'Verify'].map(
              (stage, index) => (
                <div key={stage}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{stage}</strong>
                </div>
              ),
            )}
          </div>
        </article>
        <article className="panel">
          <p className="eyebrow">HUMAN ACTION</p>
          <h2>Approval queue</h2>
          <p>Review treatment plans, recovery publication requests and policy exceptions.</p>
          <Link className="buttonLink" href="/approvals">
            Open approvals
          </Link>
        </article>
        <article className="panel">
          <p className="eyebrow">INTEGRATION</p>
          <h2>GitHub App</h2>
          <p>
            Validate installation, webhook delivery and repository access from one guided workspace.
          </p>
          <Link className="buttonLink secondaryLink" href="/integrations/github">
            Configure integration
          </Link>
        </article>
      </section>
    </>
  );
}
