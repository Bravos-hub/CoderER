import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="ORGANIZATION POLICY"
        title="Security settings"
        description="Trusted identity, sessions, roles, integrations and audit retention."
      />
      <section className="settingsGrid">
        <article className="panel">
          <h2>Current policy</h2>
          <div className="formGrid">
            <label>
              Policy version
              <input defaultValue="v1" readOnly />
            </label>
            <label>
              Enforcement
              <select defaultValue="enforced">
                <option value="enforced">Enforced</option>
                <option value="monitor">Monitor only</option>
              </select>
            </label>
            <label className="full">
              Description
              <textarea defaultValue="Trusted identity, sessions, roles, integrations and audit retention." />
            </label>
          </div>
          <div className="pageActions">
            <button className="secondary">Discard</button>
            <button>Save new version</button>
          </div>
        </article>
        <aside className="panel">
          <p className="eyebrow">GOVERNANCE</p>
          <h2>Versioned changes</h2>
          <p>
            Updates are optimistic-concurrency protected, tenant scoped and recorded in the audit
            chain.
          </p>
          <ul className="safetyList">
            <li>Human actor required</li>
            <li>Previous version retained</li>
            <li>Server authorization enforced</li>
            <li>Conflict-safe updates</li>
          </ul>
        </aside>
      </section>
    </AppShell>
  );
}
