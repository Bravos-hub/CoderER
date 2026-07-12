# CodeER

> **Emergency response for broken software.**  
> From failing build to verified recovery.

CodeER is an evidence-driven AI software emergency-response platform for engineering organizations that need to investigate, contain, repair, verify and review software failures without surrendering human control.

CodeER is being designed as a long-lived enterprise product, not as a disposable hackathon prototype. The Build Week submission is one delivery milestone inside a broader commercial architecture.

## Operating principles

1. **Evidence before action** - reproduce or identify the failure before changing code.
2. **Isolation before modification** - perform repairs in a branch, worktree and sandbox.
3. **Verification before approval** - rerun the original failure, builds, tests and critical journeys.
4. **Human control before merge** - keep every patch reviewable and never auto-merge.
5. **Security before convenience** - treat repositories, logs, model output, commands and queue data as untrusted.
6. **Tenant isolation by default** - organization data is scoped at the application and database layers.
7. **Auditability over hidden automation** - every security-sensitive and incident-changing action must be attributable.

```text
ADMIT -> TRIAGE -> DIAGNOSE -> RECOVER -> VERIFY -> REVIEW
```

## Current implementation

### Sprint 1 - secure workspace foundation

- npm workspaces with Next.js, NestJS, BullMQ, PostgreSQL, Prisma and Redis;
- server-side backend-for-frontend so internal API credentials do not enter browser JavaScript;
- fail-closed production configuration, structured redacted logging, request IDs and safe errors;
- non-root, capability-dropped and read-only application containers;
- formatting, linting, type checking, tests, CI, CodeQL, Dependabot, dependency review, secret scanning and SBOM generation;
- GitHub Codespaces configuration for browser and mobile development.

### Sprint 2 - controlled repository intake

- GitHub App installation authentication with a local token fallback;
- canonical GitHub URL and Git reference validation;
- bounded repository metadata and branch collection;
- controlled shallow clone and refresh without credentials in URLs or command arguments;
- Git execution with shell expansion, prompts, hooks, unsafe protocols and ambient configuration disabled;
- repository file-count and byte limits;
- isolated recovery worktrees and unique CodeER recovery branches;
- asynchronous intake jobs and typed progress results.

### Sprint 3 - enterprise incident engine

- organization-scoped incident, evidence, severity, health, event, audit, idempotency and outbox models;
- deterministic versioned severity and repository-health policies;
- incident lifecycle state machine with optimistic concurrency controls;
- tenant-aware API routes for incident creation, listing, detail, evidence, triage and controlled transitions;
- role and permission enforcement for owners, administrators, incident commanders, responders, viewers and service identities;
- HMAC-signed trusted request context bound to organization, actor, method, path, request ID and timestamp;
- forced PostgreSQL row-level security for tenant-owned tables;
- immutable audit records, incident events and evidence rows;
- append-only incident timeline with a SHA-256 hash chain and verification status;
- recursive evidence redaction, digesting, sensitivity classification and size limits;
- transactional outbox with leasing, retries and dead-letter handling;
- asynchronous triage worker and repository-health snapshot generation;
- idempotent incident creation and evidence ingestion;
- command-centre incident list, creation flow and evidence timeline;
- integration smoke coverage for idempotency, row-level security, cross-tenant denial, evidence redaction, outbox delivery, triage and event-chain integrity.

## Workspace

```text
apps/
  web/          Next.js command centre and same-origin BFF
  api/          NestJS orchestration and incident API
  worker/       Repository-intake, triage and outbox workers
packages/
  config/       Fail-closed environment validation
  contracts/    Shared Zod schemas and domain contracts
  database/     PostgreSQL persistence, migrations and tenant boundary
  github/       GitHub authentication and bounded metadata access
  incidents/    Severity, health, state-machine and integrity policies
  logger/       Structured redacted logging
  repository/   Controlled Git clone and worktree operations
  security/     Signed context and authorization policies
infra/docker/   Hardened application container definitions
docs/           Product, architecture, data, security, operations and ADRs
```

## Local development

Requirements: Node.js 24 LTS, npm 10 or newer, Git and Docker.

```bash
cp .env.example .env
npm ci --ignore-scripts --no-audit --no-fund
npm run infra:up
npm run db:apply:sprint3
npm run db:provision:runtime
npm run dev
```

Open:

- Command centre: `http://localhost:3000/incidents`
- Repository admission: `http://localhost:3000/connect`
- API liveness: `http://localhost:4100/api/v1/health`
- API readiness: `http://localhost:4100/api/v1/health/ready`

Run quality, integration and security gates:

```bash
npm run workspace:check
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run security:check
npm run security:sbom
```

With PostgreSQL available:

```bash
npm run db:apply:sprint3
npm run db:provision:runtime
npm run test:integration:incident
```

## Production trust model

Production startup is fail-closed. The temporary API-key gateway is combined with signed organization and actor context until the product identity service is integrated.

```env
NODE_ENV=production
API_AUTH_MODE=api-key
CODEER_API_KEY=<at-least-32-random-characters>
CORS_ALLOWED_ORIGINS=https://codeer.example.com
API_REQUIRE_TENANT_CONTEXT=true
API_REQUIRE_SIGNED_CONTEXT=true
API_REQUIRE_IDEMPOTENCY_KEY=true
REQUEST_CONTEXT_SIGNING_SECRET=<at-least-32-random-characters>
REQUEST_CONTEXT_SIGNING_SECRET_PREVIOUS=<optional-previous-key-during-rotation>
CODEER_API_URL_INTERNAL=http://api:4100/api/v1
CODEER_INTERNAL_API_KEY=<same-internal-key>
CODEER_ORGANIZATION_ID=<organization-uuid>
CODEER_SERVICE_ACTOR_ID=codeer-web-bff
```

The browser communicates with same-origin Next.js route handlers. The BFF signs and forwards trusted context server-side. Services verify the signature and freshness before authorizing the requested capability. PostgreSQL row-level security remains an independent tenant boundary. Runtime services connect through a dedicated non-superuser, non-BYPASSRLS database role; schema migration uses a separate administrative connection.

The API key and HMAC identity bridge are transitional controls. Enterprise deployments will replace the human identity path with OIDC, short-lived service credentials and policy-driven authorization while preserving the same application permission model.

## Enterprise incident documentation

- [Sprint 3 Enterprise Incident Engine](docs/architecture/SPRINT_3_ENTERPRISE_INCIDENT_ENGINE.md)
- [Incident Data Model](docs/data/INCIDENT_DATA_MODEL.md)
- [Incident API](docs/api/INCIDENTS_API.md)
- [Incident Data Security](docs/security/INCIDENT_DATA_SECURITY.md)
- [Incident Engine Operations Runbook](docs/operations/INCIDENT_ENGINE_RUNBOOK.md)
- [ADR 0001: Transactional Outbox](docs/adr/0001-transactional-outbox-for-triage.md)
- [ADR 0002: Hash-Chained Incident History](docs/adr/0002-hash-chained-incident-history.md)
- [ADR 0003: PostgreSQL Row-Level Security](docs/adr/0003-postgresql-rls-for-tenant-isolation.md)

## Foundation documentation

- [Security Policy](SECURITY.md)
- [Security Architecture](docs/security/SECURITY_ARCHITECTURE.md)
- [Threat Model](docs/security/THREAT_MODEL.md)
- [Secure Development Lifecycle](docs/security/SECURE_DEVELOPMENT_LIFECYCLE.md)
- [Brand Foundation](docs/brand/CODEER_BRAND_FOUNDATION.md)
- [Product Specification](docs/product/CODEER_PRODUCT_SPECIFICATION.md)
- [System Architecture](docs/architecture/CODEER_SYSTEM_ARCHITECTURE.md)
- [Workspace and Repository Intake](docs/development/WORKSPACE.md)

## Security and enterprise-readiness status

Sprint 3 establishes strong application and data-plane foundations, but CodeER is not yet approved for unrestricted production access to sensitive enterprise repositories.

Remaining enterprise gates include:

- workforce OIDC, SCIM and organization membership lifecycle;
- external policy engine and separation-of-duty rules;
- KMS-backed signing and envelope encryption;
- encrypted object storage for large evidence with malware scanning and retention enforcement;
- hardened per-session execution sandboxes and network egress policy;
- tamper-evident external audit export and security information and event management integration;
- regional data residency, backup, restore and disaster-recovery certification;
- load, chaos, penetration and independent security testing;
- formal availability objectives, on-call ownership and operational readiness review.

## Next product milestone

Sprint 4 will build the diagnosis and sandbox execution plane: controlled failure reproduction, command policy, streamed logs, repository mapping, evidence normalization and the first Codex-powered root-cause investigation workflow.
