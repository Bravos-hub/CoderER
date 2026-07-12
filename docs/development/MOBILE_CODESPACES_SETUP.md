# Mobile GitHub Codespaces Setup

This workflow allows CodeER development and review from a mobile phone while compute, Docker, Node.js, PostgreSQL and Redis run in GitHub Codespaces.

## Create the Codespace

1. Open `Bravos-hub/CoderER` in a mobile browser.
2. Select **Code** → **Codespaces** → **Create codespace on main**.
3. Allow the browser editor to finish building the `CodeER Secure Workspace` dev container.
4. Open the integrated terminal from the menu.

The dev container installs workspace dependencies and generates the Prisma client automatically.

## Configure local secrets

```bash
cp .env.example .env
```

For public demo repositories, GitHub credentials may remain empty. For private repositories, store secrets using Codespaces secrets rather than committing them to `.env`.

Recommended Codespaces secret names:

```text
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_TOKEN
OPENAI_API_KEY
CODEER_API_KEY
```

Use short-lived GitHub App installation access wherever possible. A personal token is only a local fallback.

## Start infrastructure and applications

```bash
npm run infra:up
npm run db:generate
npm run dev
```

Codespaces will offer forwarded links for ports 3000 and 4100. Keep PostgreSQL and Redis ports private.

## Validate before committing

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run security:check
```

## Commit from Codespaces

```bash
git status
git add <intended-files>
git commit -m "Initialize secure CodeER workspace"
git push -u origin <branch-name>
```

Review the pull request in GitHub Mobile. Do not merge when security, tests or build checks are failing.

## Mobile security rules

- Never paste private keys into a public issue, PR comment, chat, screenshot or build log.
- Do not make database or Redis ports public.
- Do not approve a pull request without reading changed permissions, workflows and dependency updates.
- Revoke any token immediately if it appears in a screenshot or message.
- Use GitHub's private security advisory flow for suspected vulnerabilities.
