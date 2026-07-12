# Sprint 5: Enterprise Codex Investigation Orchestration

## Purpose

Sprint 5 turns verified failure reproductions into evidence-grounded diagnoses and governed treatment plans. It is a read-only intelligence plane. It cannot modify a worktree, execute arbitrary commands, mutate GitHub, approve its own output, or cross an organization boundary.

## Trust boundaries

```text
Authenticated user / service
        |
        v
API authorization + tenant context + idempotency
        |
        v
Transactional outbox -> investigation queue
        |
        v
Lease-fenced investigation worker
        |
        +--> bounded context builder
        +--> read-only tool gateway
        +--> provider-neutral model gateway
        +--> citation / schema / policy guardrails
        |
        v
Immutable diagnosis + versioned treatment plan
        |
        v
Distinct authenticated human approval
```

Repository files, logs, comments, model output, tool output and user-supplied context are untrusted. System policy, organization AI policy, orchestration instructions and evidence are serialized in separate layers. No repository text is interpreted as an authority to grant tools, reveal credentials, change policy or approve a plan.

## Durable lifecycle

`REQUESTED -> POLICY_CHECK -> CONTEXT_BUILDING -> TRIAGE -> MAPPING -> HYPOTHESIS -> VALIDATION -> SECURITY_REVIEW -> PLAN_COMPOSITION -> CRITIC_REVIEW -> AWAITING_APPROVAL`

Terminal outcomes are `POLICY_BLOCKED`, `INSUFFICIENT_EVIDENCE`, `CANCELLED`, `TIMED_OUT`, `MODEL_FAILED`, `TOOL_FAILED`, `BUDGET_EXCEEDED` and `SECURITY_REJECTED`. Approved, rejected and revision-requested decisions are human governance states, not model states.

Every stage is checkpointed in PostgreSQL. A worker must own a current lease before it can write checkpoints, model invocations, tool calls, guardrail decisions, diagnoses or plans. Heartbeats renew the lease during provider calls. A stale worker is fenced from later writes. Reconciliation resumes or terminates stale work according to the committed checkpoint and retry policy.

## Agent topology

The orchestrator runs specialized roles with agent-specific tools:

- **Triage Agent** — classifies the reproduced failure and identifies missing evidence.
- **Repository Mapper** — maps relevant components, manifests and configuration boundaries.
- **Root Cause Investigator** — creates primary and alternative hypotheses.
- **Contract Analyst** — tests interface, configuration and dependency assumptions.
- **Security Reviewer** — identifies unsafe conclusions, exposure and policy conflicts.
- **Plan Composer** — produces the smallest reversible treatment plan.
- **Independent Critic** — challenges unsupported claims, over-broad scope and weak verification.

No agent receives approval capability. The security reviewer and critic can block publication. Material claims must reference committed context items by source ID and SHA-256 digest.

## Model gateway

`@codeer/ai` defines a provider-neutral `ModelGateway`. The OpenAI implementation uses the Responses API with strict JSON Schema output, bounded output tokens, request timeouts, provider request IDs, safety identifiers, usage accounting and response storage disabled by default. Provider credentials remain in the worker process and are never passed into prompts, tools, queues, the browser or repository sandboxes.

Models are selected by organization policy rather than scattered hard-coded values. Production policy requires an approved model allowlist and a pricing entry for each model. Invocation, input-token, output-token, cost and wall-clock budgets fail closed before another request is started.

## Context and tools

Context packages are deterministic, redacted, size bounded, item bounded and content hashed. Each item records source type, immutable source ID, digest, label, optional path and line range, redaction count and suspicious-instruction count.

The tool gateway provides only tenant-scoped, read-only functions for incident evidence, timeline events, reproduction results, log chunks, artifact manifests, repository health and bounded repository inspection. Repository paths are resolved through real paths; traversal, symlink escape, binary files, oversized files and generated/vendor trees are rejected.

Tool requests and results are schema validated, redacted, hashed, size limited and audited. The gateway exposes no shell, arbitrary SQL, network, repository write, GitHub mutation or approval tool.

## Diagnosis and treatment plans

A valid diagnosis contains a primary hypothesis, alternatives, supporting evidence, contradicting evidence, missing evidence, assumptions, blast radius, security impact, unknowns and a confidence band. Citation validation rejects missing context items, digest mismatches, invalid line ranges and undeclared hypothesis citations.

Treatment plans are immutable and versioned. Each step contains affected components, scope restrictions, risk, security considerations, approved future sandbox verification commands, expected results, rollback procedure and evidence citations. Security review and independent criticism are mandatory before the plan reaches `AWAITING_APPROVAL`.

Approval requires an authenticated `USER` actor. Service, system and agent actors are rejected in both the API and persistence layer. Plans can require multiple distinct approvers. Duplicate decisions by the same actor are idempotent, partial approvals remain pending, and only the threshold-crossing decision marks the plan and investigation approved.

## Scalability

- Queue consumers use bounded organization and worker concurrency.
- PostgreSQL records use tenant-first indexes and forced RLS.
- Large source material is fetched in bounded ranges rather than copied wholesale.
- Model/tool usage is persisted in an append-only usage ledger.
- Stateless API instances can scale horizontally.
- Workers coordinate through durable leases, checkpoints and deterministic queue IDs.
- Provider degradation, budget exhaustion and worker crashes produce resumable states rather than silent partial output.

## Explicit non-capabilities

Sprint 5 does not apply patches, write files, create branches, commit code, open pull requests, deploy software, store hidden chain-of-thought, or grant unrestricted internet access. Those remain separate, approval-gated recovery capabilities.
