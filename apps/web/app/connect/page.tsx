import Link from 'next/link';
import { RepositoryForm } from './repository-form';

export default function ConnectRepositoryPage() {
  return (
    <main className="shell connectPage">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandMark">C</span>
          <span>
            Code<span className="er">ER</span>
          </span>
        </Link>
        <span className="environment">REPOSITORY INTAKE</span>
      </header>
      <section className="connectGrid">
        <div>
          <p className="eyebrow">SPRINT 2 · ADMIT</p>
          <h1 className="connectTitle">Connect a repository safely.</h1>
          <p className="lede">
            CodeER validates the GitHub repository, reads branch metadata, creates a controlled
            clone and prepares an isolated recovery worktree before any investigation begins.
          </p>
          <ul className="safetyList">
            <li>No direct writes to the default branch</li>
            <li>Credentials remain outside command output</li>
            <li>Every recovery receives a unique worktree</li>
          </ul>
        </div>
        <RepositoryForm />
      </section>
    </main>
  );
}
