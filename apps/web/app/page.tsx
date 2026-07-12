import Link from 'next/link';
import { IncidentSeverity, RecoveryStage } from '@codeer/contracts';

const stages = Object.values(RecoveryStage);

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandMark">C</span>
          <span>
            Code<span className="er">ER</span>
          </span>
        </div>
        <span className="environment">WORKSPACE INITIALIZED</span>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">AI SOFTWARE EMERGENCY RESPONSE</p>
          <h1>Emergency response for broken software.</h1>
          <p className="lede">
            The command-centre workspace is ready for repository intake, isolated diagnosis,
            controlled repair, independent verification and reviewable pull requests.
          </p>
          <div className="actions">
            <Link className="buttonLink" href="/connect">
              Admit repository
            </Link>
            <Link className="buttonLink secondaryLink" href="/incidents">
              Open command center
            </Link>
          </div>
        </div>
        <article className="incident">
          <div className="incidentHeader">
            <span>INCIDENT #ER-2048</span>
            <strong>{IncidentSeverity.SEV2}</strong>
          </div>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>commerce-platform</dd>
            </div>
            <div>
              <dt>Failure</dt>
              <dd>Production build blocked</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{RecoveryStage.DIAGNOSE}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>94%</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="workflow" aria-label="Recovery workflow">
        {stages.map((stage, index) => (
          <div key={stage}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{stage}</strong>
          </div>
        ))}
      </section>
    </main>
  );
}
