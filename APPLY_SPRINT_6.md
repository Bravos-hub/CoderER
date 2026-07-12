# Apply Sprint 6

Target branch: `agent/sprint-6-controlled-recovery`.

## 1. Synchronize source

Extract the delivery outside the repository and use checksum-aware dry-run before copying:

```bash
rsync -avnc --delete \
  --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.next' \
  --exclude='artifacts' --exclude='.env' \
  /path/to/codeer-sprint6-controlled-recovery-v0.5.0/ /path/to/CoderER/
```

Then remove `-n` after reviewing the file list.

## 2. Install and validate

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
npm run test:evaluation:recovery
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build
npm run security:check
npm run security:sbom
```

## 3. Run infrastructure gates

```bash
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run test:integration:incident
npm run test:integration:investigation
npm run test:integration:sandbox:persistence
npm run test:integration:sandbox:docker
npm run test:integration:recovery
```

## 4. Review before publication

Verify no direct push, protected-branch mutation, auto-merge, unrestricted shell/network or service-account publication approval is possible. Keep Issue #20 open until every acceptance criterion and external infrastructure gate passes.

## 5. Commit and push

```bash
git add .
git commit -m "Build enterprise controlled recovery plane"
git push -u origin agent/sprint-6-controlled-recovery
```

Open a draft PR. Add `Closes #20` only after all source, database, Git, sandbox, security, evaluation and operational gates pass.
