# Apply Sprint 8

1. Check out `agent/sprint-8-command-center` and fast-forward it from `main`.
2. Extract this package outside the repository.
3. Use `rsync -avnc` for a dry comparison, excluding `.git`, `node_modules`, `dist`, `.next`, artifacts and `.env`.
4. Synchronize only after reviewing the dry run.
5. Run `npm ci --ignore-scripts --no-audit --no-fund`.
6. Run formatting, lint, typecheck, tests, production build, secret scan and audit.
7. Start PostgreSQL, Redis, API, worker and web; test every command-center route against real tenant data.
8. Keep Issue #24 open until API parity, browser E2E, accessibility and the full incident-to-closure demonstration pass.
