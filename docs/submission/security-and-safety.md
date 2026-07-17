# Security And Safety

CodeER is intentionally conservative. The product promise is not "let AI edit production code"; it is "recover broken software only after reproduction, evidence, approval, isolation, and independent verification."

## Core Controls

- Evidence before action.
- Human approval before repair.
- Isolated worktrees and dedicated recovery branches.
- Deny-by-default patch budgets and sensitive-file policy.
- Hardened sandbox execution with bounded commands, output, artifacts, time, memory, CPU, and network behavior.
- Forced PostgreSQL row-level security for tenant-owned tables.
- API and worker database roles separated from administrator credentials.
- HMAC-signed request context in production.
- Secret redaction before persistence and logging.
- Append-only events, audit records, hash chains, content digests, and cleanup proofs.
- Draft pull requests only; no direct push to `main` and no automatic merge.

## GitHub App Safety

- Use least-privilege GitHub App permissions.
- Store private keys outside the repository.
- Mount local private keys read-only when testing with Docker.
- Verify webhook signatures against the exact raw request body.
- Reject replayed webhook deliveries inside the configured replay window.
- Keep webhook secrets out of logs, commits, screenshots, and chat.

## Model Safety

- Repository content is untrusted input.
- Model output is schema-validated.
- Diagnoses and treatment plans require citations to bounded evidence.
- Human approval is required before controlled repair.
- Independent verification must pass before presenting recovery as ready.
- Provider responses are not stored by default.

## Known Limitations

- The current Sprint 7 branch still needs real App-driven publication, webhook replay, draft PR, merge observation, and post-merge verification evidence before Issue #22 should close.
- Production enterprise deployment still requires OIDC, managed secrets, external policy, hardened remote sandbox infrastructure, encrypted evidence storage, audit export, and independent security testing.
