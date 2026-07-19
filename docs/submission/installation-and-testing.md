# Installation And Testing

This guide is for judges and technical reviewers who want to run CodeER locally.

## Requirements

- Node.js 24 LTS
- npm 10 or newer
- Git
- Docker
- Docker Compose

## Setup

```bash
cp .env.example .env
npm ci --ignore-scripts --no-audit --no-fund
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
```

Start the development stack:

```bash
npm run dev
```

Open:

- Web command centre: `http://localhost:3000/incidents`
- Repository admission: `http://localhost:3000/connect`
- API liveness: `http://localhost:4100/api/v1/health`
- API readiness: `http://localhost:4100/api/v1/health/ready`

## Deterministic Competition Demo

Reset the frozen demo scenario:

```bash
npm run demo:reset
```

Start the demo stack:

```bash
npm run demo:start
```

Open:

- Judge login: `http://localhost:3000/judge`
- Primary incident: `http://localhost:3000/incidents/00000000-0000-4000-8000-000000290004`
- Publications: `http://localhost:3000/publications`

For a temporary public HTTPS URL while the local stack is running:

```bash
npm run demo:tunnel
```

Do not commit judge credentials or tunnel URLs. Use `docs/submission/demo-runbook.md` for the complete competition demo procedure.

## Core Gates

```bash
npm run db:generate
npm run db:validate
npm run db:validate:publication-static
npm run workspace:check
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:evaluation:publication
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build
npm run security:check
npm run security:sbom
```

## Database And Integration Gates

```bash
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run test:integration:incident
npm run test:integration:investigation
npm run test:integration:sandbox:persistence
npm run test:integration:recovery
```

## Docker Sandbox Gate

Run this only on a trusted operator host with Docker access:

```bash
npm run test:integration:sandbox:docker
```

## Local GitHub Webhook Proxy

CodeER uses API port `4100`. The webhook route is:

```text
/api/v1/webhooks/github
```

Forward Smee deliveries with:

```bash
npm run proxy:github-webhook
```

Keep the terminal running while redelivering GitHub App webhooks.
