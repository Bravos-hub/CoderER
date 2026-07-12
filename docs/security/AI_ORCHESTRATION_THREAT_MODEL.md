# AI Orchestration Threat Model

## Assets

Protected assets include customer source code, failure evidence, organization policy, provider credentials, model/tool telemetry, diagnoses, treatment plans, approval identities, audit records and tenant boundaries.

## Adversaries and hostile inputs

- A repository author embedding prompt-injection instructions in code, documentation or metadata.
- A compromised dependency or generated file attempting to exfiltrate secrets.
- A malicious tenant attempting cross-tenant source or evidence access.
- A model producing fabricated citations, unsafe plans or tool escalation requests.
- A stale or compromised worker trying to write after lease loss.
- A service account attempting to approve its own generated treatment plan.
- A provider failure returning malformed, oversized or secret-bearing output.

## Primary controls

### Prompt-injection containment

Repository and incident material is labelled as untrusted evidence and placed after immutable system and organization policy. Instruction-like evidence is counted and recorded by a guardrail. It never changes tool permissions or workflow state. Tool authorization is performed in deterministic application code, not by the model.

### Least-privilege tools

Agents receive an explicit allowlist by role. The gateway is read-only, tenant-scoped, size bounded and audited. There is no shell, direct SQL, write API, approval function, generic HTTP client or unrestricted file reader.

### Output distrust

Model output must pass JSON Schema validation, domain schema validation, citation validation, policy validation, security review and independent criticism. Invalid output is rejected and cannot be persisted as a diagnosis or treatment plan.

### Credential isolation

OpenAI, GitHub, database, Redis, Docker and application credentials never enter prompts or tool outputs. Provider errors are redacted before they become application errors. Provider response storage is disabled by default.

### Tenant isolation

Application authorization scopes every operation to the active organization. Tenant-sensitive AI tables use forced PostgreSQL RLS. The API and worker use non-superuser `NOBYPASSRLS` roles; worker bypass is transaction-local and limited to queue-controlled work.

### Durable execution integrity

All execution-side writes are lease fenced. Context packages, model outputs, citations, audit events and approvals carry hashes and version metadata. Immutable records reject update or delete operations. Stale runs are reconciled from committed checkpoints.

### Human governance

Only authenticated human `USER` actors with explicit roles can approve, reject or request revision. BFF service identity is valid for reads and orchestration requests, not plan decisions. Production human decisions require a signed, expiring, HttpOnly user session supplied by an identity edge or OIDC adapter. Multiple approvals must come from distinct actors.

## Residual risks

- Models can still make plausible but wrong inferences; evaluation, citations and human review reduce but do not eliminate this risk.
- A compromised identity provider could issue a valid human session; production requires MFA, short lifetimes, key rotation and centralized identity monitoring.
- Exact provider behavior can change; model/prompt/schema versions and regression evaluations are release controls.
- Context selection can omit decisive evidence; the system records missing evidence and supports resumable investigation.
- Deterministic fixtures do not prove live-model quality; live, private evaluation is a separate release gate.

## Required production controls

Workforce OIDC, MFA, managed signing keys, secret manager delivery, regional encrypted storage, outbound provider allowlisting, provider data-processing configuration, SIEM export, anomaly detection, quota alerting, retention enforcement, incident response, penetration testing and periodic red-team evaluation are required before unrestricted enterprise repositories are admitted.
