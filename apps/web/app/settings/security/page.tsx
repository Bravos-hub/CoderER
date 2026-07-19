import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { OrganizationSettingKind } from '@codeer/contracts';
import { SettingsForm } from '../../../components/settings/settings-form';
export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="ORGANIZATION POLICY"
        title="Security settings"
        description="Trusted identity, sessions, roles, integrations and audit retention."
      />
      <SettingsForm
        kind={OrganizationSettingKind.SECURITY}
        description="Trusted identity, sessions, roles, integrations and audit retention."
        defaultConfiguration={{
          sessionHours: 12,
          requireSignedContext: true,
          auditRetentionDays: 365,
        }}
      />
    </AppShell>
  );
}
