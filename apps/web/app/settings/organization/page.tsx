import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { OrganizationSettingKind } from '@codeer/contracts';
import { SettingsForm } from '../../../components/settings/settings-form';
export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="ORGANIZATION POLICY"
        title="Organization settings"
        description="Organization identity, membership, retention and operational defaults."
      />
      <SettingsForm
        kind={OrganizationSettingKind.ORGANIZATION}
        description="Organization identity, membership, retention and operational defaults."
        defaultConfiguration={{ retentionDays: 365, incidentTimezone: 'UTC' }}
      />
    </AppShell>
  );
}
