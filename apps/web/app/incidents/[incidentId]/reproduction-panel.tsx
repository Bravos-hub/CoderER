'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  SandboxCommandPhase,
  SandboxExecutionStatus,
  SandboxNetworkMode,
  type Reproduction,
  type SandboxLogChunk,
} from '@codeer/contracts';

interface ReproductionListResponse {
  items: Reproduction[];
  nextCursor: string | null;
}
interface LogResponse {
  items: SandboxLogChunk[];
  nextSequence: number | null;
}

const terminal = new Set<SandboxExecutionStatus>([
  SandboxExecutionStatus.COMPLETED,
  SandboxExecutionStatus.POLICY_BLOCKED,
  SandboxExecutionStatus.CANCELLED,
  SandboxExecutionStatus.TIMED_OUT,
  SandboxExecutionStatus.INFRASTRUCTURE_FAILED,
  SandboxExecutionStatus.CLEANUP_FAILED,
]);

export function ReproductionPanel({ incidentId }: { incidentId: string }) {
  const [items, setItems] = useState<Reproduction[]>([]);
  const [selected, setSelected] = useState<Reproduction | null>(null);
  const [logs, setLogs] = useState<SandboxLogChunk[]>([]);
  const [expectedText, setExpectedText] = useState('npm error Missing script: "build:super"');
  const [script, setScript] = useState('build');
  const [image, setImage] = useState('node:24-bookworm-slim');
  const [allowInstallNetwork, setAllowInstallNetwork] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selected?.id;

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/incidents/${encodeURIComponent(incidentId)}/reproductions?limit=25`,
      { cache: 'no-store' },
    );
    const body = (await response.json()) as ReproductionListResponse | { message?: string };
    if (!response.ok)
      throw new Error('message' in body ? body.message : 'Reproduction lookup failed');
    const list = (body as ReproductionListResponse).items;
    setItems(list);
    if (!selectedId && list[0]) setSelected(list[0]);
    if (selectedId) {
      const detailResponse = await fetch(`/api/reproductions/${selectedId}`, {
        cache: 'no-store',
      });
      if (detailResponse.ok) setSelected((await detailResponse.json()) as Reproduction);
    }
  }, [incidentId, selectedId]);

  const loadLogs = useCallback(async () => {
    if (!selectedId) return;
    const response = await fetch(`/api/reproductions/${selectedId}/logs?limit=500`, {
      cache: 'no-store',
    });
    if (response.ok) setLogs(((await response.json()) as LogResponse).items);
  }, [selectedId]);

  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Reproduction lookup failed'),
    );
    const timer = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadLogs]);

  const active = useMemo(() => items.find((item) => !terminal.has(item.status)), [items]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/reproductions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            image,
            installCommands: [
              {
                phase: SandboxCommandPhase.INSTALL,
                executable: 'npm',
                arguments: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                workingDirectory: '.',
                networkMode: allowInstallNetwork
                  ? SandboxNetworkMode.RESTRICTED_INSTALL
                  : SandboxNetworkMode.NONE,
                expectedExitCodes: [0],
                environment: {},
              },
            ],
            reproductionCommands: [
              {
                phase: SandboxCommandPhase.REPRODUCE,
                executable: 'npm',
                arguments: ['run', script],
                workingDirectory: '.',
                networkMode: SandboxNetworkMode.NONE,
                expectedExitCodes: [1],
                environment: {},
              },
            ],
            failureSignature: { expectedText, minimumSimilarity: 0.8, requireNonZeroExit: true },
            networkPolicy: {
              mode: allowInstallNetwork
                ? SandboxNetworkMode.RESTRICTED_INSTALL
                : SandboxNetworkMode.NONE,
              allowedRegistries: allowInstallNetwork ? ['registry.npmjs.org'] : [],
              allowedDomains: allowInstallNetwork ? ['registry.npmjs.org'] : [],
              denyPrivateNetworks: true,
              denyMetadataServices: true,
            },
            repeatCount: 2,
            artifactPaths: ['package.json'],
          }),
        },
      );
      const body = (await response.json()) as Reproduction | { message?: string };
      if (!response.ok)
        throw new Error('message' in body ? body.message : 'Reproduction request failed');
      setSelected(body as Reproduction);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reproduction request failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!selected) return;
    const response = await fetch(`/api/reproductions/${selected.id}/cancel`, { method: 'POST' });
    if (!response.ok) setError('Cancellation request failed.');
    await load();
  }

  return (
    <section className="sandboxSection">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">HARDENED EXECUTION</p>
          <h2>Failure reproduction sandbox</h2>
        </div>
        <span>{active ? `Active · ${active.status}` : `${items.length} runs`}</span>
      </div>
      <div className="sandboxGrid">
        <form className="panel incidentCreateForm" onSubmit={(event) => void submit(event)}>
          <label>
            Digest-pinned runtime image
            <input value={image} onChange={(event) => setImage(event.target.value)} required />
          </label>
          <label>
            Reproduction script
            <input value={script} onChange={(event) => setScript(event.target.value)} required />
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={allowInstallNetwork}
              onChange={(event) => setAllowInstallNetwork(event.target.checked)}
            />
            Allow restricted registry egress only during dependency installation
          </label>
          <label>
            Original failure signature
            <textarea
              value={expectedText}
              onChange={(event) => setExpectedText(event.target.value)}
              required
            />
          </label>
          <p className="policyNote">
            Network disabled for reproduction · non-root · read-only rootfs · bounded CPU, memory,
            PIDs, logs and artifacts.
          </p>
          {error ? <p className="formError">{error}</p> : null}
          <button disabled={submitting || Boolean(active)}>
            {submitting ? 'Admitting…' : 'Start controlled reproduction'}
          </button>
        </form>
        <article className="panel sandboxRuns">
          <div className="panelHeader">
            <h3>Execution history</h3>
          </div>
          <div className="sandboxRunList">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setSelected(item);
                  setLogs([]);
                }}
                className={selected?.id === item.id ? 'selectedRun' : ''}
              >
                <span>{item.status}</span>
                <strong>{item.result ?? 'PENDING'}</strong>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </button>
            ))}
            {items.length === 0 ? <p>No sandbox executions yet.</p> : null}
          </div>
        </article>
      </div>
      {selected ? (
        <div className="sandboxEvidenceGrid">
          <article className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">POLICY</p>
                <h3>{selected.status}</h3>
              </div>
              {!terminal.has(selected.status) ? (
                <button className="secondary" onClick={() => void cancel()}>
                  Cancel
                </button>
              ) : null}
            </div>
            <dl className="compactDl">
              <div>
                <dt>Result</dt>
                <dd>{selected.result ?? 'Pending'}</dd>
              </div>
              <div>
                <dt>Image</dt>
                <dd>{selected.policyDecision.image}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{selected.policyDecision.networkPolicy.mode}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>
                  {selected.confidence === null
                    ? 'Pending'
                    : `${Math.round(selected.confidence * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Cleanup</dt>
                <dd>
                  {selected.cleanup
                    ? selected.cleanup.verifiedAbsent
                      ? 'Verified'
                      : 'Failed'
                    : 'Pending'}
                </dd>
              </div>
            </dl>
            {selected.policyDecision.reasons.length > 0 ? (
              <ul>
                {selected.policyDecision.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </article>
          <article className="panel terminalPanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">REDACTED STREAM</p>
                <h3>Sandbox logs</h3>
              </div>
              <span>{logs.length} chunks</span>
            </div>
            <pre>
              {logs
                .map((chunk) => `[${chunk.sequence.toString().padStart(4, '0')}] ${chunk.content}`)
                .join('')}
            </pre>
          </article>
          <article className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">PROVENANCE</p>
                <h3>Commands and artifacts</h3>
              </div>
            </div>
            <ul className="evidenceList">
              {selected.commands.map((command) => (
                <li key={command.id}>
                  <strong>
                    {command.executable} {command.arguments.join(' ')}
                  </strong>
                  <span>
                    {command.phase} · {command.status} · {command.durationMs}ms
                    {command.oomKilled ? ' · memory limit exceeded' : ''}
                  </span>
                  <code>{command.outputDigest.slice(0, 16)}…</code>
                </li>
              ))}
              {selected.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <strong>{artifact.path}</strong>
                  <span>
                    {artifact.byteSize} bytes · {artifact.retention}
                  </span>
                  <code>{artifact.digest.slice(0, 16)}…</code>
                </li>
              ))}
            </ul>
          </article>
        </div>
      ) : null}
    </section>
  );
}
