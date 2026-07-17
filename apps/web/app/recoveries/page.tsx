import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { ResourceList } from '../../components/domain/resource-list';
export default function Page() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Recoveries"
        description="Organization-wide recovery lifecycle and current state."
      />
      <ResourceList endpoint="recoveries" kind="recovery records" />
    </AppShell>
  );
}
