# CodeER

> **Emergency response for broken software.**  
> From failing build to verified recovery.

CodeER is an AI software emergency-response platform built for OpenAI Build Week. It uses Codex to reproduce repository failures, diagnose root causes, implement controlled repairs, independently verify recovery, and prepare reviewable pull requests.

## Product promise

CodeER follows four operating principles:

1. **Evidence before action** — reproduce or identify the failure before changing code.
2. **Isolation before modification** — perform repairs in a branch, worktree, or sandbox.
3. **Verification before approval** — rerun builds, tests, checks, and user journeys.
4. **Human control before merge** — keep every patch and pull request reviewable.

## Recovery workflow

```text
ADMIT -> TRIAGE -> DIAGNOSE -> RECOVER -> VERIFY
```

## Documentation

- [Product Positioning](docs/brand/positioning.md)
- [Logo and Icon Guidelines](docs/brand/logo-guidelines.md)
- [Color and Typography System](docs/brand/color-and-typography.md)
- [Landing Page Specification](docs/product/landing-page.md)
- [Command Center Dashboard](docs/product/command-center-dashboard.md)
- [Demo Repository Specification](docs/demo/demo-repository.md)
- [Recovery Workflow Architecture](docs/architecture/recovery-workflow.md)
- [Devpost Submission Assets](docs/submission/devpost-assets.md)
- [Demo Video Plan](docs/submission/demo-video.md)
- [Submission Story](docs/submission/submission-story.md)
- [Build Week Execution Plan](docs/roadmap/build-week-plan.md)

## Current scope

The hackathon MVP is intentionally narrow:

- GitHub repositories
- React or Next.js frontend
- Node.js backend
- npm or pnpm workspaces
- Docker-based execution sandbox
- Codex-powered investigation and repair
- Independent verification
- Pull-request preparation

## Status

CodeER is currently in the brand, product-design, and implementation-planning phase for OpenAI Build Week, 13–21 July 2026.
