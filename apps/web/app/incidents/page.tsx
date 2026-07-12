import Link from 'next/link';
import { IncidentCommandCenter } from './incident-command-center';

export default function IncidentsPage() {
  return (
    <main className="commandCenter shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandMark" aria-hidden="true" />
          <span>
            Code<span className="er">ER</span>
          </span>
        </Link>
        <span className="environment">INCIDENT COMMAND CENTER</span>
      </header>
      <IncidentCommandCenter />
    </main>
  );
}
