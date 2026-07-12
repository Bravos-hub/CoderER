# Sprint 6: Controlled Recovery Plane

## Purpose

Sprint 6 converts an approved, evidence-grounded treatment plan into a minimal patch inside an isolated Git worktree. It adds the first code-changing workflow in CodeER, but it does not permit direct changes to protected branches, automatic merge, unrestricted shell access or model self-approval.

## Trust boundaries

```text
Approved treatment plan + verified base commit
        |
        v
Recovery API authorization + tenant context + idempotency
        |
        v
Transactional outbox -> controlled recovery queue
        |
        v
Lease-fenced recovery worker
        |
        +--> isolated Git worktree
        +--> constrained repair model
        +--> canonical diff parser
        +--> deny-by-default patch policy
        +--> independent security reviewer
        +--> hardened sandbox verification
        |
        v
Immutable patch + verification + PR package
        |
        v
Distinct authenticated human publication approval
```

Repository content, treatment-plan text, model output, generated diffs and verification logs are untrusted. Deterministic application code owns permissions, path confinement, lifecycle transitions, change budgets, approval thresholds and publication readiness.

## Durable lifecycle

`REQUESTED -> POLICY_CHECK -> WORKTREE_PREPARING -> PATCH_PLANNING -> PATCH_GENERATING -> PATCH_VALIDATING -> SECURITY_REVIEW -> VERIFYING -> PACKAGE_BUILDING -> AWAITING_PUBLICATION_APPROVAL -> READY_TO_PUBLISH`

Terminal outcomes include `POLICY_BLOCKED`, `PATCH_REJECTED`, `SECURITY_REJECTED`, `VERIFICATION_FAILED`, `WORKTREE_FAILED`, `MODEL_FAILED`, `TOOL_FAILED`, `BUDGET_EXCEEDED`, `TIMED_OUT`, `CANCELLED` and `CLEANUP_FAILED`.

Every worker-side mutation is protected by a current execution lease. Checkpoints, events, patch records, reviews, verification results and cleanup evidence are append-only or immutable. Reconciliation handles expired leases without permitting stale workers to continue writing.

## Worktree isolation

A recovery is pinned to an immutable 40-character base commit SHA and a deterministic non-protected recovery branch. The worktree manager:

- resolves repository and recovery roots through canonical paths;
- rejects traversal, symlink escape, dirty source repositories and short or malformed commit identifiers;
- rejects protected branch names;
- creates worktrees with argument-array Git execution and `shell: false`;
- applies patches using `git apply --check` before `git apply --index`;
- rolls back failed applications;
- records cleanup proof after removing both the worktree and temporary branch.

The API and model never receive an unrestricted Git mutation tool.

## Patch governance

The recovery policy controls allowed and denied paths, file types, file count, changed-line count, hunk count, patch bytes, new/deleted files, generated output, dependencies, lockfiles, workflows, infrastructure, migrations and security-sensitive files.

A patch is accepted only when:

1. it is a valid canonical unified diff;
2. every path remains inside the approved repository root;
3. binary, submodule, device-file and symlink changes are absent;
4. every hunk references a treatment-plan step and diagnosis evidence;
5. all scope and budget rules pass;
6. the applied Git diff contains exactly the validated path set;
7. no secret pattern or forbidden generated output is introduced.

Each patch version is immutable and hash-addressed. Revisions create a new version and a new publication-approval round.

## Agent separation

The repair model receives only the approved plan, bounded repository context, declared file scope, evidence citations and patch limits. The independent security reviewer receives the resulting patch and security context, not hidden repair-agent state. Neither agent receives approval, Git push or merge capability.

Model output is rejected unless it passes provider schema validation, domain validation, citation validation, diff parsing, policy evaluation, security review and verification.

## Verification

Verification runs inside the hardened Sprint 4 sandbox. The matrix can include the original failure, dependency installation, formatting, linting, type checking, unit tests, integration tests, production build, security checks and critical journeys.

A publishable result requires:

- the original failure to no longer reproduce;
- all mandatory checks to pass;
- no unexpected file changes;
- sandbox cleanup verification;
- an `ALLOW` security review;
- an immutable verification report linked to the patch digest.

## Pull-request package

The package contains a title, executive summary, root cause, treatment-plan reference, base commit, recovery branch, changed files, patch statistics, evidence links, security result, verification matrix, limitations and rollback instructions.

Sprint 6 produces a package and publication authorization state. It does not automatically push, create or merge a pull request. A future publication adapter must recreate the approved branch from the immutable base and exact patch digest, then open a draft PR under a human-approved capability.

## Scalability and resilience

- deterministic queue IDs and transactional outbox delivery;
- bounded worker concurrency;
- lease fencing and heartbeats;
- checkpointed stages and resumable revisions;
- forced PostgreSQL RLS and tenant-first indexes;
- bounded model, patch and verification budgets;
- idempotent cleanup and stale-worktree reconciliation;
- immutable events and integrity hashes for audit export.
