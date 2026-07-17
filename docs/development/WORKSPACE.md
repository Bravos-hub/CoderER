# CodeER Workspace

## Purpose

This monorepo is the implementation baseline for the Build Week MVP. It separates the command centre, orchestration API, background execution, shared contracts, GitHub integration, controlled Git operations, configuration, logging and persistence.

## Applications

- `apps/web`: Next.js command centre, landing experience and repository admission UI.
- `apps/api`: NestJS HTTP API, incident boundary and asynchronous repository-intake queue.
- `apps/worker`: BullMQ workers for repository intake and long-running recovery stages.

## Shared packages

- `packages/contracts`: runtime-validated domain and queue contracts.
- `packages/config`: environment parsing and validation.
- `packages/logger`: structured logging with credential redaction.
- `packages/database`: Prisma schema and persistence boundary.
- `packages/github`: GitHub URL parsing, GitHub App or token authentication and repository metadata.
- `packages/repository`: controlled clone, refresh and isolated worktree operations using argument-only Git processes.

## Local setup

1. Install Node.js 24 LTS and npm 10 or newer.
2. Copy `.env.example` to `.env`.
3. Run `npm install`.
4. Start PostgreSQL and Redis with `npm run infra:up`.
5. Generate Prisma Client with `npm run db:generate`.
6. Run all applications with `npm run dev`.

`npm run dev` loads `.env` automatically via `dotenv-cli`, and the configuration parser treats blank optional values as unset, so `.env.example` works out of the box for local development.

Default URLs:

- Web: `http://localhost:3000`
- Repository admission: `http://localhost:3000/connect`
- API health: `http://localhost:4100/api/v1/health`
- Repository intake API: `http://localhost:4100/api/v1/repositories/intakes`
- Incident API: `http://localhost:4100/api/v1/incidents`

## GitHub authentication

Public repositories can be admitted without credentials. Private repositories require one of these modes:

1. GitHub App mode: set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and send the installation ID in the intake request.
2. Development-token mode: set `GITHUB_TOKEN`. This is a local-development fallback, not the intended production authentication model.

Tokens are supplied to Git through environment-scoped configuration and are not placed in clone URLs or command arguments.

## GitHub webhook forwarding

GitHub App webhooks cannot reach a local development machine directly. Use the bundled `smee-client` to forward public webhook deliveries to the local API.

1. Create a new channel at <https://smee.io/> (or reuse an existing one).
2. Set `WEBHOOK_PROXY_URL` in `.env` to the smee channel URL.
3. Configure the GitHub App's webhook URL to the same smee channel URL and set `GITHUB_WEBHOOK_SECRET`.
4. Forward events to the local API in a separate terminal:

```bash
npm run proxy:github-webhook
```

Or, if you prefer the smee CLI directly:

```bash
npx smee -u "$WEBHOOK_PROXY_URL" -t http://localhost:4100/api/v1/webhooks/github
```

The controller at `POST /api/v1/webhooks/github` validates `X-Hub-Signature-256`, rejects replays and returns an accepted/duplicate response. Keep the proxy process running while testing webhooks; `npm run dev` does not start it automatically.

## Repository intake flow

```text
POST /repositories/intakes
        ↓
Validate GitHub URL and branch request
        ↓
Queue repository.intake job
        ↓
Resolve GitHub App installation token
        ↓
Read repository and branch metadata
        ↓
Clone or refresh controlled workspace
        ↓
Reset clone to selected origin branch
        ↓
Create detached worktree and CodeER recovery branch
        ↓
Return typed intake evidence
```

## Quality gates

Run `npm run check` before opening or updating a pull request. CI separately validates workspace structure, formatting, linting, type safety, tests and production builds.

## Sprint 2 completion criteria

- GitHub repository URLs are validated and normalized.
- Public repositories work without credentials.
- Private repositories support GitHub App installation authentication.
- Git credentials never appear in clone URLs or logged command arguments.
- Repository metadata includes visibility, default branch, selected branch, branch list and base SHA.
- Existing clones are safely refreshed rather than duplicated.
- Every intake creates a unique isolated worktree and recovery branch.
- API callers can query queued, active, completed and failed intake states.

## Remaining milestones

Persistence wiring, sandbox command execution, log streaming, Codex orchestration, evidence storage and pull-request generation follow in later sprints.
