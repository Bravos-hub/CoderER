import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { InvestigationList } from '../../components/domain/operational-lists';
export default function Page() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Investigations"
        description="Organization-wide investigation lifecycle and current state."
      />
      <InvestigationList />
    </AppShell>
  );
}
