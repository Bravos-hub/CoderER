# Upload CodeER from a Mobile Phone

## Preferred path: GitHub Codespaces

1. Merge the documentation pull request first if it is still open.
2. Open `https://github.com/Bravos-hub/CoderER` in Safari or Chrome.
3. Select **Code** → **Codespaces** → **Create codespace**.
4. Download the CodeER ZIP package from ChatGPT into the phone's Files app.
5. In the Codespaces file explorer, upload the ZIP to `/workspaces`.
6. Open the terminal and locate the uploaded file:

```bash
cd /workspaces
ls -lah
```

7. Extract it into a temporary directory:

```bash
unzip codeer-secure-workspace-v0.1.0.zip -d codeer-upload
```

8. Copy the extracted files into the repository without copying generated dependencies:

```bash
cd /workspaces/CoderER
cp -a /workspaces/codeer-upload/codeer-secure-workspace-v0.1.0/. .
```

9. Install and validate:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run db:generate
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run security:secrets
npm audit --omit=dev --audit-level=high
```

10. Commit on a dedicated branch:

```bash
git checkout -b feat/secure-workspace-and-repository-intake
git add .
git status
git commit -m "Initialize secure CodeER workspace and repository intake"
git push -u origin feat/secure-workspace-and-repository-intake
```

11. Open a pull request and review it in GitHub Mobile.

## Important

- Do not upload `.env`, private keys, tokens or credentials.
- Do not commit `node_modules`, `.next`, `dist`, `artifacts`, worktrees or sandbox data.
- Keep database and Redis forwarded ports private in Codespaces.
- Do not merge until CI, CodeQL and security checks pass.
