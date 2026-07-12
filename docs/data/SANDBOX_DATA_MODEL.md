# Sandbox Data Model

## Design goals

- preserve policy and execution evidence independently of queue/runtime state;
- make retries idempotent;
- distinguish execution lifecycle from reproduction interpretation;
- keep logs and artifacts bounded;
- prove cleanup;
- support tenant RLS and worker reconciliation;
- avoid storing credentials or unrestricted raw filesystem data.

## Entities

### `SandboxExecution`

Operational aggregate for one isolated execution.

Important fields:

- organization, incident and worktree IDs;
- lifecycle status and result;
- image reference and environment fingerprint;
- lease owner, expiry and heartbeat;
- cancellation request;
- start/completion timestamps;
- safe error code/message.

### `FailureReproduction`

User-facing reproduction request/result. Stores the validated request, original and observed signatures, comparison, confidence and the associated execution.

### `SandboxPolicySnapshot`

Immutable policy decision used for the run:

- policy version and decision ID;
- allow/deny and reasons;
- normalized commands;
- image and digest requirement;
- resource and network policy;
- override state and approver;
- evaluation timestamp.

Historical runs are therefore reviewable even after policy changes.

### `SandboxCommand`

One approved command in execution order. Stores executable and argument array, working directory, bounded environment metadata, network mode, expected exit codes, actual exit/signal, timeout/OOM state, duration and output digest. It does not store a shell string.

### `SandboxLogChunk`

Ordered, redacted output chunk with:

- command association;
- monotonic sequence;
- stream;
- bounded content and byte size;
- redaction/truncation metadata;
- previous hash and current hash;
- occurrence timestamp.

### `SandboxArtifact`

Tenant-scoped artifact manifest with relative path, type, bytes, digest, retention and optional external storage reference. Raw bytes are not stored in PostgreSQL.

### `SandboxCleanupRecord`

An append-only sequence of immutable proofs per execution containing removed resource IDs, verification result, attempts, digest, safe error and completion time. Failed proofs remain available after a later reconciliation appends a verified correction.

## Relationships

```text
Organization
  └─ Incident
      ├─ FailureReproduction ── SandboxExecution ── RepositoryWorktree
      │                           ├─ SandboxPolicySnapshot
      │                           ├─ SandboxCommand[]
      │                           ├─ SandboxLogChunk[]
      │                           ├─ SandboxArtifact[]
      │                           └─ SandboxCleanupRecord[]
      ├─ IncidentEvent[]
      ├─ Evidence[]
      └─ AuditLog[]
```

## Integrity constraints

- one `FailureReproduction` per execution;
- one policy snapshot per execution;
- cleanup digest unique within execution;
- command sequence unique within execution;
- log sequence unique within execution;
- artifact path/digest unique within execution;
- digest lengths constrained to SHA-256 format;
- status/result values constrained by PostgreSQL enums;
- tenant identifiers indexed with operational query fields;
- immutable triggers reject update/delete for policy, logs and cleanup evidence where defined.

## Tenant isolation

Tenant-owned top-level tables carry `organizationId`. Child tables derive ownership through `SandboxExecution`. Forced RLS uses the active transaction organization. Worker-wide reconciliation requires both:

1. membership in the `codeer_worker_bypass` NOLOGIN capability role; and
2. transaction-local `app.codeer_worker_bypass=true`.

The API role is explicitly revoked from the capability group and remains `NOBYPASSRLS`.

## Retention

Suggested defaults, subject to organization policy:

- policy, result, audit and cleanup proof: incident lifetime plus compliance retention;
- redacted logs: 30–90 days unless legal hold applies;
- artifact manifests: incident lifetime;
- external artifact bytes: shortest approved period consistent with investigation;
- ephemeral workspace: deleted immediately after execution.

Retention deletion must itself be audited and must not break the audit/event chain.
