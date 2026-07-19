# Security workflow evidence — dependency-review gate restored

## Failed run

- Run ID: `29696419536` (workflow `Security`, event `pull_request`, branch
  `agent/sprint-9-release-certification`, PR #30, recorded 2026-07-19T17:13:59Z)
- Failed job: `dependency-review`
- Passing jobs in the same run: `supply-chain` (secret scan, `npm audit
--omit=dev --audit-level=high`, SBOM generation, `codeer-sbom` artifact upload)

## Root cause (from the job log, not inferred)

The `dependency-review` step failed with:

```text
##[error]Dependency review is not supported on this repository. Please ensure
that Dependency graph is enabled, see
https://github.com/Bravos-hub/CoderER/settings/security_analysis
```

`actions/dependency-review-action@v4` requires the repository Dependency Graph
feature. It was not enabled on `Bravos-hub/CoderER`, so every `pull_request`
run of the Security workflow failed. The merge-to-`main` Security runs passed
only because the job is guarded by `if: github.event_name == 'pull_request'`
and is skipped on push events — the gate was red on every PR, not absent.

## Fix applied

Repository-settings change only; no workflow code was modified and the gate was
not disabled, narrowed or downgraded:

```text
PUT /repos/Bravos-hub/CoderER/vulnerability-alerts   → HTTP 204 (enabled)
GET /repos/Bravos-hub/CoderER/vulnerability-alerts   → HTTP 204 (confirmed enabled)
```

Enabling Dependabot alerts on a repository automatically enables the Dependency
Graph feature that `dependency-review-action` consumes. (The dedicated
`PUT /repos/{owner}/{repo}/dependency-graph` endpoint returned 404 and was not
used.)

Applied via authenticated `gh api` as `Bravos-hub` on 2026-07-19, with operator
approval.

## Rerun evidence

- Rerun triggered: `gh run rerun 29696419536` on 2026-07-19.
- Final state of run `29696419536`: **success**
  - `supply-chain`: success
  - `dependency-review`: success

## Companion gates at the baseline SHA (`d1da589`)

| Gate                            | Run ID      | Result              |
| ------------------------------- | ----------- | ------------------- |
| CI (push, main)                 | 29696575195 | success             |
| CodeQL (push, main)             | 29696575148 | success             |
| Security (push, main)           | 29696575145 | success             |
| CI (pull_request, PR #30)       | 29696419552 | success             |
| CodeQL (pull_request, PR #30)   | 29696419541 | success             |
| Security (pull_request, PR #30) | 29696419536 | success after rerun |

SBOM artifact produced by the supply-chain job: `codeer-sbom`
(`artifacts/codeer-sbom.cdx.json`, 30-day retention).

## Guard against regression

`npm run release:verify-workflows` (`scripts/verify-release-workflows.mjs`)
statically asserts that the CI, Security and CodeQL workflows exist, that the
`dependency-review` job remains present with `fail-on-severity: high`, that it
is scoped to pull requests, and that no security job is silently disabled
(`if: false`). Run it in release validation and before any workflow edit is
merged.
