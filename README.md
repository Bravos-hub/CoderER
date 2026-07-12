# CodeER

> **Emergency response for broken software.**  
> From failing build to verified recovery.

CodeER is an AI software emergency-response platform built for OpenAI Build Week. It uses Codex to reproduce repository failures, diagnose root causes, implement controlled repairs, independently verify recovery and prepare reviewable pull requests.

## Product promise

CodeER follows four operating principles:

1. **Evidence before action** — reproduce or identify the failure before changing code.
2. **Isolation before modification** — perform repairs in a branch, worktree or sandbox.
3. **Verification before approval** — rerun builds, tests, checks and user journeys.
4. **Human control before merge** — keep every patch and pull request reviewable.

## Recovery workflow

```text
ADMIT → TRIAGE → DIAGNOSE → RECOVER → VERIFY
```

## Master documentation

These files are the primary sources of truth for implementation:

- [CodeER Brand Foundation](docs/brand/CODEER_BRAND_FOUNDATION.md) — positioning, language, identity, logo, colour, typography, accessibility and interface rules.
- [CodeER Product Specification](docs/product/CODEER_PRODUCT_SPECIFICATION.md) — goals, personas, domain model, incident lifecycle, agent roles, safety and MVP acceptance criteria.
- [CodeER System Architecture](docs/architecture/CODEER_SYSTEM_ARCHITECTURE.md) — components, state machine, data model, APIs, Codex contracts, sandbox policy and deployment profile.
- [Machine-readable Design Tokens](docs/brand/design-tokens.json) — canonical colours, typography, spacing, radius, motion and breakpoints.

## Focused documentation

### Brand

- [Product Positioning](docs/brand/positioning.md)
- [Logo and Icon Guidelines](docs/brand/logo-guidelines.md)
- [Color and Typography System](docs/brand/color-and-typography.md)

### Product

- [Landing Page Specification](docs/product/landing-page.md)
- [Command Center Dashboard](docs/product/command-center-dashboard.md)

### Architecture and demo

- [Recovery Workflow Architecture](docs/architecture/recovery-workflow.md)
- [Demo Repository Specification](docs/demo/demo-repository.md)

### Submission

- [Devpost Submission Assets](docs/submission/devpost-assets.md)
- [Demo Video Plan](docs/submission/demo-video.md)
- [Submission Story](docs/submission/submission-story.md)
- [Build Week Execution Plan](docs/roadmap/build-week-plan.md)

## Current MVP scope

The hackathon MVP is intentionally narrow:

- GitHub repositories;
- React or Next.js frontend;
- Node.js backend;
- npm or pnpm workspaces;
- Docker-based execution sandbox;
- Codex-powered investigation and repair;
- independent verification;
- pull-request preparation;
- no automatic merge.

## Core deliverable

A completed recovery session must provide:

1. original failure and reproduction evidence;
2. root-cause diagnosis;
3. approved treatment plan;
4. isolated patch and complete diff;
5. independent verification report;
6. known limitations and rollback guidance;
7. reviewable pull-request package.

## Repository status

CodeER is in the brand, product-design and implementation-planning phase for OpenAI Build Week, 13–21 July 2026. The next engineering milestone is repository intake and isolated sandbox execution.
