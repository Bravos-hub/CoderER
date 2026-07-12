# Apply Sprint 4 to the CodeER Repository

This package contains the complete source tree for Sprint 4. Apply it to the existing `Bravos-hub/CoderER` checkout on the branch that already exists:

```text
agent/sprint-4-hardened-sandbox
```

## 1. Prepare the repository

```bash
git checkout main
git pull --ff-only origin main
git checkout agent/sprint-4-hardened-sandbox
git merge --ff-only main
```

Stop and resolve the branch state before copying files if the final command cannot fast-forward.

## 2. Copy the package

Extract the archive outside the repository, then synchronize it into the repository root:

```bash
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.next' \
  --exclude='artifacts' \
  --exclude='.env' \
  /absolute/path/to/codeer-sprint4-hardened-sandbox-v0.3.0/ \
  /absolute/path/to/CoderER/
```

Review the scope before staging:

```bash
cd /absolute/path/to/CoderER
git status --short
git diff --stat
git diff --check
```

Never copy or commit `.env`, credentials, `node_modules`, build output, sandbox workspaces or generated evidence.

## 3. Run source-level gates

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run workspace:check
npm run format:check
npm run lint
npm run typecheck
npm run test
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build
npm run security:check
npm run security:sbom
```

## 4. Run database gates

Start PostgreSQL and Redis, then apply every migration and provision the separated runtime identities:

```bash
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run test:integration:incident
npm run test:integration:sandbox:persistence
```

These tests must prove forced RLS, cross-tenant denial, role separation, idempotency, worker leases, immutable logs/artifacts and append-only cleanup proof history and complete reproduction persistence.

## 5. Run the Docker execution-boundary gate

Run this only on a trusted test host with Docker available:

```bash
npm run test:integration:sandbox:docker
```

The test is expected to reproduce the deterministic fixture failure. It must also prove:

- non-root, read-only, capability-dropped execution;
- no host command execution or Docker socket inside the repository container;
- no network during reproduction;
- ordered and redacted logs;
- matching repeat-run failure signatures;
- hashed artifact manifest;
- verified absence of CodeER-managed containers and volumes after cleanup.

## 6. Commit and open the pull request

```bash
git add \
  .github .env.example .gitignore \
  APPLY_SPRINT_4.md DELIVERY_VALIDATION.json README.md SECURITY.md \
  apps docs infra package.json package-lock.json packages scripts test docker-compose.yml

git status
git commit -m "Build hardened sandbox execution plane"
git push -u origin agent/sprint-4-hardened-sandbox
```

Open a draft pull request targeting `main` with:

```markdown
Closes #15
```

Only mark the pull request ready and close Issue #15 after the source, database, Docker security-profile and container-scan gates all pass.
