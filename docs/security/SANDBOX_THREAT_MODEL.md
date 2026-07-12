# Sandbox Threat Model

## Scope

This model covers the path from a reproduction request through policy evaluation, queueing, remote container execution, log and artifact collection, persistence, cleanup and operator reconciliation.

## Protected assets

- customer source code and repository history;
- GitHub installation credentials;
- OpenAI credentials and model context;
- CodeER API and service credentials;
- PostgreSQL and Redis availability and confidentiality;
- tenant evidence and audit records;
- execution fleet integrity;
- host filesystem, kernel and network;
- other tenants' repositories and sandboxes;
- incident conclusions and verification evidence.

## Trust boundaries

1. Browser to Next.js BFF.
2. BFF to authenticated API.
3. API to PostgreSQL and transactional outbox.
4. Worker to PostgreSQL/Redis.
5. Worker to remote Docker daemon.
6. Docker daemon to untrusted command container.
7. Container output to log redaction pipeline.
8. Workspace to artifact collector.
9. Artifact manifest to future object storage.

Repository content is untrusted on both sides of every execution boundary.

## Adversaries

- malicious repository owner intentionally attacking CodeER;
- compromised dependency or package lifecycle script;
- attacker controlling a pull request admitted for analysis;
- tenant user attempting cross-tenant access;
- compromised or buggy worker;
- operator accidentally weakening policy;
- attacker with network position between worker and Docker daemon;
- denial-of-service actor consuming compute, storage or logs;
- output-injection attacker placing secrets or misleading instructions in logs.

## Threats and controls

### Host command injection

**Threat:** arguments or repository data reach a host shell.

**Controls:** executable allowlist, argument arrays, `shell: false`, no `bash -c`, forbidden control syntax, no repository command executed outside `SandboxProvider`.

### Container escape and privilege escalation

**Threat:** untrusted code exploits excessive privileges or kernel exposure.

**Controls:** non-root user, dropped capabilities, no-new-privileges, read-only rootfs, no devices, no privileged mode, no host namespaces, no Docker socket, bounded PIDs and resources, dedicated remote execution nodes. Production additionally requires mandatory access control and patched kernels.

### Docker control-plane compromise

**Threat:** a worker or sandbox obtains daemon authority.

**Controls:** Docker socket never enters sandbox; production rejects local Unix socket; remote endpoint uses mutually authenticated transport; worker credentials are restricted to a dedicated execution fleet; daemon is not shared with control-plane services.

### Network pivoting and metadata theft

**Threat:** repository code reaches internal services or cloud metadata.

**Controls:** reproduction network is `none`; installation uses a pre-provisioned restricted network only; the worker verifies an egress-control label and exact destination-policy digest before attachment; private, link-local, metadata and control-plane destinations are denied at egress infrastructure; no sensitive environment variables are provided.

### Secret exfiltration

**Threat:** inherited variables, mounted files, logs or errors expose credentials.

**Controls:** minimal explicit environment, sensitive-key and value rejection, no credential mounts, read-only source copy, output redaction before persistence, safe user-facing errors, secret scanning. Redaction is defense in depth and is not a substitute for withholding secrets.

### Path traversal and symlink escape

**Threat:** working directories, source roots or artifact paths escape the approved workspace.

**Controls:** realpath confinement beneath trusted root, POSIX path normalization, absolute/traversal rejection, symlink resolution inside mounted workspace, regular-file-only artifacts.

### Resource exhaustion

**Threat:** fork bombs, memory pressure, disk fill, infinite execution or log floods affect availability.

**Controls:** CPU, memory, PIDs, tmpfs, command, execution, log, artifact and workspace limits; queue concurrency; timeouts; output truncation; quota-aware volumes in production; reconciliation.

### Cross-tenant data access

**Threat:** IDs from another organization are used to read or modify executions.

**Controls:** signed tenant context, role permissions, tenant-scoped SQL, forced RLS, separate API and worker database roles, guarded worker bypass requiring role membership plus transaction-local setting.

### Queue replay or duplicate unsafe execution

**Threat:** retries execute the same request multiple times.

**Controls:** API idempotency key, durable execution ID, outbox deduplication key, queue job ID, conditional claim, lease-owner fencing on every execution write, heartbeat during long commands and idempotent cleanup.

### Evidence tampering

**Threat:** logs, artifacts, policy or cleanup records are modified to misrepresent the result.

**Controls:** immutable policy snapshot, log hash chain, artifact SHA-256, append-only events, audit hash chain, immutable database triggers, execution and helper image identities in the environment fingerprint, and append-only cleanup proofs.

### Cleanup evasion

**Threat:** malicious or crashed runs leave resources behind.

**Controls:** cleanup in `finally`, execution labels, forced container removal, volume removal, three verification attempts, absence checks, `CLEANUP_FAILED` state, append-only corrective cleanup proofs, periodic orphan reconciliation and operator runbook.

### Image substitution and supply-chain attack

**Threat:** a mutable tag resolves to unexpected content.

**Controls:** approved registries, production digest pins for both execution and helper images, pre-execution inspection, both image identities in the environment fingerprint, worker image scan, dependency review and SBOM. A private curated registry is recommended for commercial production.

### Misleading output or prompt injection

**Threat:** logs contain instructions intended to manipulate later AI agents or operators.

**Controls:** output is evidence, never trusted policy; later model prompts must delimit and label repository output as untrusted; commands are not generated from logs without policy evaluation and human approval.

## Residual risks

- container isolation shares a kernel and is weaker than a microVM boundary;
- dependency installation egress requires infrastructure enforcement outside Docker CLI flags;
- redaction cannot guarantee discovery of every secret format;
- a zero-day kernel or container-runtime escape may defeat controls;
- compromised execution-node administrators can access source while it is present;
- artifact malware analysis is not included in Sprint 4;
- production quota enforcement depends on a capable volume driver and scheduler.

High-sensitivity organizations should use a stronger provider, dedicated nodes, confidential computing where available and customer-managed encryption keys.

## Security test cases

The release gate must exercise:

- shell-control and inline-evaluation denial;
- path and symlink escapes;
- credential-like environment values;
- unpinned production images;
- reproduction network requests;
- timeout and cancellation;
- OOM/fork and output limits in a controlled test fleet;
- synthetic secret redaction;
- repeat-run consistency;
- cleanup after success and failure;
- stale-resource reconciliation;
- cross-tenant API and RLS denial;
- API role inability to activate worker bypass;
- container high/critical vulnerability scan.
