import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
export default function AuditPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="IMMUTABLE HISTORY"
        title="Audit Trail"
        description="Search actor, repository, incident, correlation and policy events while verifying the append-only integrity chain."
      />
      <section className="panel">
        <div className="filterBar">
          <input
            placeholder="Search actor, event or correlation ID"
            aria-label="Search audit events"
          />
          <select aria-label="Event type">
            <option>All event types</option>
            <option>Incident</option>
            <option>Recovery</option>
            <option>Publication</option>
          </select>
          <button>Search</button>
        </div>
        <div className="stateCard">
          <strong>No audit query has been run</strong>
          <span>Choose filters to retrieve tenant-scoped immutable events.</span>
        </div>
      </section>
    </AppShell>
  );
}
