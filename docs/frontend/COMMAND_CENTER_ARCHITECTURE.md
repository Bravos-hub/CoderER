# Sprint 8 Command Center Architecture

The command center is a Next.js server-mediated application. Browser code never receives CodeER internal API credentials, GitHub App keys, installation tokens, database credentials or trusted-context signing secrets.

## Request path

Browser -> same-origin Next.js BFF route -> trusted human context resolution -> CodeER API -> tenant-scoped service/persistence layer.

The catch-all BFF forwards only selected request metadata: content type, idempotency key and optimistic concurrency headers. Organization and actor identity are derived on the server.

## Information architecture

Primary workspaces cover command center, repositories, incidents, investigations, recoveries, publications, approvals and audit. Settings cover GitHub integration, organization, AI, recovery, publication and security policy.

Incident operations are separated into overview, evidence, triage, reproduction, investigation, treatment plan, recovery, verification, publication and activity routes. This prevents the previous oversized single-page workflow.

## Safety principles

- Backend authorization remains authoritative.
- Untrusted provider, log, review and model output is rendered as plain text.
- Versioned mutations require current versions and explicit human confirmation.
- No hidden model reasoning is displayed.
- Operational pages use live API data and expose degraded states rather than fake success data.
- Polling is bounded, abortable by unmount and visibility-aware expansion is reserved for later SSE support.
