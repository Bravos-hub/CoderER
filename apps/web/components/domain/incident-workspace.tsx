'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { incidentSections } from '../../lib/navigation';
import { JsonInspector } from './json-inspector';

const endpointFor = (incidentId: string, section: string) => {
  const map: Record<string, string> = {
    overview: `incidents/${incidentId}`,
    evidence: `incidents/${incidentId}`,
    triage: `incidents/${incidentId}`,
    reproduction: `incidents/${incidentId}/reproductions`,
    investigation: `incidents/${incidentId}/investigations`,
    'treatment-plan': `incidents/${incidentId}/treatment-plans`,
    recovery: `incidents/${incidentId}/recoveries`,
    verification: `incidents/${incidentId}/recoveries`,
    publication: `incidents/${incidentId}/recoveries`,
    activity: `incidents/${incidentId}`,
  };
  return map[section] ?? `incidents/${incidentId}`;
};

export function IncidentWorkspace({
  incidentId,
  section,
}: {
  incidentId: string;
  section: string;
}) {
  const pathname = usePathname();
  return (
    <>
      <nav className="tabBar scrollTabs" aria-label="Incident workspace">
        {incidentSections.map((item) => (
          <Link
            key={item}
            className={pathname.endsWith(`/${item}`) ? 'active' : ''}
            href={`/incidents/${incidentId}/${item}`}
          >
            {item.replaceAll('-', ' ')}
          </Link>
        ))}
      </nav>
      <section className="incidentWorkspaceGrid">
        <JsonInspector
          endpoint={endpointFor(incidentId, section)}
          title={section.replaceAll('-', ' ')}
        />
        <aside className="panel actionPanel">
          <p className="eyebrow">NEXT HUMAN ACTION</p>
          <h2>Review current state</h2>
          <p>
            All actions remain server-authorized. Versioned approvals and destructive operations
            require an explicit confirmation.
          </p>
          <button>Refresh evidence</button>
          <button className="secondary">Open audit history</button>
        </aside>
      </section>
    </>
  );
}
