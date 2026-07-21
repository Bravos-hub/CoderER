# Known limitations — competition release

This file separates what is proven live from what is seeded replay or designed
but not externally certified. Update it whenever a boundary changes.

## Live and proven

- Incident intake, evidence redaction, immutable event hash chains, RLS tenant
  isolation (integration-tested against real PostgreSQL).
- Deterministic demo reset, idempotency and tenant isolation
  (`test:integration:demo-reset`, `demo:verify` — 23 checks).
- Judge access: hardened session issuance, rate limiting, audit events, Compose
  wiring (unit-tested; live journey in `test:e2e:live`).
- Merge-readiness decisions, human-ready gate, merge observation, post-merge
  verification and incident closure from persisted state
  (`test:integration:publication`).
- Durable webhook ingestion with restart-safe replay rejection (unit-tested;
  resolver functions verified against the runtime database role).

## Seeded deterministic replay (labelled in the UI)

- The frozen incident `ER-20260719-DEM001`, including its sandbox reproduction
  records, GPT-5.6 invocation metadata, publication events, merge observation
  and closure record. Seeded rows carry `SEEDED_DETERMINISTIC_REPLAY`
  provenance and `seeded-replay:` provider ids.

## Implemented but not externally certified

- **Publication executor** (PR #37): Git Data commit materialization and draft
  PR creation are unit-tested with a fake GitHub; a real app-driven branch/PR
  against the live installation is pending the hosted deployment proof.
- **Webhook CI/review/merge synchronization** (PR #38, #39): durable ingestion
  is implemented and tested; end-to-end synchronization from a live GitHub App
  delivery is pending the hosted deployment.
- **Post-merge verification**: control-plane verification from persisted
  synchronized state. Live re-execution of the original failure check after
  merge is not yet wired (#22).
- **Real GPT-5.6 trace**: capture/verify tooling is committed
  (`demo:capture-ai-trace`, `demo:verify-ai-trace`); the certified trace
  artifact is captured once provider quota is available.

## Designed, not deployed

- Remote hardened sandbox infrastructure (the local Docker socket is
  deliberately not presented as the enterprise boundary).
- Workforce OIDC/SCIM, managed KMS, encrypted evidence object storage,
  tamper-evident external audit export, residency/DR certification.
- Distributed rate limiting for judge login (the competition deployment is a
  single instance with an in-process limiter).

## Operational notes

- Dependabot alerts are enabled (3 alerts on the default branch at release
  time: 1 high, 2 moderate); the release gate audits production dependencies
  at high severity on every run.
- The publication and webhook planes share worker dispatch and contracts
  files; PRs #37–#39 merge in sequence to avoid conflicts.
