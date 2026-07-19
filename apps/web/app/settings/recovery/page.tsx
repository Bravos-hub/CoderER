import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { OrganizationSettingKind } from '@codeer/contracts';
import { SettingsForm } from '../../../components/settings/settings-form';
export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="ORGANIZATION POLICY"
        title="Recovery policy"
        description="Allowed paths, change budgets, dependency rules, migrations and approvals."
      />
      <SettingsForm
        kind={OrganizationSettingKind.RECOVERY}
        description="Allowed paths, change budgets, dependency rules, migrations and approvals."
        defaultConfiguration={{
          maximumChangedFiles: 25,
          maximumChangedLines: 1000,
          requireIndependentVerification: true,
        }}
      />
    </AppShell>
  );
}
