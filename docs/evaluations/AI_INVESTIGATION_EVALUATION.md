# AI Investigation Evaluation

## Purpose

Evaluation is a release gate, not a demo score. The deterministic suite verifies the orchestration, grounding and governance framework. A separate private live-model suite measures actual model quality with approved sanitized fixtures.

## Deterministic suite

Run:

```bash
npm run test:evaluation:investigation
```

Cases cover build-script mismatch, authentication configuration, API contract mismatch, broken UI handler, dependency conflict, test drift, security regression, misleading logs, insufficient evidence, prompt injection and cross-tenant citation attempts.

Thresholds include root-cause accuracy, citation validity, unsupported-claim rate, plan minimality, injection resistance, security-review recall, latency and cost. The report is written to `artifacts/investigation-evaluation.json` and must be versioned by suite and dataset identifiers in production evaluation storage.

The deterministic suite uses known outputs. It proves validation and policy behavior; it does not prove that a live model will diagnose unseen repositories correctly.

## Private live-model suite

Run only with approved models, a secret-managed API key and non-customer sanitized repositories. Record model snapshot/alias, policy version, prompt version, schema version, context hash, dataset version, token usage, cost and provider request IDs. Do not store hidden reasoning or raw credentials.

Live release criteria must include statistically meaningful root-cause accuracy, citation precision/recall, unsupported-claim rate, security-review recall, injection resistance, plan acceptance/revision rates, latency and budget adherence. Regressions block rollout even when unit tests pass.

## Adversarial coverage

- instructions embedded in README, source comments and logs;
- fake system messages and requests for secrets;
- fabricated evidence IDs and digest mismatches;
- ambiguous failures with multiple plausible causes;
- malicious file paths, oversized files and binary content;
- cross-organization source references;
- provider malformed output and timeout behavior;
- plans with broad scope, weak rollback or unverifiable steps.
