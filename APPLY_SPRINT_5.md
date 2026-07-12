# Apply Sprint 5

Target branch: `agent/sprint-5-codex-orchestration`.

## Synchronize

```bash
git checkout main
git pull --ff-only origin main
git checkout agent/sprint-5-codex-orchestration
git merge --ff-only main
```

Extract the Sprint 5 archive outside the repository and synchronize its contents:

```bash
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.next' \
  --exclude='artifacts' \
  --exclude='.env' \
  /path/to/codeer-sprint5-codex-orchestration-v0.4.0/ \
  /path/to/CoderER/
```

## Source gates

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run db:generate
npm run db:validate
npm run workspace:check
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:evaluation:investigation
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build
npm run security:check
npm run security:sbom
```

## Database and tenant-isolation gates

```bash
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run test:integration:incident
npm run test:integration:sandbox:persistence
npm run test:integration:investigation
```

The investigation smoke suite verifies idempotency, RLS, cross-tenant denial, leases, checkpoints, immutable diagnosis records and two distinct human approvals.

## Live provider gate

Use a secret-managed OpenAI API key and sanitized private fixtures. Confirm approved model policy, strict structured output, provider timeout/cancellation, usage and cost accounting, citation quality, prompt-injection resistance and zero credential disclosure. Do not place the API key in source or shell history.

## Publish

```bash
git add .
git commit -m "Build enterprise Codex investigation plane"
git push -u origin agent/sprint-5-codex-orchestration
```

Open a draft pull request to `main`. Add `Closes #18` only after database, live-provider, security and evaluation gates pass.
