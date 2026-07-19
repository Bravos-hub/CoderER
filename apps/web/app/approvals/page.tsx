import { AppShell } from '../../components/shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { ApprovalInbox } from '../../components/domain/approval-inbox';
export default function ApprovalsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="HUMAN GOVERNANCE"
        title="Approvals"
        description="One inbox for every decision that must remain explicitly human."
      />
      <ApprovalInbox />
    </AppShell>
  );
}
