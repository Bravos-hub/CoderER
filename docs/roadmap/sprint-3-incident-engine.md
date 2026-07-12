# Sprint 3 — Incident Engine and Evidence Timeline

## Objective

Deliver CodeER's first complete incident-response vertical slice after repository intake. A user must be able to create an incident for an admitted repository, receive deterministic severity classification, inspect repository-health impact, and review an append-only evidence timeline.

Tracking issue: [#11](https://github.com/Bravos-hub/CoderER/issues/11)

## End-to-end journey

```text
Admitted repository
      ↓
Create incident
      ↓
Validate and authorize request
      ↓
Persist incident + initial event atomically
      ↓
Classify severity
      ↓
Collect, redact and hash evidence
      ↓
Calculate repository health
      ↓
Render incident summary and evidence timeline
```

## Delivery order

### 1. Contracts

Add typed schemas for:

- incident classification input and result;
- evidence category, sensitivity, provenance and integrity;
- append-only incident events;
- repository-health dimensions and aggregate score;
- cursor pagination and filters;
- idempotency keys and correlation IDs.

### 2. Persistence

Add tenant-ready models for:

- Repository;
- RepositorySnapshot;
- Incident;
- IncidentEvent;
- Evidence;
- AuditLog.

Required guarantees:

- atomic incident creation and initial event;
- stable event sequence ordering;
- unique idempotency keys per workspace;
- immutable provenance and evidence digest;
- explicit workspace/repository ownership;
- UTC timestamps;
- bounded indexed query paths.

### 3. Domain services

Implement:

- deterministic severity engine;
- evidence redaction and SHA-256 digest service;
- timeline append service;
- repository-health calculator;
- audit event writer.

### 4. API

Implement:

```text
POST /v1/incidents
GET  /v1/incidents
GET  /v1/incidents/:incidentId
GET  /v1/incidents/:incidentId/timeline
POST /v1/incidents/:incidentId/evidence
GET  /v1/repositories/:repositoryId/health
```

All mutations require authentication, authorization, correlation IDs, idempotency support, validation and audit output.

### 5. Command centre

Build:

- incident creation form;
- incident summary;
- severity and stage indicators;
- repository-health card with reasons;
- evidence timeline;
- empty, loading, unauthorized and failure states.

## Severity policy

| Level | Meaning |
|---|---|
| SEV-1 | Confirmed production outage, critical security exposure, destructive data risk, or all critical journeys unavailable |
| SEV-2 | Production build/deployment blocked, broad authentication failure, or critical workflow unavailable without a safe workaround |
| SEV-3 | Degraded non-critical workflow, release-blocking test failure, or limited integration failure |
| SEV-4 | Local/development failure, minor configuration issue, or low-impact defect |

Reported severity is advisory. CodeER stores reported severity, calculated severity, matched rules and evidence references.

## Repository-health dimensions

- Build health
- Test health
- Deployment readiness
- Dependency health
- Security posture
- API consistency
- Frontend functionality

Every score must include reasons, evidence references, calculation version and timestamp. No unexplained score is permitted.

## Security controls

- Scope all reads and writes to the active workspace and repository.
- Never persist access tokens, authorization headers, cookies, private keys or unredacted secrets.
- Redact before persistence and logging.
- Bound evidence size, content type and text length.
- Hash evidence using SHA-256 and preserve immutable provenance.
- Keep timeline records append-only; corrections are new events.
- Do not expose clone credentials, internal paths or sandbox internals through APIs.
- Paginate all list endpoints and cap page size.
- Audit every incident and evidence mutation.

## Test matrix

- severity rules across SEV-1 to SEV-4;
- invalid and oversized evidence rejection;
- secret redaction;
- evidence digest stability;
- idempotent incident creation;
- concurrent timeline ordering;
- cross-workspace access rejection;
- repository ownership enforcement;
- deterministic health-score calculation;
- API integration tests;
- command-centre critical path.

## Definition of done

Sprint 3 is complete when an admitted repository can be selected, an incident can be created, its severity and repository-health impact are traceable to evidence, and the full immutable timeline can be reviewed in the command centre. Formatting, linting, type checking, tests, production builds and security checks must pass.