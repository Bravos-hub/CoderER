# CodeER

> **Emergency response for broken software.**  
> From failing build to verified recovery.

CodeER is an evidence-driven AI software emergency-response platform for engineering organizations that need to investigate, contain, reproduce, repair, verify and review software failures without surrendering human control.

CodeER is being designed as a long-lived enterprise product, not as a disposable hackathon prototype. The Build Week submission is one delivery milestone inside a broader commercial architecture.

## Operating principles

1. **Evidence before action** - reproduce or identify the failure before changing code.
2. **Isolation before modification** - perform repairs in a branch, worktree and sandbox.
3. **Verification before approval** - rerun the original failure, builds, tests and critical journeys.
4. **Human control before merge** - keep every patch reviewable and never auto-merge.
5. **Security before convenience** - treat repositories, logs, model output, commands and queue data as hostile input.
6. **Tenant isolation by default** - organization data is scoped at the application and database layers.
7. **Auditability over hidden automation** - every security-sensitive and incident-changing action must be attributable.
8. **Cleanup is part of correctness** - an execution is not complete until its resources are independently proven absent.

```text
ADMIT -> TRIAGE -> REPRODUCE -> DIAGNOSE -> RECOVER -> VERIFY -> REVIEW
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

### Sprint 4 - hardened sandbox and deterministic failure reproduction

- provider-neutral sandbox domain and a Docker execution provider behind an explicit trust boundary;
- deny-by-default executable, argument, working-directory, environment and network policy evaluation;
- non-root execution, read-only root filesystem, dropped capabilities, `no-new-privileges`, PID/memory/CPU/tmp limits and no privileged/host namespace modes;
- production requirement for digest-pinned images, approved registries, remote TLS/SSH Docker and quota-aware workspaces;
- no Docker socket, GitHub token, OpenAI key, database credential, Redis credential or inherited host environment inside repository containers;
- networkless reproduction and separately governed restricted installation networking;
- lockfile-aware package-manager commands, bounded command count, timeout, output, log and artifact limits;
- deterministic failure-signature extraction, repeated-run consistency checking and explicit reproduced/not-reproduced/inconclusive classification;
- ordered, redacted and SHA-256 hash-chained stdout/stderr chunks with truncation evidence;
- bounded, path-confined, typed and integrity-hashed artifact manifests;
- organization-scoped execution, policy, command, log, artifact, reproduction and cleanup persistence protected by PostgreSQL RLS;
- transactional outbox dispatch, deterministic BullMQ jobs, worker leases, heartbeats, cancellation, timeout propagation and fail-closed control-plane handling;
- idempotent cleanup, orphan reconciliation, lease-fenced writes and append-only cleanup-proof history in every terminal result;
- incident command-centre reproduction workflow with policy preview, live state, redacted logs, failure comparison, artifacts and cleanup status;
- Docker security-profile, database-boundary and deterministic reproduction smoke suites for CI and dedicated runners.

### Sprint 5 - evidence-grounded Codex investigation

- provider-neutral model gateway with OpenAI Responses API support, strict structured output and organization model/budget policy;
- durable, lease-fenced multi-agent investigation workflow with checkpoints, cancellation, resume and stale-run reconciliation;
- bounded read-only repository/evidence tools with path confinement, redaction, provenance and tenant authorization;
- prompt-injection containment that treats repository content and model output as untrusted;
- citation-valid primary and alternative hypotheses, independent security review and critic stages;
- immutable versioned treatment plans, multi-human approval thresholds and separation of duties;
- forced-RLS AI persistence, usage/cost telemetry, adversarial evaluation and command-centre investigation workflows.

### Sprint 6 - controlled recovery and patch governance

- approved-plan-only recovery creation pinned to an immutable base commit and deterministic non-protected branch;
- isolated Git worktrees with canonical path confinement, full-SHA validation and argument-array Git execution;
- strict unified-diff parsing, binary/traversal/symlink/submodule rejection and atomic `git apply --check` application;
- deny-by-default file, line, hunk, byte and sensitive-change budgets controlled by versioned organization policy;
- hunk-level treatment-plan and diagnosis-evidence provenance with immutable patch versions and content digests;
- separate repair and security-review agents, hardened sandbox verification and unexpected-change detection;
- versioned pull-request packages, human-only publication approval, multi-approver separation of duties and no direct push or auto-merge;
- tenant-scoped recovery persistence, forced RLS, leases, checkpoints, reconciliation, cleanup proof and adversarial recovery evaluations.

## Workspace

```text
apps/
  web/          Next.js command centre and same-origin BFF
  api/          NestJS orchestration, incident and reproduction APIs
  worker/       Intake, triage, outbox and sandbox-execution workers
packages/
  config/       Fail-closed environment validation
  contracts/    Shared Zod schemas and domain contracts
  database/     PostgreSQL persistence, migrations, RLS and leases
  github/       GitHub authentication and bounded metadata access
  incidents/    Severity, health, state-machine and integrity policies
  logger/       Structured redacted logging
  repository/   Controlled Git clone and worktree operations
  sandbox/      Policy engine, signatures, logs, provider and orchestrator
  ai/           Provider-neutral model gateway and structured AI contracts
  recovery/     Worktree, patch, policy, provenance and PR-package controls
  security/     Signed context, authorization, hashing and redaction
infra/docker/   Hardened application and migration container definitions
test/fixtures/  Deterministic broken repositories for sandbox validation
docs/           Product, architecture, data, security, operations and ADRs
```

## Local development

Requirements: Node.js 24 LTS, npm 10 or newer, Git, Docker and Docker Compose.

```bash
cp .env.example .env
npm ci --ignore-scripts --no-audit --no-fund
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run dev
```

Open:

- Command centre: `http://localhost:3000/incidents`
- Repository admission: `http://localhost:3000/connect`
- API liveness: `http://localhost:4100/api/v1/health`
- API readiness: `http://localhost:4100/api/v1/health/ready`

Run quality and security gates:

```bash
npm run workspace:check
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:evaluation:investigation
npm run test:evaluation:recovery
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build
npm run security:check
npm run security:sbom
```

Run PostgreSQL integration gates:

```bash
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run test:integration:incident
npm run test:integration:sandbox:persistence
npm run test:integration:investigation
npm run test:integration:recovery
```

Run the real Docker execution-boundary smoke test from a trusted operator host:

```bash
npm run test:integration:sandbox:docker
```

The Docker smoke fixture intentionally fails in a repeatable way. The test verifies isolation flags, secret redaction, ordered logs, matching failure signatures, artifact digests and absence of managed containers and volumes after cleanup.

## Production trust model

Production startup is fail-closed. The temporary API-key gateway is combined with signed organization and actor context until the product identity service is integrated.

```env
NODE_ENV=production
API_AUTH_MODE=api-key
CODEER_API_KEY=<at-least-32-random-characters>
CORS_ALLOWED_ORIGINS=https://codeer.example.com
API_REQUIRE_TENANT_CONTEXT=true
API_REQUIRE_SIGNED_CONTEXT=true
REQUIRE_IDEMPOTENCY_KEYS=true
REQUEST_CONTEXT_SIGNING_SECRET=<at-least-32-random-characters>
REQUEST_CONTEXT_SIGNING_SECRET_PREVIOUS=<optional-previous-key-during-rotation>
CODEER_API_URL_INTERNAL=http://api:4100/api/v1
CODEER_INTERNAL_API_KEY=<same-internal-key>
CODEER_ORGANIZATION_ID=<organization-uuid>
CODEER_SERVICE_ACTOR_ID=codeer-web-bff

SANDBOX_DEFAULT_IMAGE=registry.example.com/codeer/node-runtime@sha256:<digest>
SANDBOX_HELPER_IMAGE=registry.example.com/codeer/sandbox-helper@sha256:<digest>
SANDBOX_APPROVED_REGISTRIES=registry.example.com
SANDBOX_DOCKER_HOST=tcp://sandbox-engine.internal:2376
SANDBOX_DOCKER_TLS_VERIFY=true
SANDBOX_DOCKER_CERT_PATH=/run/secrets/sandbox-docker-client
SANDBOX_WORKSPACE_VOLUME_DRIVER=<quota-aware-driver>
SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION=size
SANDBOX_INSTALL_NETWORK=<pre-provisioned-restricted-egress-network>
SANDBOX_INSTALL_ALLOWED_REGISTRIES=registry.npmjs.org
SANDBOX_INSTALL_ALLOWED_DOMAINS=registry.npmjs.org
SANDBOX_EXECUTION_TIMEOUT_MS=2700000
SANDBOX_EXECUTION_LEASE_MS=60000
SANDBOX_STALE_AFTER_MS=3600000
```

The browser communicates with same-origin Next.js route handlers. The BFF signs and forwards trusted context server-side. Services verify signature and freshness before authorizing the requested capability. PostgreSQL row-level security remains an independent tenant boundary. API and worker services use separate non-superuser, non-BYPASSRLS database identities; the worker receives only an explicit transaction-local capability for cross-tenant queue work.

Untrusted repository commands do not execute on the API or worker host. The worker controls a dedicated remote sandbox engine over mutually authenticated transport. Production rejects the local Unix Docker socket, mutable image tags, empty registry policy and unbounded workspace storage. Reproduction uses no network. Installation networking is optional, separate and must be enforced by infrastructure egress controls; the worker requires an egress-control attestation label and exact destination-policy digest, and an ordinary Docker bridge is not sufficient for enterprise approval.

The API key and HMAC identity bridge are transitional controls. Enterprise deployments will replace the human identity path with OIDC, short-lived service credentials and policy-driven authorization while preserving the same application permission model.

## Enterprise AI investigation plane

Sprint 5 adds a durable, read-only intelligence layer that converts verified reproductions into citation-valid diagnoses and versioned treatment plans. Repository content is treated as hostile evidence, tools are tenant-scoped and read-only, model output is schema and citation validated, and provider usage is governed by organization model, token, cost, concurrency and retention policy.

The workflow uses specialized triage, mapping, investigation, contract, security, planning and critic agents. It persists checkpoints, model invocations, tool calls, context packages, guardrail decisions, hypotheses, diagnoses, plans, usage and approvals under forced PostgreSQL row-level security. It does not edit repository files, create commits or open pull requests.

Treatment-plan decisions require a signed authenticated human session. Service, system and agent actors are rejected. Plans can require multiple distinct approvers; duplicate approvals are idempotent and partial approvals remain pending.

```env
OPENAI_API_KEY=<secret-manager-reference>
AI_ALLOWED_MODELS=gpt-5.6
AI_DEFAULT_MODEL=gpt-5.6
AI_MODEL_PRICING_JSON=<current-approved-provider-pricing-map>
AI_MAX_MODEL_INVOCATIONS=20
AI_MAX_INPUT_TOKENS=200000
AI_MAX_OUTPUT_TOKENS=30000
AI_MAX_COST_USD=25
AI_STORE_PROVIDER_RESPONSES=false
CODEER_USER_SESSION_SECRET=<separate-at-least-32-character-secret>
```

Production human sessions are issued by an identity edge or OIDC adapter as signed, expiring, HttpOnly `codeer_user_session` cookies. Development identity fallbacks are ignored in production.

- [Sprint 5 Codex Orchestration Architecture](docs/architecture/SPRINT_5_CODEX_ORCHESTRATION.md)
- [Investigations API](docs/api/INVESTIGATIONS_API.md)
- [AI Investigation Data Model](docs/data/AI_INVESTIGATION_DATA_MODEL.md)
- [AI Orchestration Threat Model](docs/security/AI_ORCHESTRATION_THREAT_MODEL.md)
- [AI Investigation Operations Runbook](docs/operations/AI_INVESTIGATION_RUNBOOK.md)
- [AI Investigation Evaluation](docs/evaluations/AI_INVESTIGATION_EVALUATION.md)
- [ADR 0007: Durable Evidence-Grounded Investigations](docs/adr/0007-durable-evidence-grounded-investigations.md)
- [ADR 0008: Untrusted Evidence and Read-Only Tools](docs/adr/0008-untrusted-evidence-and-read-only-tools.md)
- [ADR 0009: Human Approval and Separation of Duties](docs/adr/0009-human-approval-and-separation-of-duties.md)

## Enterprise controlled-recovery documentation

- [Controlled Recovery Architecture](docs/architecture/CONTROLLED_RECOVERY_PLANE.md)
- [Controlled Recovery Threat Model](docs/security/CONTROLLED_RECOVERY_THREAT_MODEL.md)
- [Recoveries API](docs/api/RECOVERIES_API.md)
- [Recovery Data Model](docs/data/RECOVERY_DATA_MODEL.md)
- [Controlled Recovery Operations Runbook](docs/operations/CONTROLLED_RECOVERY_RUNBOOK.md)
- [Controlled Recovery Evaluation](docs/evaluations/RECOVERY_EVALUATION.md)
- [ADR 0010: Evidence-Linked Atomic Patches](docs/adr/0010-evidence-linked-atomic-patches.md)

## Enterprise sandbox documentation

- [Sprint 4 Hardened Sandbox Architecture](docs/architecture/SPRINT_4_HARDENED_SANDBOX.md)
- [Reproductions API](docs/api/REPRODUCTIONS_API.md)
- [Sandbox Data Model](docs/data/SANDBOX_DATA_MODEL.md)
- [Sandbox Threat Model](docs/security/SANDBOX_THREAT_MODEL.md)
- [Sandbox Operations Runbook](docs/operations/SANDBOX_RUNBOOK.md)
- [ADR 0004: Remote Sandbox Execution Boundary](docs/adr/0004-remote-sandbox-execution-boundary.md)
- [ADR 0005: Networkless Reproduction and Restricted Install](docs/adr/0005-networkless-reproduction-and-restricted-install.md)
- [ADR 0006: Cleanup Proof Is Part of the Result](docs/adr/0006-cleanup-proof-is-part-of-result.md)

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

Sprints 4-6 establish the executable, intelligence and controlled-recovery trust boundaries, but CodeER is not yet approved for unrestricted production access to sensitive enterprise repositories.

Remaining enterprise gates include:

- workforce OIDC, SCIM and organization membership lifecycle;
- external policy engine, approval workflows and separation-of-duty rules;
- KMS-backed signing, envelope encryption and managed secret delivery;
- managed remote sandbox infrastructure with mandatory access controls, hardened kernels, image admission, egress enforcement and per-tenant capacity controls;
- encrypted evidence object storage with malware scanning, legal hold and retention enforcement;
- tamper-evident external audit export and security information and event management integration;
- regional data residency, backup, restore and disaster-recovery certification;
- load, chaos, penetration, container-escape and independent security testing;
- formal availability objectives, on-call ownership and operational readiness review.

## Next product milestone

Sprint 7 will add the governed GitHub publication and independent release-verification plane: recreate the exact approved patch digest, push only a dedicated recovery branch through a least-privilege GitHub App, open a draft pull request, attach tamper-evident evidence, consume CI/check results and prevent merge until branch protection and human review requirements are satisfied. Production deployment and automatic merge remain out of scope.
