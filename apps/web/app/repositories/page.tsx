import Link from 'next/link';
import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { ResourceList } from '../../components/domain/resource-list';
export default function RepositoriesPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="SOURCE CONTROL"
        title="Repositories"
        description="Connected repositories, operational health and response readiness."
        actions={
          <Link className="buttonLink" href="/repositories/connect">
            Connect repository
          </Link>
        }
      />
      <ResourceList endpoint="repositories" kind="repositories" detailBase="/repositories" />
    </AppShell>
  );
}
