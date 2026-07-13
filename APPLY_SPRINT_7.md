# Apply CodeER Sprint 7

1. Start from the merged Sprint 6 `main` branch.
2. Checkout `agent/sprint-7-github-publication`.
3. Run an rsync checksum dry run before copying this package.
4. Install dependencies and run the complete validation gates.
5. Apply the Sprint 7 database migration only after backup and migration review.
6. Configure a least-privilege GitHub App and secret-managed private key/webhook secret.
7. Keep Issue #22 open until live GitHub App, webhook, RLS and post-merge verification tests pass.

```bash
npm ci --ignore-scripts --no-audit --no-fund
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
