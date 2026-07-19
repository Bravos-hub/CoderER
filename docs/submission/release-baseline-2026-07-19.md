# CodeER competition release baseline — 2026-07-19

This document records the immutable reference point for the competition release
after PR #30. All subsequent release evidence must reference this SHA or a later
release SHA. No secrets, credentials or tokens appear in this report.

## Repository

- Repository: `Bravos-hub/CoderER`
- Base branch: `main`
- Main SHA (baseline): `d1da589436fbd147441fc276402b3762b7b63019`
- PR #30 merge SHA: `d1da589436fbd147441fc276402b3762b7b63019`
- PR #30 head commit: `3f70786` (`agent/sprint-9-release-certification`)
- Local release tag: `competition-rc0` (annotated, points at the baseline SHA)
- Working tree at capture: clean
- Recorded at: 2026-07-19T19:47:02Z

## Toolchain

| Tool   | Version  | Note                                                                                                   |
| ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| Node   | v24.18.0 | Project toolchain (`>=22 <27` per `package.json` engines); CI and Docker builds standardize on Node 24 |
| npm    | 11.16.0  | Bundled with Node 24.18.0                                                                              |
| Docker | 29.1.3   | Local operator environment                                                                             |

## Database migration version

Latest migration directory: `20260719000100_sprint8_command_center`
(`packages/database/prisma/migrations`).

## Open issues at baseline

| Issue | Title                                                                              |
| ----- | ---------------------------------------------------------------------------------- |
| #29   | Competition Closure: Release Candidate, Live Demo and Submission Certification     |
| #22   | Sprint 7: GitHub Publication, Pull-Request Lifecycle and Verified Recovery Closure |
| #20   | Sprint 6: Controlled Repair, Patch Governance and Pull-Request Packaging           |

## Workflow status at baseline

| Run ID      | Workflow | Event        | Branch                               | Result                                                 |
| ----------- | -------- | ------------ | ------------------------------------ | ------------------------------------------------------ |
| 29696575195 | CI       | push         | main                                 | success                                                |
| 29696575148 | CodeQL   | push         | main                                 | success                                                |
| 29696575145 | Security | push         | main                                 | success (dependency-review job skipped on push events) |
| 29696419552 | CI       | pull_request | agent/sprint-9-release-certification | success                                                |
| 29696419541 | CodeQL   | pull_request | agent/sprint-9-release-certification | success                                                |
| 29696419536 | Security | pull_request | agent/sprint-9-release-certification | **failure** — dependency-review job                    |

## Known red gate

The PR #30 Security run (`29696419536`) failed in the `dependency-review` job.
Root cause (from the job log): Dependency Graph is not enabled on the
repository, so `actions/dependency-review-action@v4` cannot run. The merge-to-`main`
Security run passed only because the job is conditional on
`if: github.event_name == 'pull_request'` and is skipped on push events.

Resolution is tracked in `docs/submission/security-workflow-evidence.md`.
