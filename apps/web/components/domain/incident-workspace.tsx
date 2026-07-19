'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { incidentSections } from '../../lib/navigation';
import { IncidentSectionContent } from './incident-section-content';

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
      <IncidentSectionContent incidentId={incidentId} section={section} />
    </>
  );
}
