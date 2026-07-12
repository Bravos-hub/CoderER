# AI Investigation Operations Runbook

## Health indicators

Monitor queue depth, oldest pending age, active leases, stale runs, model error rate, tool denial rate, citation rejection rate, budget exhaustion, p95 latency, token/cost usage, approval backlog and cross-tenant authorization failures.

## Investigation stuck in progress

1. Inspect the latest checkpoint and lease expiry.
2. Confirm worker health and Redis connectivity.
3. Confirm the provider circuit and organization budget.
4. Never edit checkpoint state manually.
5. Run reconciliation; it will resume or finalize only after lease expiry.
6. Preserve provider request IDs and correlation IDs in the incident record.

## Provider degradation

- Stop new invocations when the circuit breaker or budget gate opens.
- Allow in-flight requests to time out and persist a resumable failure state.
- Do not silently switch to an unapproved model.
- Resume only after policy-approved provider/model health is restored.

## Prompt-injection or unsafe-output alert

- Keep the investigation in `SECURITY_REJECTED` or review state.
- Inspect guardrail decisions and cited context—not hidden reasoning.
- Quarantine the suspicious source item if required while retaining its hash and provenance.
- Do not grant additional tools to “see whether it works.”
- File a security incident for credential requests, cross-tenant references or policy-escalation attempts.

## Budget exhaustion

The worker stops before another invocation when model count, tokens, cost or duration would exceed policy. Increase budgets only through a versioned organization-policy change with an audit record. Resume the run from its committed checkpoint after approval.

## Human approval incidents

Service-account decisions must return 403. Validate the identity edge, signed user session, actor type and role. For multi-approval plans, verify distinct actor IDs and the immutable `PlanApproval` entries. Never reduce `requiredApprovals` by direct SQL.

## Migration and rollback

1. Apply migrations with the migration role.
2. Provision/verify API and worker roles.
3. Run the investigation persistence smoke test and RLS checks.
4. Deploy API and worker before enabling the UI.
5. Roll back application traffic by disabling new investigation creation; do not drop immutable AI tables during an incident.

## Release gates

- source checks and production builds;
- Prisma generation and schema validation;
- migration and forced-RLS smoke tests;
- deterministic adversarial evaluation thresholds;
- provider mock tests and credential-redaction tests;
- a private live-model evaluation using approved models and sanitized fixtures;
- dependency, secret, CodeQL and container scans;
- identity/session integration and multi-human approval validation.
