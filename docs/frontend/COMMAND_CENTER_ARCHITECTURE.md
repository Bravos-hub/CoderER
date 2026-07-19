# Sprint 8 Command Center Architecture

The command center is a Next.js server-mediated application. Browser code never receives CodeER internal API credentials, GitHub App keys, installation tokens, database credentials or trusted-context signing secrets.

## Request path

Browser -> same-origin Next.js BFF route -> trusted human context resolution -> CodeER API -> tenant-scoped service/persistence layer.

The catch-all BFF forwards only selected request metadata: content type, idempotency key and optimistic concurrency headers. Organization and actor identity are derived on the server.

## Information architecture

Primary workspaces cover command center, repositories, incidents, investigations, recoveries, publications, approvals and audit. Settings cover GitHub integration, organization, AI, recovery, publication and security policy.

Incident operations are separated into overview, evidence, triage, reproduction, investigation, treatment plan, recovery, verification, publication and activity routes. This prevents the previous oversized single-page workflow.

Evidence, verification and publication render immutable domain records directly. Investigation,
recovery and publication indexes use dedicated operational summaries rather than generic JSON
inspectors. The approvals inbox joins pending treatment-plan and recovery-publication decisions and
submits approve, reject or revision mutations with a rationale, explicit confirmation and the current
record version.

## Settings persistence

Organization, AI, recovery, publication and security settings use the catch-all BFF and the
`/api/v1/settings/:kind` API. Each save appends a new immutable `OrganizationSetting` version with a
canonical content digest and optimistic `expectedVersion`; existing versions are never overwritten.
Only authenticated human organization owners or administrators may mutate settings. The table is
organization-scoped and protected by forced PostgreSQL RLS.

## Browser verification

`npm run test:e2e` runs the Chromium command-center suite. It visits every primary and settings route
at desktop and mobile widths, applies axe WCAG A/AA rules, rejects horizontal viewport overflow and
exercises a deterministic mocked intake-to-verified-closure journey plus a settings append mutation.
Set `PLAYWRIGHT_EXTERNAL_SERVER=true` to test an already-running web service and optionally set
`PLAYWRIGHT_BASE_URL` to change its origin.

## Safety principles

- Backend authorization remains authoritative.
- Untrusted provider, log, review and model output is rendered as plain text.
- Versioned mutations require current versions and explicit human confirmation.
- No hidden model reasoning is displayed.
- Operational pages use live API data and expose degraded states rather than fake success data.
- Polling is bounded, abortable by unmount and visibility-aware expansion is reserved for later SSE support.
