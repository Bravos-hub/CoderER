import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { ResourceList } from '../../components/domain/resource-list';
export default function Page() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Investigations"
        description="Organization-wide investigation lifecycle and current state."
      />
      <ResourceList endpoint="investigations" kind="investigation records" />
    </AppShell>
  );
}
