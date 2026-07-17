import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { OperationsDashboard } from '../../components/command-center/operations-dashboard';
export default function CommandCenterPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="LIVE OPERATIONS"
        title="Command Center"
        description="Monitor the complete software emergency response lifecycle across repositories, incidents, recoveries and GitHub publications."
      />
      <OperationsDashboard />
    </AppShell>
  );
}
