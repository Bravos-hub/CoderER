# Submission Architecture

CodeER is an evidence-driven recovery system for broken software repositories. The competition demo should show one complete vertical slice rather than every enterprise feature.

## Vertical Slice

```text
Connect demo repository
  -> reproduce a predictable failure
  -> build bounded evidence context
  -> generate cited GPT-5.6 diagnosis
  -> approve treatment plan
  -> create isolated worktree
  -> apply minimal patch
  -> run independent verification
  -> generate pull-request package
```

## Main Components

- `apps/web`: Next.js command centre and same-origin backend-for-frontend.
- `apps/api`: NestJS orchestration, incident, reproduction, recovery, and publication APIs.
- `apps/worker`: asynchronous intake, triage, sandbox, investigation, recovery, and publication work.
- `packages/database`: PostgreSQL persistence, migrations, row-level security, leases, and stores.
- `packages/sandbox`: deterministic reproduction and verification policy.
- `packages/ai`: provider-neutral model gateway and structured AI contracts.
- `packages/recovery`: controlled patch application, provenance, security review, and PR packaging.
- `packages/publication`: GitHub publication policies, lifecycle, checks, webhook verification, and package building.

## Trust Boundaries

- Browser code never receives internal API credentials.
- API requests require authenticated context and signed organization/actor metadata in production.
- PostgreSQL row-level security is an independent tenant boundary.
- Repository commands run in hardened sandbox/worktree boundaries, not in the API process.
- Model output is validated and treated as untrusted until it passes schema, citation, and policy checks.
- Publication is human-approved, draft-PR-first, and no auto-merge is allowed.

## Demo Incident

Primary recommended incident:

```text
A frontend calls /api/users/profile, but the backend exposes /api/v1/profile.
```

Why this is strong:

- non-trivial frontend/backend contract reasoning;
- clear reproduction and evidence;
- minimal repair path;
- integration-testable verification;
- easy for judges to understand quickly.

Fallback incident:

```text
A repository has a missing or incorrect build script.
```

Use the fallback only if the primary incident cannot be stabilized before the feature freeze.
