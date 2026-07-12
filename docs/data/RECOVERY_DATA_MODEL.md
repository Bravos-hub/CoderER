# Controlled Recovery Data Model

## Aggregate root

`RecoveryRun` is tenant scoped and links an incident, repository, approved treatment-plan version, organization recovery policy, immutable base commit and deterministic recovery branch. It stores lifecycle status, optimistic version, lease ownership, heartbeat, current checkpoint and current patch version.

## Immutable and append-only records

- `RecoveryCheckpoint` — committed stage state and state hash.
- `RecoveryEvent` — ordered hash-linked lifecycle and governance events.
- `RecoveryAgentRun` — repair/security model provenance, schema version, usage, cost and errors.
- `RecoveryPatchVersion` — immutable unified diff and aggregate digest.
- `RecoveryPatchFile` — per-file operation, digests and line counts.
- `RecoveryPatchHunk` — ranges, treatment-step reference and evidence citations.
- `RecoveryPatchPolicyDecision` — policy version, allow/deny result and reasons.
- `RecoverySecurityReview` — independent decision and findings.
- `RecoveryVerificationRun` / `RecoveryVerificationCheck` — immutable verification matrix.
- `RecoveryPublicationApproval` — signed human decision bound to a patch-version round.
- `RecoveryPullRequestPackage` — versioned immutable review package.
- `RecoveryCleanupRecord` — append-only worktree/branch absence proof.

`RecoveryWorktree` records the controlled repository reference, relative path, branch, base SHA, creation worker and removal state. It contains no repository credential.

## Tenant isolation

All tenant-sensitive tables inherit organization scope through the recovery aggregate and use forced PostgreSQL row-level security. API transactions set the active organization. Queue workers use transaction-local, explicitly controlled worker capability while still enforcing recovery lease ownership.

## Integrity and versioning

Patch, file, checkpoint, event, review, verification, package, approval and cleanup records carry deterministic SHA-256 digests or hashes. Existing patch versions and decisions are not updated in place. A requested revision creates the next patch version and a new publication round.

## Indexing

Tenant-first indexes cover organization/status/time access. Recovery-child tables use recovery and version/sequence uniqueness. Publication approvals are unique per recovery, patch-version round, actor and decision so retries are idempotent while distinct humans can satisfy an approval threshold.

## Retention

Recovery policy defines retention duration. Production deletion must use a governed retention job that preserves legal holds and external audit references. Immutable rows must never be manually edited to repair state; corrective events or cleanup records are appended instead.
