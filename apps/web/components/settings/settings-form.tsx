'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  OrganizationSettingEnforcement,
  type OrganizationSetting,
  type OrganizationSettingKind,
} from '@codeer/contracts';
import { apiRequest } from '../../lib/client-api';
import { ErrorState, LoadingState } from '../ui/data-state';

interface SettingsFormProps {
  kind: OrganizationSettingKind;
  description: string;
  defaultConfiguration: Record<string, unknown>;
}

export function SettingsForm({ kind, description, defaultConfiguration }: SettingsFormProps) {
  const [setting, setSetting] = useState<OrganizationSetting | null>(null);
  const [enforcement, setEnforcement] = useState(OrganizationSettingEnforcement.ENFORCED);
  const [draftDescription, setDraftDescription] = useState(description);
  const [configuration, setConfiguration] = useState(JSON.stringify(defaultConfiguration, null, 2));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback(
    (value: OrganizationSetting | null) => {
      setSetting(value);
      setEnforcement(value?.enforcement ?? OrganizationSettingEnforcement.ENFORCED);
      setDraftDescription(value?.description ?? description);
      setConfiguration(JSON.stringify(value?.configuration ?? defaultConfiguration, null, 2));
    },
    [defaultConfiguration, description],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      apply(await apiRequest<OrganizationSetting | null>(`settings/${kind}`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  }, [apply, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const parsedConfiguration: unknown = JSON.parse(configuration);
      if (
        !parsedConfiguration ||
        Array.isArray(parsedConfiguration) ||
        typeof parsedConfiguration !== 'object'
      ) {
        throw new Error('Configuration must be a JSON object.');
      }
      const next = await apiRequest<OrganizationSetting>(`settings/${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: setting?.version ?? 0,
          enforcement,
          description: draftDescription,
          configuration: parsedConfiguration,
        }),
      });
      apply(next);
      setNotice(
        `Version ${next.version} saved with immutable digest ${next.contentHash.slice(0, 12)}…`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading current policy…" />;
  if (error && !setting) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <section className="settingsGrid">
      <form className="panel" onSubmit={(event) => void save(event)}>
        <h2>Current policy</h2>
        <div className="formGrid">
          <label>
            Policy version
            <input value={`v${setting?.version ?? 0}`} readOnly />
          </label>
          <label>
            Enforcement
            <select
              value={enforcement}
              onChange={(event) =>
                setEnforcement(event.target.value as OrganizationSettingEnforcement)
              }
            >
              <option value={OrganizationSettingEnforcement.ENFORCED}>Enforced</option>
              <option value={OrganizationSettingEnforcement.MONITOR}>Monitor only</option>
            </select>
          </label>
          <label className="full">
            Description
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              required
            />
          </label>
          <label className="full">
            Policy configuration (JSON)
            <textarea
              className="settingsJson"
              value={configuration}
              onChange={(event) => setConfiguration(event.target.value)}
              spellCheck={false}
              required
            />
          </label>
        </div>
        {error ? (
          <p className="formError" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="formNotice" role="status">
            {notice}
          </p>
        ) : null}
        <div className="pageActions">
          <button
            type="button"
            className="secondary"
            onClick={() => apply(setting)}
            disabled={saving}
          >
            Discard
          </button>
          <button disabled={saving}>{saving ? 'Saving…' : 'Save new version'}</button>
        </div>
      </form>
      <aside className="panel">
        <p className="eyebrow">GOVERNANCE</p>
        <h2>Versioned changes</h2>
        <p>
          Every save appends a tenant-scoped immutable version protected by optimistic concurrency.
        </p>
        <ul className="safetyList">
          <li>Trusted administrator required</li>
          <li>Previous versions retained</li>
          <li>SHA-256 content digest</li>
          <li>Forced row-level security</li>
        </ul>
        {setting ? (
          <dl className="compactDl">
            <div>
              <dt>Saved by</dt>
              <dd>{setting.createdBy}</dd>
            </div>
            <div>
              <dt>Saved at</dt>
              <dd>{new Date(setting.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
        ) : null}
      </aside>
    </section>
  );
}
