'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../lib/client-api';
import { ErrorState, LoadingState } from '../ui/data-state';
export function JsonInspector({ endpoint, title }: { endpoint: string; title: string }) {
  const [data, setData] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiRequest(endpoint));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    }
  }, [endpoint]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (data === undefined) return <LoadingState />;
  return (
    <article className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">LIVE API DATA</p>
          <h2>{title}</h2>
        </div>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <pre className="jsonInspector">{JSON.stringify(data, null, 2)}</pre>
    </article>
  );
}
