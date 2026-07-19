import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { OrganizationSettingKind } from '@codeer/contracts';
import { SettingsForm } from '../../../components/settings/settings-form';
export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="ORGANIZATION POLICY"
        title="AI policy"
        description="Approved providers, models, budgets, tools, concurrency and retention."
      />
      <SettingsForm
        kind={OrganizationSettingKind.AI}
        description="Approved providers, models, budgets, tools, concurrency and retention."
        defaultConfiguration={{ allowedModels: ['gpt-5.6'], maximumCostUsd: 25, retentionDays: 30 }}
      />
    </AppShell>
  );
}
