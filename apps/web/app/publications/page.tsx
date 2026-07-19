import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { ResourceList } from '../../components/domain/resource-list';
export default function Page() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Publications"
        description="Organization-wide publication lifecycle and current state."
      />
      <ResourceList endpoint="publications" kind="publication records" />
    </AppShell>
  );
}
