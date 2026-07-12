# CodeER

> **Emergency response for broken software.**  
> From failing build to verified recovery.

CodeER is an evidence-driven AI software emergency-response platform. It uses Codex to reproduce repository failures, diagnose root causes, prepare controlled repairs, independently verify recovery and produce reviewable pull-request packages.

## Operating principles

1. **Evidence before action** — reproduce or identify the failure before changing code.
2. **Isolation before modification** — perform repairs in a branch, worktree and sandbox.
3. **Verification before approval** — rerun the original failure, builds, tests and user journeys.
4. **Human control before merge** — keep every patch reviewable and never auto-merge.
5. **Security before convenience** — treat repositories, model output, commands and queue data as untrusted.

```text
ADMIT → TRIAGE → DIAGNOSE → RECOVER → VERIFY → REVIEW
```

## Recovery workflow

A completed recovery session must provide:

1. original failure and reproduction evidence;
2. root-cause diagnosis;
3. approved treatment plan;
4. isolated patch and complete diff;
5. independent verification report;
6. known limitations and rollback guidance;
7. reviewable pull-request package.

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

## Current implementation

The workspace contains the Sprint 1 foundation and the Sprint 2 repository-intake pipeline:

- Next.js command centre and repository-admission interface;
- server-side backend-for-frontend so internal API credentials never reach browser JavaScript;
- NestJS API with fail-closed production authentication, rate limiting, strict CORS, bounded bodies, security headers, request IDs and safe errors;
- BullMQ workers backed by Redis;
- GitHub App installation authentication with a local token fallback;
- canonical GitHub URL and Git-reference validation;
- bounded GitHub metadata and branch collection;
- controlled shallow clone or refresh operations without credentials in URLs or command arguments;
- Git execution with shell disabled, prompts disabled, non-HTTPS protocols denied, global/system config ignored and hooks disabled;
- repository file-count and byte limits;
- isolated recovery worktrees and CodeER recovery branches;
- PostgreSQL and Prisma domain models;
- non-root, capability-dropped, read-only application containers;
- shared Zod contracts, redacted structured logging, tests, CI, CodeQL, Dependabot, dependency review, secret-pattern scanning and SBOM generation;
- GitHub Codespaces configuration for mobile and browser-based development.

## Workspace

```text
apps/
  web/          Next.js command centre and BFF
  api/          NestJS orchestration API
  worker/       Repository-intake and recovery workers
packages/
  config/       Fail-closed environment validation
  contracts/    Shared runtime contracts
  database/     Prisma schema and persistence boundary
  github/       GitHub authentication and bounded metadata access
  logger/       Structured redacted logging
  repository/   Controlled Git clone and worktree operations
infra/docker/   Hardened application container definitions
docs/security/  Threat model, security architecture and secure SDLC
```

## Local development

Requirements: Node.js 24 LTS, npm 10 or newer, Git and Docker.

```bash
cp .env.example .env
npm ci --ignore-scripts --no-audit --no-fund
npm run infra:up
npm run db:generate
npm run dev
```

Open:

- Command centre: `http://localhost:3000`
- Repository admission: `http://localhost:3000/connect`
- API health: `http://localhost:4100/api/v1/health`

Run quality and security gates:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run security:check
npm run security:sbom
```

## Production authentication

Production API startup fails unless authentication is enabled.

```env
NODE_ENV=production
API_AUTH_MODE=api-key
CODEER_API_KEY=<at-least-32-random-characters>
CORS_ALLOWED_ORIGINS=https://codeer.example.com
CODEER_API_URL_INTERNAL=http://api:4100/api/v1
CODEER_INTERNAL_API_KEY=<same-internal-key>
```

The API key is transitional. Enterprise deployments will replace it with OIDC sessions, organization-scoped RBAC and service identities. The browser communicates with same-origin Next.js route handlers; only the BFF receives the internal API credential.

## Repository admission API

The browser submits to the same-origin BFF:

```http
POST /api/repositories/intakes
Content-Type: application/json

{
  "repositoryUrl": "https://github.com/Bravos-hub/CoderER",
  "baseBranch": "main"
}
```

The BFF forwards to `POST /api/v1/repositories/intakes` using the server-side credential. Public repositories require no GitHub credential. Private repositories use GitHub App installation authentication through `GITHUB_APP_ID`, a private key and the request's installation ID.

## Mobile development with Codespaces

The `.devcontainer` folder creates a browser-based VS Code environment with Node.js 24, Docker and GitHub CLI. From the repository page, create a Codespace, open its terminal and run:

```bash
cp .env.example .env
npm run infra:up
npm run dev
```

See [Mobile Codespaces Setup](docs/development/MOBILE_CODESPACES_SETUP.md).

## Security documentation

- [Security Policy](SECURITY.md)
- [Security Architecture](docs/security/SECURITY_ARCHITECTURE.md)
- [Threat Model](docs/security/THREAT_MODEL.md)
- [Secure Development Lifecycle](docs/security/SECURE_DEVELOPMENT_LIFECYCLE.md)

## Product documentation

- [Brand Foundation](docs/brand/CODEER_BRAND_FOUNDATION.md)
- [Product Specification](docs/product/CODEER_PRODUCT_SPECIFICATION.md)
- [System Architecture](docs/architecture/CODEER_SYSTEM_ARCHITECTURE.md)
- [Workspace and Repository Intake](docs/development/WORKSPACE.md)
- [Build Week Plan](docs/roadmap/build-week-plan.md)

## Security status

The current production dependency audit has no high or critical findings. Moderate transitive findings are tracked and must be reviewed as upstream releases become available. This scaffold is suitable for controlled demo repositories; private enterprise repository onboarding remains blocked until identity, tenant authorization, hardened execution sandboxes, encrypted evidence storage and immutable auditing are complete.

## Next sprint

Sprint 3 implements incident creation from repository evidence, failure reproduction, severity classification and the first immutable evidence timeline.
