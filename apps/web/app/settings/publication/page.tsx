import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { OrganizationSettingKind } from '@codeer/contracts';
import { SettingsForm } from '../../../components/settings/settings-form';
export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="ORGANIZATION POLICY"
        title="Publication policy"
        description="Base branches, required checks, reviewers, webhook replay and post-merge requirements."
      />
      <SettingsForm
        kind={OrganizationSettingKind.PUBLICATION}
        description="Base branches, required checks, reviewers, webhook replay and post-merge requirements."
        defaultConfiguration={{
          allowedBaseBranches: ['main'],
          requiredApprovals: 1,
          automaticMerge: false,
        }}
      />
    </AppShell>
  );
}
