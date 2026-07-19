'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Investigation, RecoveryRun } from '@codeer/contracts';
import { apiRequest } from '../../lib/client-api';
import { EmptyState, ErrorState, LoadingState } from '../ui/data-state';
import { StatusBadge } from '../ui/status';

interface PublicationView {
  id: string;
  incidentId: string;
  recoveryId: string;
  status: string;
  baseBranch: string;
  headBranch: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  patchDigest: string;
  updatedAt: string;
}

export function InvestigationList() {
  const [items, setItems] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ items: Investigation[] }>('investigations?limit=100');
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load investigations.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!items.length)
    return (
      <EmptyState
        title="No investigations"
        description="No investigation runs are available for this organization."
      />
    );
  return (
    <div className="resourceTable" role="list">
      {items.map((item) => (
        <Link
          role="listitem"
          className="resourceRow"
          key={item.id}
          href={`/incidents/${item.incidentId}/investigation`}
        >
          <div>
            <strong>Investigation {item.id.slice(0, 8)}</strong>
            <span>
              Policy {item.policyVersion} · {item.totalInputTokens + item.totalOutputTokens} tokens
              · ${item.estimatedCostUsd.toFixed(2)}
            </span>
            <small>Updated {new Date(item.updatedAt).toLocaleString()}</small>
          </div>
          <StatusBadge value={item.status} />
        </Link>
      ))}
    </div>
  );
}

export function RecoveryList() {
  const [items, setItems] = useState<RecoveryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ items: RecoveryRun[] }>('recoveries?limit=100');
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load recoveries.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!items.length)
    return (
      <EmptyState
        title="No recoveries"
        description="No controlled recoveries are available for this organization."
      />
    );
  return (
    <div className="resourceTable" role="list">
      {items.map((item) => (
        <Link
          role="listitem"
          className="resourceRow"
          key={item.id}
          href={`/incidents/${item.incidentId}/recovery`}
        >
          <div>
            <strong>{item.branchName}</strong>
            <span>
              Patch v{item.patchVersion ?? 'pending'} · Plan v{item.treatmentPlanVersion} · Recovery
              v{item.version}
            </span>
            <small>
              <code>{item.baseCommitSha.slice(0, 12)}…</code> · Updated{' '}
              {new Date(item.updatedAt).toLocaleString()}
            </small>
          </div>
          <StatusBadge value={item.status} />
        </Link>
      ))}
    </div>
  );
}

export function PublicationList() {
  const [items, setItems] = useState<PublicationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiRequest<PublicationView[]>('publications?limit=100'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load publications.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!items.length)
    return (
      <EmptyState
        title="No publications"
        description="No governed GitHub publications are available for this organization."
      />
    );
  return (
    <div className="resourceTable" role="list">
      {items.map((item) => (
        <Link
          role="listitem"
          className="resourceRow"
          key={item.id}
          href={`/incidents/${item.incidentId}/publication`}
        >
          <div>
            <strong>
              {item.headBranch} → {item.baseBranch}
            </strong>
            <span>
              {item.pullRequestNumber
                ? `Pull request #${item.pullRequestNumber}`
                : 'Draft pull request pending'}{' '}
              · <code>{item.patchDigest.slice(0, 12)}…</code>
            </span>
            <small>Updated {new Date(item.updatedAt).toLocaleString()}</small>
          </div>
          <StatusBadge value={item.status} />
        </Link>
      ))}
    </div>
  );
}
