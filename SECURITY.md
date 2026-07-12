# Security Policy

CodeER processes source code, build output, repository metadata and software-failure evidence. Treat all repository content, package scripts, logs, generated instructions and artifacts as hostile input.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub private vulnerability reporting:

- `https://github.com/Bravos-hub/CoderER/security/advisories/new`

Include the affected component, impact, reproduction steps, expected and observed behavior, environment, relevant logs after removing secrets, and any known mitigation. Do not include real access tokens, private keys, cookies, customer source code or personal data.

## Response targets

| Severity | Initial acknowledgement |    Triage target |
| -------- | ----------------------: | ---------------: |
| Critical |                 4 hours |         24 hours |
| High     |          1 business day |  2 business days |
| Medium   |         3 business days |  5 business days |
| Low      |         5 business days | 10 business days |

Targets are operational goals, not a warranty or service-level agreement.

## Supported versions

Security fixes are applied to the current `main` branch and current supported deployment release. Pre-release branches and local development environments are not production support channels.

## Security guarantees implemented in the repository

- Production configuration fails closed when authentication, tenant context, signed context or required sandbox controls are missing.
- Browser code never receives internal API keys, GitHub App private keys, database credentials, Redis credentials or sandbox-engine credentials.
- Organization-owned data is scoped in application queries and protected with forced PostgreSQL row-level security.
- API and worker database identities are non-superuser and `NOBYPASSRLS`; worker bypass is an explicit transaction-local capability.
- Incident events, evidence, audit records, sandbox policy snapshots, commands, log chunks, artifacts and cleanup records are append-only or mutation-restricted where appropriate.
- Security-sensitive timeline data is integrity-hashed; sandbox logs are redacted before persistence and linked by monotonic sequence and hash chain.
- Repository and sandbox paths are canonicalized and confined to approved roots; traversal and symlink escapes are rejected.
- Git and process execution use argument arrays with `shell: false`; ambient Git configuration, hooks and prompts are disabled.
- Sandbox command policy is deny-by-default and rejects shell control syntax, unsupported binaries, secret-bearing environment variables, unsafe working directories and excessive resource requests.
- Production sandbox execution requires a dedicated remote Docker boundary, digest-pinned execution and helper images, approved registries and quota-aware workspaces.
- Untrusted repository containers run non-root with read-only root filesystems, dropped Linux capabilities, `no-new-privileges`, bounded CPU, memory, PID, time, output, log, artifact and workspace limits.
- Sandboxes receive no Docker socket, host namespace, privileged mode, arbitrary device, application credentials or inherited host environment.
- Reproduction is networkless. Dependency-installation egress requires an attested restricted network whose destination-policy digest matches the approved registries/domains and whose gateway blocks metadata, private, host and control-plane destinations.
- Cancellation, timeout, worker failure and stale leases all trigger idempotent cleanup; every execution write is lease-fenced and cleanup corrections append immutable proof rather than overwriting failed evidence.
- CI includes linting, type checking, tests, build verification, secret scanning, dependency auditing, CodeQL, dependency review, SBOM generation, Docker security smoke tests and container scanning.

## AI investigation security guarantees

- Repository files, logs, comments, metadata, artifacts and user context are untrusted evidence and cannot grant tools or override policy.
- Model access is organization allowlisted and budgeted by invocation count, input/output tokens, estimated cost, concurrency and duration.
- Provider calls use strict structured output; response storage is disabled by default and provider errors are redacted.
- The model receives no GitHub, OpenAI, database, Redis, Docker, session or application credentials.
- Agent tools are read-only, role-specific, tenant-scoped, path confined, size bounded, lease fenced and audited.
- Diagnoses and plans are rejected unless schemas, citations, evidence hashes, security review and independent critic rules pass.
- Hidden model reasoning is not requested, persisted or displayed; only concise structured findings and evidence references are retained.
- Treatment-plan decisions require authenticated human `USER` identities. Service, system and agent actors cannot approve, reject or request revision.
- Multi-approval plans count distinct human actors; duplicate decisions are idempotent and final approval is emitted only at the configured threshold.
- AI context, model/tool audit, diagnosis, plan, approval and usage records are tenant protected by forced RLS and immutable where appropriate.

Prohibited AI configurations include arbitrary shell or network tools, model-selected permissions, unbounded repository context, provider credentials in prompts, raw chain-of-thought storage, automatic plan approval, silent model substitution and cross-tenant retrieval.

See [AI Orchestration Threat Model](docs/security/AI_ORCHESTRATION_THREAT_MODEL.md) and [AI Investigation Operations Runbook](docs/operations/AI_INVESTIGATION_RUNBOOK.md).

## Production sandbox restrictions

The following configurations are prohibited for enterprise deployment:

- mounting `/var/run/docker.sock` or another container-runtime socket into the CodeER worker;
- running repository containers with `--privileged`, host PID, host IPC, host network or added Linux capabilities;
- mutable sandbox image tags without a verified digest;
- unrestricted internet access or an ordinary bridge network represented as an egress allowlist;
- forwarding GitHub, OpenAI, cloud, database, Redis, CI or CodeER service credentials into a sandbox;
- executing repository commands directly on an API, worker or operator host;
- using a PostgreSQL superuser or `BYPASSRLS` role for application traffic;
- treating successful process exit as proof of cleanup;
- accepting artifacts without path confinement, size limits, type metadata and integrity digests.

See [Sandbox Threat Model](docs/security/SANDBOX_THREAT_MODEL.md) and [Sandbox Operations Runbook](docs/operations/SANDBOX_RUNBOOK.md).

## Required repository and deployment settings

- Protect `main` and require pull-request review.
- Require CI, security and sandbox-profile checks before merge.
- Enable secret scanning, push protection, Dependabot and code scanning where the GitHub plan supports them.
- Restrict GitHub App permissions to repository metadata and content operations required by the active workflow.
- Store runtime secrets in a managed secret system, not `.env` files in production.
- Use separate migration, API, worker and sandbox-engine identities.
- Restrict sandbox-engine network access to the worker control plane and approved registries or mirrors.
- Export audit and cleanup failures to centralized monitoring with paging for orphaned-resource conditions.
- Regularly test database restore, role boundaries, sandbox reconciliation, image revocation and credential rotation.
