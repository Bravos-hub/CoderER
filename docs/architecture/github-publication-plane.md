# GitHub Publication and Recovery Closure Plane

## Purpose

Sprint 7 converts a human-approved, independently verified Sprint 6 recovery package into the exact Git objects and draft pull request published to GitHub. Publication is a separate trust boundary from diagnosis and repair. Models do not receive GitHub write credentials and cannot call publication tools directly.

## Trust boundaries

1. **CodeER control plane** validates tenant, policy, recovery state, patch version and human approval.
2. **Git materializer** deterministically derives the expected tree and commit from the approved base SHA and patch digest.
3. **GitHub App adapter** exchanges an app JWT for a repository-scoped, short-lived installation token.
4. **GitHub API** receives branch and pull-request mutations. Protected branches are never direct targets.
5. **Webhook ingress** verifies the raw request signature and delivery ID before resolving installation tenancy.
6. **CI/review monitor** normalizes external state into append-only publication evidence.
7. **Post-merge verifier** reruns recovery evidence checks before incident closure.

## Invariants

- The recovery must be `READY_TO_PUBLISH`.
- The approved patch version, patch digest, base SHA and expected tree digest are immutable inputs.
- Publication is idempotent per organization and recovery patch version.
- The head branch must use the repository policy prefix and cannot equal a protected base branch.
- Force push, branch-protection bypass and automatic merge are disabled by schema and policy.
- A draft pull request is created before review monitoring begins.
- Requested changes create a governed revision request; they never execute code directly.
- Merge readiness is a decision record, not a merge command.
- Incident closure requires a passing post-merge verification record.

## Lifecycle

`PUBLICATION_REQUESTED -> POLICY_CHECK -> COMMIT_MATERIALIZING -> BRANCH_PUBLISHING -> DRAFT_PR_CREATING -> CI_MONITORING -> REVIEW_MONITORING -> AWAITING_REVIEW -> READY_FOR_HUMAN_MERGE -> MERGED -> POST_MERGE_VERIFYING -> RECOVERY_CONFIRMED -> CLOSED`

Every transition is validated by `@codeer/publication` and should be persisted through an optimistic version check and hash-chained publication event.

## Idempotency

The database enforces:

- one publication per recovery patch version;
- one publication per organization/idempotency key;
- one GitHub delivery record per delivery ID;
- one pull-request record per publication;
- one published commit per publication;
- deterministic outbox deduplication keys.

Retries resume from committed checkpoints. They never create a second branch or pull request for the same approved recovery version.
