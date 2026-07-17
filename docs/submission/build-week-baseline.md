# Build Week Baseline

CodeER existed before the OpenAI Build Week submission period. This file records the project boundary so judges can distinguish pre-existing product and architecture work from implementation completed during the competition period.

## Competition Start

- Official Build Week implementation boundary: July 13, 2026 at 9:00 AM Pacific Time
- Uganda equivalent: July 13, 2026 at 7:00 PM East Africa Time
- Internal final submission target: July 21, 2026 at 9:00 PM East Africa Time

## Baseline Commit

- Baseline commit: `d750442`
- Commit title: `Merge pull request #21 from Bravos-hub/agent/sprint-6-controlled-recovery`
- Local timestamp: July 13, 2026 at 1:23 AM EAT
- Reason: this is the latest commit currently on `main` before the July 13, 2026 at 7:00 PM EAT Build Week implementation boundary.

Create or verify the local baseline tag with:

```bash
git tag -a build-week-baseline d750442 -m "CodeER baseline before OpenAI Build Week submission period"
```

## What Existed Before The Boundary

- Product name, brand direction, tagline, and high-level positioning.
- Product, architecture, brand, roadmap, and security documentation.
- Secure workspace foundation with npm workspaces, Next.js, NestJS, PostgreSQL, Prisma, Redis, Docker Compose, linting, testing, CI, CodeQL, dependency review, secret scanning, and SBOM generation.
- Controlled GitHub repository intake and bounded Git operations.
- Enterprise incident engine with evidence, audit, severity, lifecycle, outbox, tenant scoping, signed request context, and forced PostgreSQL RLS.
- Hardened sandbox and deterministic failure reproduction.
- Evidence-grounded Codex investigation plane with structured model outputs, citations, hypotheses, diagnoses, treatment plans, approvals, and evaluation coverage.
- Controlled recovery plane with approved-plan-only repair, isolated worktrees, patch governance, security review, verification, PR package generation, and no automatic merge.

## What Was Incomplete Or Absent

- Governed GitHub publication through a least-privilege GitHub App.
- Signed webhook receipt and replay-resistant webhook persistence.
- Publication persistence tables and forced RLS.
- Draft pull-request publication records and post-merge verification records.
- Submission evidence package separating pre-existing work from Build Week additions.
- Judge-facing installation, testing, and demo instructions.
- Final three-minute demo video and Devpost submission package.

## Evidence References

- Sprint 6 baseline branch: `agent/sprint-6-controlled-recovery`
- Sprint 7 publication branch: `agent/sprint-7-github-publication`
- Sprint 7 draft PR: `https://github.com/Bravos-hub/CoderER/pull/23`
- Current Sprint 7 commit: `2aa54ef`
