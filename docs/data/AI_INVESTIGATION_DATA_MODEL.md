# AI Investigation Data Model

## Aggregate roots

- `OrganizationAiPolicy` — approved provider, models, tools, budgets, retention and governance requirements.
- `InvestigationRun` — tenant-scoped durable workflow, lease, checkpoint and cancellation state.
- `Diagnosis` — immutable evidence-grounded conclusion.
- `TreatmentPlan` — immutable versioned recovery procedure and approval state.
- `EvaluationRun` — versioned quality and safety benchmark result.

## Execution records

`InvestigationCheckpoint`, `InvestigationEvent`, `AgentRun`, `ModelInvocation`, `InvestigationToolCall`, `GuardrailDecision`, `AiUsageLedger` and `InvestigationContextPackage` provide operational and audit provenance. Context items store bounded redacted content with source IDs and digests. Raw credentials and hidden reasoning are prohibited.

## Diagnosis graph

`RootCauseHypothesis` stores primary, alternative and rejected hypotheses. `DiagnosisEvidenceLink` creates explicit relations from diagnosis claims to immutable evidence identifiers and hashes. A diagnosis is not publishable when citations do not validate against its committed context package.

## Plan governance

`TreatmentPlan` versions are unique per investigation. `TreatmentPlanStep` is append-only and ordered. `PlanApproval` is immutable and unique by plan, plan version, actor and decision. Approval state changes only when the distinct human approval count reaches `requiredApprovals`; rejection and revision requests remain explicit terminal governance outcomes for that version.

## Integrity and isolation

- Tenant-owned root records carry `organizationId` and forced RLS.
- Child records derive organization ownership through their investigation, context, diagnosis or plan parent.
- Immutable triggers protect prompt versions, checkpoints, events, context, model/tool audit records, diagnoses, evidence links, plan steps, approvals and usage ledger entries.
- Content hashes cover committed context, outputs, decisions and evaluation results.
- Provider request IDs are metadata; provider credentials and full raw provider payloads are not persisted.

## Retention

Organization policy sets investigation retention. Deletion and legal-hold execution require a future governed retention service; application code must not bypass immutable evidence triggers ad hoc. Production object storage must use encryption, malware scanning, regional controls and retention locks where required.
