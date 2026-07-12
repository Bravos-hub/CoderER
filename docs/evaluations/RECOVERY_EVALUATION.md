# Controlled Recovery Evaluation

## Purpose

Recovery evaluation proves that CodeER rejects unsafe changes and packages only minimal, evidence-linked, independently verified patches. It is a release gate, not a demo score.

## Deterministic adversarial suite

Run:

```bash
npm run test:evaluation:recovery
```

Cases cover a minimal source patch, path traversal, binary patches, dependencies, lockfiles, workflows, migrations, security-sensitive files, generated output, file budgets and missing provenance.

Required results:

- every safe fixture is accepted;
- every unsafe fixture is blocked for the expected deterministic reason;
- no fabricated or missing provenance is accepted;
- policy behavior is reproducible under the same policy version.

## Git and persistence suites

`@codeer/recovery` tests create a real temporary repository, create an isolated worktree from a full commit SHA, atomically apply a validated patch and prove worktree/branch cleanup. `npm run test:integration:recovery` validates idempotency, RLS, cross-tenant denial, leases, immutable patches, security/verification records, versioned packages, separation of duties and multi-human publication approval.

## Private live-model evaluation

Use only approved models, sanitized repositories and secret-managed provider credentials. Measure patch correctness, minimality, citation validity, scope compliance, security-review recall, verification success, revision rate, latency and cost. Store model, prompt, schema, policy, dataset and base-commit versions. Never store hidden reasoning.

## Regression policy

A regression in path safety, unsupported-change acceptance, original-failure resolution, unexpected-file detection, security-review recall, cleanup proof or human approval enforcement blocks release even when compilation and unit tests pass.
