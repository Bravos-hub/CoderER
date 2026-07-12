import Link from 'next/link';
import { IncidentDetailView } from './incident-detail-view';

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;
  return (
    <main className="commandCenter shell">
      <header className="topbar">
        <Link className="brand" href="/incidents">
          <span className="brandMark" aria-hidden="true" />
          <span>
            Code<span className="er">ER</span>
          </span>
        </Link>
        <span className="environment">INCIDENT EVIDENCE</span>
      </header>
      <IncidentDetailView incidentId={incidentId} />
    </main>
  );
}
