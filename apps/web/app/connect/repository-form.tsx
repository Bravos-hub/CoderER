'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { RepositoryIntakeView } from '@codeer/contracts';

export function RepositoryForm() {
  const [repositoryUrl, setRepositoryUrl] = useState('https://github.com/Bravos-hub/CoderER');
  const [baseBranch, setBaseBranch] = useState('main');
  const [result, setResult] = useState<RepositoryIntakeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/repositories/intakes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryUrl, baseBranch: baseBranch || undefined }),
      });
      const body = (await response.json()) as RepositoryIntakeView | { message?: string };
      if (!response.ok) {
        throw new Error(
          'message' in body && body.message ? body.message : 'Repository admission failed',
        );
      }
      const queued = body as RepositoryIntakeView;
      setResult(queued);
      let current = queued;
      for (
        let attempt = 0;
        attempt < 60 && !['READY', 'FAILED'].includes(current.status);
        attempt += 1
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const poll = await fetch(
          `/api/repositories/intakes/${encodeURIComponent(current.intakeId)}`,
          {
            cache: 'no-store',
          },
        );
        const next = (await poll.json()) as RepositoryIntakeView | { message?: string };
        if (!poll.ok)
          throw new Error(
            'message' in next && next.message ? next.message : 'Repository intake lookup failed',
          );
        current = next as RepositoryIntakeView;
        setResult(current);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Repository admission failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="connectForm" onSubmit={(event) => void submit(event)}>
      <label>
        GitHub repository URL
        <input
          required
          type="url"
          value={repositoryUrl}
          onChange={(event) => setRepositoryUrl(event.target.value)}
          placeholder="https://github.com/owner/repository"
        />
      </label>
      <label>
        Base branch
        <input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} />
      </label>
      <button disabled={submitting} type="submit">
        {submitting ? 'Admitting repository...' : 'Admit repository'}
      </button>
      {result ? (
        <output className="intakeResult">
          <strong>Intake queued</strong>
          <span>{result.intakeId}</span>
          <span>Status: {result.status}</span>
          {result.result?.repositoryId ? (
            <a href={`/incidents?repositoryId=${encodeURIComponent(result.result.repositoryId)}`}>
              Open incident command center
            </a>
          ) : null}
        </output>
      ) : null}
      {error ? <p className="formError">{error}</p> : null}
    </form>
  );
}
