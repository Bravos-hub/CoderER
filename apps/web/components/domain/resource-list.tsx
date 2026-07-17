'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../lib/client-api';
import { EmptyState, ErrorState, LoadingState } from '../ui/data-state';
import { StatusBadge } from '../ui/status';

type JsonRecord = Record<string, unknown>;

function scalar(value: unknown, fallback = ''): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value))
    return value.filter((item): item is JsonRecord => Boolean(item && typeof item === 'object'));
  if (value && typeof value === 'object') {
    for (const key of [
      'items',
      'data',
      'incidents',
      'repositories',
      'recoveries',
      'publications',
      'investigations',
    ]) {
      const candidate = (value as JsonRecord)[key];
      if (Array.isArray(candidate)) return asRecords(candidate);
    }
  }
  return [];
}

export function ResourceList({
  endpoint,
  kind,
  detailBase,
}: {
  endpoint: string;
  kind: string;
  detailBase?: string;
}) {
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(asRecords(await apiRequest(endpoint)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to load ${kind}`);
    } finally {
      setLoading(false);
    }
  }, [endpoint, kind]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!items.length)
    return (
      <EmptyState
        title={`No ${kind}`}
        description={`No ${kind} are currently available for this organization.`}
      />
    );
  return (
    <div className="resourceTable" role="table">
      {items.map((item, index) => {
        const id = scalar(
          item.id ?? item.incidentId ?? item.repositoryId ?? item.recoveryId ?? item.publicationId,
          String(index),
        );
        const title = scalar(
          item.title ?? item.name ?? item.shortCode ?? item.branchName,
          `${kind} ${index + 1}`,
        );
        const status = scalar(item.status ?? item.stage ?? item.state, 'ACTIVE');
        const subtitle = scalar(
          item.description ?? item.repositoryName ?? item.baseBranch ?? item.updatedAt,
        );
        const content = (
          <>
            <div>
              <strong>{title}</strong>
              <span>{subtitle}</span>
            </div>
            <StatusBadge value={status} />
          </>
        );
        return detailBase ? (
          <Link className="resourceRow" role="row" key={id} href={`${detailBase}/${id}`}>
            {content}
          </Link>
        ) : (
          <div className="resourceRow" role="row" key={id}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
