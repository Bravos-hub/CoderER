import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { RepositoryForm } from '../../connect/repository-form';
export default function RepositoryConnectPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="GUIDED INTAKE"
        title="Connect a repository"
        description="Validate provider access, default branch, installation scope and repository policy before admission."
      />
      <section className="wizardLayout">
        <ol className="wizardSteps">
          <li className="active">Provider</li>
          <li>Installation</li>
          <li>Repository</li>
          <li>Policy</li>
          <li>Confirmation</li>
        </ol>
        <RepositoryForm />
      </section>
    </AppShell>
  );
}
