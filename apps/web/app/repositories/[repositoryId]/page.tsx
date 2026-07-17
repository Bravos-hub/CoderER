import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { JsonInspector } from '../../../components/domain/json-inspector';
export default async function RepositoryDetailPage({
  params,
}: {
  params: Promise<{ repositoryId: string }>;
}) {
  const { repositoryId } = await params;
  return (
    <AppShell>
      <PageHeader
        eyebrow="REPOSITORY WORKSPACE"
        title="Repository detail"
        description="Health, policy, incidents, configuration and activity for this source repository."
      />
      <div className="tabBar">
        {[
          'Overview',
          'Health',
          'Branches',
          'Incidents',
          'Configuration',
          'Dependencies',
          'Activity',
          'Settings',
        ].map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      <JsonInspector endpoint={`repositories/${repositoryId}`} title="Repository state" />
    </AppShell>
  );
}
