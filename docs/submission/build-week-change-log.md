# Build Week Change Log

This log tracks meaningful competition-period additions. Keep it current as work continues toward the July 21, 2026 at 9:00 PM EAT internal submission deadline.

## Sprint 7 GitHub Publication Plane

Feature: Governed GitHub publication and recovery closure

Date: July 13-16, 2026

Commits:

- `2aa54ef` - Add Sprint 7 GitHub publication plane
- `dba2068` - feat: add smee-proxy script for forwarding GitHub webhooks to local API

Codex session:

- TODO: record the primary `/feedback` Codex Session ID in the private Devpost checklist.

GPT-5.6 usage:

- The repository config uses `AI_ALLOWED_MODELS=gpt-5.6` and `AI_DEFAULT_MODEL=gpt-5.6` for the investigation and planning workflow.
- Product traces must preserve the configured model identifier when model invocations are generated during the final demo.

Human decisions:

- Keep publication human-approved and draft-PR-only.
- Do not auto-merge.
- Keep Issue #22 open until real GitHub App, webhook, draft PR, merge-observation, and post-merge verification gates pass.
- Use Smee for local GitHub webhook forwarding instead of paid hosting during Sprint 7 validation.

Files changed:

- `packages/publication/**`
- `packages/database/src/publication-store.ts`
- `packages/database/prisma/migrations/20260713000100_sprint7_publication/migration.sql`
- `apps/api/src/publications/**`
- `docs/api/publications.md`
- `docs/architecture/github-publication-plane.md`
- `docs/operations/github-publication-runbook.md`
- `docs/operations/github-webhook-guide.md`
- `docs/security/github-publication-threat-model.md`
- `scripts/validate-publication-migration.mjs`
- `scripts/smee-proxy.mjs`

Verification evidence:

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm run db:generate`
- `npm run db:validate`
- `npm run db:validate:publication-static`
- `npm run workspace:check`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:evaluation:publication`
- `NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build`
- `npm run security:check`
- `npm run security:sbom`
- `npm run infra:up`
- `npm run db:migrate:all`
- `npm run db:provision:runtime`
- `npm run db:verify:roles`
- `npm run test:integration:incident`
- `npm run test:integration:investigation`
- `npm run test:integration:sandbox:persistence`
- `npm run test:integration:recovery`

Known remaining evidence gaps:

- Real GitHub App installation-token exchange must be exercised.
- Signed webhook delivery and replay rejection must be demonstrated through Smee or another HTTPS tunnel.
- App-driven draft PR creation must be demonstrated by CodeER itself, not only by GitHub CLI.
- Post-merge verification must be demonstrated before closing Issue #22.

## Submission Evidence Package

Feature: Build Week documentation and judging package

Date: July 17, 2026

Commits:

- TODO: add commit hash after this documentation is committed.

Codex session:

- TODO: record the primary `/feedback` Codex Session ID in the private Devpost checklist.

GPT-5.6 usage:

- Documents the requirement that GPT-5.6 is a product dependency, not only a development assistant.

Human decisions:

- Track: Developer Tools.
- Submission title: CodeER - AI Emergency Response for Broken Software.
- Submission tagline: From failing build to verified recovery.
- Internal final submission deadline: July 21, 2026 at 9:00 PM EAT.

Files changed:

- `docs/submission/**`
- `README.md`

Verification evidence:

- `npx.cmd prettier --write README.md docs/submission/*.md`
- TODO: rerun repository gates after final submission documentation edits are committed.
