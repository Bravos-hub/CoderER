import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
const queues = [
  ['Treatment plans', 'Plan scope, evidence and verification strategy'],
  ['Recovery publication', 'Exact patch version and human separation of duties'],
  ['Policy exceptions', 'Elevated dependency, migration or workflow changes'],
  ['Security escalations', 'Blocking findings requiring incident commander review'],
];
export default function ApprovalsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="HUMAN GOVERNANCE"
        title="Approvals"
        description="One inbox for every decision that must remain explicitly human."
      />
      <section className="approvalGrid">
        {queues.map(([title, description]) => (
          <article className="panel" key={title}>
            <p className="eyebrow">PENDING QUEUE</p>
            <h2>{title}</h2>
            <p>{description}</p>
            <div className="approvalMeta">
              <span>Risk-aware</span>
              <span>Version pinned</span>
              <span>Audited</span>
            </div>
            <button className="secondary">Review queue</button>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
