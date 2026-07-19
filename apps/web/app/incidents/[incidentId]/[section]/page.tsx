import { notFound } from 'next/navigation';
import { AppShell } from '../../../../components/shell/app-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { IncidentWorkspace } from '../../../../components/domain/incident-workspace';
import { incidentSections } from '../../../../lib/navigation';
export default async function IncidentSectionPage({
  params,
}: {
  params: Promise<{ incidentId: string; section: string }>;
}) {
  const { incidentId, section } = await params;
  if (!incidentSections.includes(section as (typeof incidentSections)[number])) notFound();
  return (
    <AppShell>
      <PageHeader
        eyebrow="INCIDENT COMMAND"
        title={`Incident ${incidentId.slice(0, 8)}`}
        description="Evidence-grounded response workspace with explicit human governance."
      />
      <IncidentWorkspace incidentId={incidentId} section={section} />
    </AppShell>
  );
}
