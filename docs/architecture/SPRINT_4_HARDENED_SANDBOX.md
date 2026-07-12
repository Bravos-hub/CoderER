# Sprint 4: Hardened Sandbox and Deterministic Failure Reproduction

## Purpose

Sprint 4 creates CodeER's execution-security boundary. Repository content, package manifests, lifecycle scripts, lockfiles, build tools, test code and command output are hostile inputs. They are never executed by the API process, the general worker process host, or a developer shell as part of an automated recovery.

The sandbox plane exists to answer one question with evidence:

> Can CodeER reproduce the reported failure in a bounded, isolated and independently cleanable environment?

It does not diagnose or repair the repository. Those capabilities are later consumers of the evidence produced here.

## Architectural principles

1. **Deny by default.** No command, image, environment value, network mode, path or artifact is accepted unless policy permits it.
2. **Separate control and execution planes.** The API and orchestration worker record intent; a dedicated remote Docker boundary executes untrusted code.
3. **No ambient authority.** Sandboxes receive no GitHub, OpenAI, PostgreSQL, Redis, cloud or CodeER credentials.
4. **No host execution.** Repository commands are passed only to a `SandboxProvider` and never to a host shell.
5. **No implicit shell.** Commands are executable-plus-argument arrays and run with `shell: false`.
6. **Networkless reproduction.** Reproduction commands run with Docker network mode `none`.
7. **Bound everything.** CPU, memory, PIDs, workspace bytes, temp bytes, runtime, command count, output bytes and artifact bytes are finite.
8. **Evidence before interpretation.** Exit status, output digests, failure signatures, commands, image identity, artifacts and cleanup proof are persisted before later diagnosis.
9. **Cleanup is part of correctness.** A successful reproduction without verified resource destruction is recorded as `CLEANUP_FAILED`, not success.
10. **Tenant isolation at two layers.** Application authorization and forced PostgreSQL row-level security both scope every record.

## Components

### Reproduction API

The NestJS reproduction module validates input, verifies incident ownership, enforces role permissions, evaluates policy, persists an immutable policy snapshot and creates a transactional outbox message. A denied request creates a durable `POLICY_BLOCKED` result and audit event without entering the queue.

### Sandbox policy engine

`@codeer/sandbox` normalizes and evaluates:

- supported executables: `npm`, `pnpm`, `yarn`, `node`;
- approved command forms;
- lockfile-enforced installation profiles;
- forbidden shell-control syntax and inline evaluation flags;
- repository-relative working directories;
- environment-variable allowlists;
- secret-like values and keys;
- image registry and production digest requirements;
- command and resource budgets;
- installation and reproduction network modes;
- policy override requirements.

The output is a versioned `SandboxPolicyDecision`. The exact decision is stored with the execution so later reviews do not depend on whichever policy version is currently deployed.

### Transactional outbox

An approved reproduction request atomically writes:

- `SandboxExecution`;
- `FailureReproduction`;
- `SandboxPolicySnapshot`;
- incident timeline event;
- audit event;
- idempotency response;
- `sandbox.reproduction.requested` outbox message.

The queue can fail temporarily without losing the execution request. The outbox dispatcher retries publication using deterministic deduplication keys.

### Dedicated sandbox worker

The worker owns:

- bounded queue concurrency;
- execution leases and heartbeats;
- cancellation polling;
- global execution timeout;
- lifecycle transitions;
- command and log persistence;
- artifact recording;
- cleanup proof;
- expired-lease and orphan reconciliation.

A queue retry can reacquire an expired lease, but cannot create a second execution record or bypass the original policy snapshot.

### Docker sandbox provider

The first provider uses the Docker CLI through argument arrays. Production configuration requires a dedicated remote Docker endpoint. Local Unix socket access is rejected in production.

The provider:

1. confines the source worktree beneath a trusted root using real paths;
2. verifies both execution and privileged helper image identities;
3. measures source bytes before allocation;
4. creates a labelled, optionally quota-backed workspace volume;
5. transfers repository files through the authenticated Docker client protocol into a named volume, never through a host-path bind mount;
6. removes `.git`, re-measures the transferred volume and records both image identities;
7. normalizes ownership to UID/GID 1000;
8. creates one unprivileged container per command;
9. streams output through the redaction and integrity pipeline;
10. measures workspace usage after every command;
11. collects only approved regular-file artifacts;
12. removes all labelled containers and the workspace volume;
13. independently verifies their absence.

The provider is intentionally replaceable. A future Kubernetes, Firecracker or confidential-compute provider must satisfy the same interface and evidence contract.

## Execution lifecycle

```text
REQUESTED
   -> POLICY_CHECK
   -> PREPARING
   -> INSTALLING (optional)
   -> REPRODUCING
   -> COLLECTING
   -> CLEANING
   -> COMPLETED
```

Terminal alternatives:

- `POLICY_BLOCKED` — the request violated policy before or during execution;
- `CANCELLED` — a permitted user or service cancelled the run;
- `TIMED_OUT` — the global or command deadline expired;
- `INFRASTRUCTURE_FAILED` — the provider, daemon, image or storage failed;
- `CLEANUP_FAILED` — execution ended, but resource absence could not be proved.

Every transition is persisted. The command centre renders these states directly rather than collapsing them into a generic failure.

## Isolation profile

Every untrusted command container uses:

- non-root UID/GID `1000:1000`;
- read-only root filesystem;
- `--cap-drop ALL`;
- `no-new-privileges:true`;
- isolated IPC namespace;
- no host PID, host IPC or host network;
- no privileged mode;
- no device passthrough;
- no Docker socket mount;
- named workspace volume only;
- bounded `/tmp` tmpfs with `noexec`, `nosuid` and `nodev`;
- CPU, memory, PIDs, process and file-descriptor limits;
- explicit environment construction;
- bounded stop timeout;
- deterministic labels for reconciliation.

Production infrastructure should additionally enforce daemon-level seccomp/AppArmor or SELinux policy, rootless execution where supported, encrypted ephemeral disks, egress firewalls and node isolation.

## Network model

### Reproduction phase

All reproduction commands use `network=none`. The policy engine rejects any reproduction command requesting installation networking.

### Installation phase

Installation is optional and separate. When explicitly requested it must use a pre-provisioned Docker network whose egress gateway enforces:

- approved package registries and DNS names;
- metadata endpoint denial;
- RFC1918, link-local, loopback and control-plane denial;
- PostgreSQL, Redis and internal service denial;
- no direct arbitrary IP access;
- DNS logging and destination audit.

Naming a Docker network is not itself an egress firewall. The worker therefore also requires the network to carry `com.codeer.egress-controlled=true` and a `com.codeer.allowed-destinations-sha256` label matching the exact approved registry/domain policy. Those labels attest trusted infrastructure intent; they do not replace firewall enforcement. Production deployment is not approved until infrastructure tests prove the network policy from inside the sandbox.

## Deterministic reproduction

A reproduction request includes:

- exact execution image;
- optional lockfile-enforced installation commands;
- exact reproduction commands;
- expected non-zero exit behavior;
- expected failure text and minimum similarity;
- repeat count from one to three;
- resource limits;
- artifact paths;
- network policy.

The engine normalizes volatile timestamps, workspace paths and source positions before signature comparison. A result is `REPRODUCED` only when every requested repeat matches the expected signature consistently and satisfies the exit requirement. Divergent repeats are `INCONCLUSIVE`, not averaged into a false success.

The environment fingerprint hashes:

- requested image;
- inspected execution-image ID and repository digests;
- inspected helper-image ID and repository digests;
- policy version;
- normalized commands.

## Log pipeline

Output is processed in order before leaving the execution boundary:

1. receive stdout or stderr bytes;
2. decode bounded UTF-8 safely;
3. redact credential patterns and sensitive assignments;
4. split into bounded chunks;
5. assign a monotonic sequence;
6. hash each chunk with the previous hash;
7. persist through a tenant transaction;
8. expose through paginated BFF/API routes.

When the byte budget is exhausted, CodeER records a truncation marker. It never silently drops output while claiming complete evidence.

## Artifact pipeline

Requested artifact paths must be repository-relative. The provider resolves each candidate inside the workspace, rejects symlink escapes, directories and special files, applies a cumulative byte budget, computes SHA-256 and records:

- origin execution;
- relative path;
- media type;
- byte size;
- digest;
- retention class;
- storage reference, when external storage is later enabled.

Sprint 4 stores manifests, not unrestricted archive extraction. Future object storage must add malware scanning, encryption, tenant keys, signed download authorization and retention enforcement.

## Data consistency and scaling

### Idempotency

The API requires idempotency keys in production. Replays with the same request hash return the same reproduction. Reusing a key with a different request fails.

### Leases

Only one worker owns an execution lease. Every execution-side database mutation is fenced by the current owner and an unexpired lease, so a stale worker cannot write after takeover. Heartbeats continue during long commands and reconciliation. Expired leases are claimed by a reconciler before cleanup and terminalization.

### Cleanup proof history

Cleanup proofs are immutable and append-only. A failed absence check is never overwritten: a later reconciler appends a second proof. Read models select the newest proof while retaining every failed attempt and later correction for audit and forensics.

### Horizontal scaling

API instances are stateless. Outbox dispatchers use row locking. Sandbox workers scale by queue concurrency, but production should dedicate worker pools by region and trust tier. The remote execution fleet should enforce per-organization quotas and global admission control independently of BullMQ concurrency.

### Backpressure

Queue concurrency, organization quotas, provider capacity and storage budgets must all be enforced. An enterprise scheduler should reject or defer work rather than overcommitting execution nodes.

## Failure classification

CodeER distinguishes:

- **Product failure:** repository command ran and produced an expected or unexpected application result;
- **Policy failure:** the request was unsafe or outside approved limits;
- **Infrastructure failure:** the provider could not prepare or execute reliably;
- **Timeout:** deadline enforcement terminated the run;
- **Cancellation:** an authorized cancellation was observed;
- **Cleanup failure:** resources may remain and require operator intervention.

This distinction prevents infrastructure problems from being presented as repository diagnoses.

## Observability

Required production telemetry includes:

- queue depth and age;
- admission denials by policy rule;
- execution duration by phase;
- command timeout and OOM rates;
- log/artifact truncation;
- lease expiry and reacquisition;
- cleanup retries and failures;
- orphan resources found by reconciliation;
- remote daemon health and capacity;
- per-tenant quota usage.

Metrics must use bounded labels. Repository names, command arguments and log content must not become metric labels.

## Availability and recovery objectives

Initial commercial targets:

- API request durability: no acknowledged request lost after database commit;
- outbox publication lag p95 below 5 seconds under normal load;
- execution admission p95 below 30 seconds when capacity exists;
- cleanup attempted in every terminal path;
- stale execution reconciliation within two configured intervals;
- audit and policy evidence retained even if execution infrastructure fails.

These are engineering targets, not contractual SLOs, until measured under load and approved through operational readiness review.

## Validation strategy

Sprint 4 includes:

- policy, path, environment, signature and log-integrity unit tests;
- TypeScript, lint and production builds;
- PostgreSQL persistence smoke for idempotency, RLS, cross-tenant denial, leases, logs, artifacts and cleanup proof;
- database-role boundary verification;
- real Docker provider smoke using a deterministic hostile fixture;
- post-test proof that no managed containers or volumes remain;
- worker image metadata verification;
- high/critical container vulnerability gate;
- secret scanning, dependency audit, CodeQL and SBOM generation.

## Known limitations and future gates

Sprint 4 does not yet make CodeER safe for unrestricted enterprise repositories by itself. Remaining gates include:

- production egress gateway implementation and penetration tests;
- daemon-level mandatory access control profiles;
- per-tenant encrypted artifact storage;
- KMS-backed signing and secrets;
- organization quotas and billing-aware admission;
- multi-region execution and disaster recovery;
- load, chaos and hostile-repository test corpora;
- independent security assessment;
- alternate stronger-isolation provider for high-risk repositories.
