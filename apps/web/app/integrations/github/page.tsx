import { AppShell } from '../../../components/shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
const steps = [
  ['1', 'Register GitHub App', 'Create or select the organization-owned CodeER GitHub App.'],
  ['2', 'Configure credentials', 'Store App ID and private key server-side only.'],
  ['3', 'Configure webhook', 'Use Smee or Cloudflare Tunnel for local testing.'],
  ['4', 'Install repository access', 'Grant only the CoderER repository during development.'],
  ['5', 'Verify integration', 'Exchange an installation token and process a signed test event.'],
];
export default function GithubIntegrationPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="INTEGRATION"
        title="GitHub App setup"
        description="Configure least-privilege publication and signed webhook ingestion without exposing credentials to the browser."
      />
      <div className="integrationGrid">
        <section className="panel">
          <h2>Setup checklist</h2>
          {steps.map(([n, t, d]) => (
            <div className="setupStep" key={n}>
              <span>{n}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </div>
          ))}
        </section>
        <section className="panel">
          <p className="eyebrow">DEVELOPMENT WEBHOOK</p>
          <h2>Free local tunnel</h2>
          <p>
            Use a temporary HTTPS tunnel while the API is running locally. A paid domain is not
            required for certification.
          </p>
          <code>https://your-channel.smee.io</code>
          <div className="connectionTest">
            <span className="statusDot" />
            <div>
              <strong>Awaiting test delivery</strong>
              <small>Recent signed webhook status will appear here.</small>
            </div>
          </div>
          <button>Run connection test</button>
        </section>
      </div>
    </AppShell>
  );
}
