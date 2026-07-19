'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function JudgeLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/judge/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Judge login failed.');
      window.location.assign('/incidents');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Judge login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="commandCenter shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandMark" aria-hidden="true" />
          <span>
            Code<span className="er">ER</span>
          </span>
        </Link>
        <span className="environment">JUDGE ACCESS</span>
      </header>
      <section className="panel span2">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">COMPETITION DEMO</p>
            <h1>Judge sign-in</h1>
          </div>
          <span className="readOnlyBadge">INCIDENT COMMANDER · NO OWNER ROLE</span>
        </div>
        <p>
          Use the credentials supplied through the private judging channel. This creates a
          short-lived signed human session with workflow permissions needed for the demo, without
          organization-owner privileges.
        </p>
        <form className="incidentCreateForm" onSubmit={(event) => void submit(event)}>
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="formError">{error}</p> : null}
          <button disabled={submitting}>{submitting ? 'Signing in…' : 'Open demo'}</button>
        </form>
      </section>
    </main>
  );
}
