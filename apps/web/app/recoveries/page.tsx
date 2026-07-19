import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { RecoveryList } from '../../components/domain/operational-lists';
export default function Page() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Recoveries"
        description="Organization-wide recovery lifecycle and current state."
      />
      <RecoveryList />
    </AppShell>
  );
}
