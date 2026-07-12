# Apply a CodeER Sprint Package from GitHub Codespaces

The preferred workflow is a normal computer checkout. This Codespaces path remains available when working from a phone or browser.

1. Open `Bravos-hub/CoderER` in a GitHub Codespace.
2. Upload the Sprint ZIP to `/workspaces` rather than uploading an extracted folder.
3. In the terminal, extract it outside the repository:

```bash
cd /workspaces
unzip codeer-sprint4-hardened-sandbox-v0.3.0.zip -d codeer-sprint4-upload
```

4. Prepare the existing Sprint 4 branch:

```bash
cd /workspaces/CoderER
git checkout main
git pull --ff-only origin main
git checkout agent/sprint-4-hardened-sandbox
git merge --ff-only main
```

5. Synchronize the package into the repository:

```bash
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.next' \
  --exclude='artifacts' \
  --exclude='.env' \
  /workspaces/codeer-sprint4-upload/codeer-sprint4-hardened-sandbox-v0.3.0/ \
  /workspaces/CoderER/
```

6. Follow `APPLY_SPRINT_4.md` for validation, commit and pull-request steps.

## Security reminders

- Keep forwarded PostgreSQL, Redis, API and sandbox-engine ports private.
- Do not upload `.env`, tokens, private keys, TLS client certificates or customer repositories.
- Do not mount a Codespaces Docker socket into an untrusted sandbox as a production architecture.
- Do not close Issue #15 until the Docker and PostgreSQL gates pass.
