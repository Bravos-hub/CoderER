# Sprint 1 and Sprint 2 Delivery Record

## Delivered scope

### Sprint 1 — Secure workspace foundation

- npm monorepo with web, API, worker and shared packages.
- Node.js 24 target and deterministic lockfile installation.
- Next.js command centre shell.
- NestJS orchestration API.
- BullMQ worker control plane.
- PostgreSQL, Prisma and Redis foundations.
- Docker Compose and non-root application images.
- shared configuration, contracts and logging packages.
- CI, CodeQL, Dependabot, dependency review, secret scanning and SBOM generation.
- Codespaces configuration for mobile development.

### Sprint 2 — Repository intake

- repository admission UI and API.
- server-side BFF credential containment.
- canonical GitHub repository URL parsing.
- GitHub App installation token support.
- bounded repository metadata and branch inspection.
- shallow credential-free clone URLs with authorization headers held only in process memory.
- Git protocol restrictions, disabled prompts, hooks and ambient configuration.
- deterministic refresh and cleanup.
- repository file and byte quotas.
- isolated worktree and recovery-branch creation.
- typed queue progress and intake result contracts.

## Validation record

- Prettier formatting check: passed.
- ESLint: passed.
- TypeScript type checking across all workspaces: passed.
- Unit tests: 11 passed.
- Shared package compilation: passed.
- API compilation: passed.
- Worker compilation: passed.
- Next.js optimized production build: passed.
- Secret-pattern scan: passed.
- Production dependency audit: zero high and zero critical findings; five moderate transitive findings remain tracked.
- CycloneDX SBOM: generated.

## Enterprise security gate

The project is not yet approved for uncontrolled private enterprise repositories. The gate remains closed until Sprint 3+ adds organization identity and authorization, evidence persistence, complete audit events, hardened sandbox execution, egress policy, encryption and security integration tests.
