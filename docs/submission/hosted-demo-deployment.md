# Hosted demo deployment checklist

Goal: one stable HTTPS demo URL for the whole judging period, with the judge
account limited to workflow records and no public reset surface.

## Topology

```text
judges / recording
   │  HTTPS (fixed hostname, e.g. demo.example.com)
   ▼
Cloudflare named tunnel (cloudflared on the host)
   ▼
web (Next.js BFF) 127.0.0.1:3000  ← only port the tunnel reaches
   ├── api  (compose network only)
   ├── worker (compose network only)
   ├── postgres (compose volume, never published)
   └── redis (compose volume, never published)
```

## Host preparation

1. Single Ubuntu 24.04 host; Docker Engine + Compose plugin installed.
2. Create a dedicated unprivileged user; restrict SSH to key auth for that user.
3. Firewall (ufw): allow 22/tcp (operator IPs only), allow 80/443 outbound;
   deny all other inbound. Postgres (5432) and Redis (6379) are bound to
   127.0.0.1 by the Compose file and must never be published.
4. Clone the repository at the release tag and checkout the tag.

## Runtime secrets (never committed)

Create `/srv/codeer/.env` (mode 600) with:

```bash
POSTGRES_PASSWORD=<generated>
REQUEST_CONTEXT_SIGNING_SECRET=<generated 48+ chars>
CODEER_USER_SESSION_SECRET=<generated 48+ chars>
CODEER_API_KEY=<generated>
CODEER_JUDGE_ACCESS_ENABLED=true
CODEER_JUDGE_USERNAME=<delivered privately>
CODEER_JUDGE_PASSWORD=<delivered privately, 16+ chars>
CODEER_JUDGE_SESSION_HOURS=8
GITHUB_APP_ID=<app id>
GITHUB_APP_PRIVATE_KEY_FILE=/srv/codeer/github-app.pem
GITHUB_WEBHOOK_SECRET=<generated 32+ chars>
```

Mount the GitHub App private key read-only (`/srv/codeer/github-app.pem`, mode
400). The Compose `app` profile already mounts it from
`GITHUB_APP_PRIVATE_KEY_FILE`.

## Bring-up

```bash
docker compose --profile app up -d --build
docker compose ps    # all services healthy
```

Migrations run through the `migrate` service automatically. Afterwards, as the
operator (SSH), seed and verify the demo once:

```bash
docker compose --profile app exec web true   # stack sanity
DATABASE_ADMIN_URL=postgresql://codeer:$POSTGRES_PASSWORD@127.0.0.1:5432/codeer \
CODEER_DEMO_RESET_ENABLED=true \
CODEER_DEMO_RESET_CONFIRMATION=RESET-COMPETITION-DEMO \
npm run demo:reset && npm run demo:verify
```

## Named tunnel

Use a **named** tunnel (stable hostname), not a quick tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create codeer-demo
cloudflared tunnel route dns codeer-demo demo.example.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: codeer-demo
credentials-file: /etc/cloudflared/<tunnel-id>.json
ingress:
  - hostname: demo.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

`systemctl enable --now cloudflared`. Record the tunnel id and hostname in the
private operator notes only.

## GitHub App webhook (for the live publication proof)

Point the App's webhook URL at `https://demo.example.com/api/v1/webhooks/github`
with `GITHUB_WEBHOOK_SECRET` above. Signed deliveries are durably recorded and
replays are rejected across restarts (PR #38).

## Operations through judging

- Health: `docker compose ps` daily; `curl -fsS https://demo.example.com/api/v1/health/ready`.
- Restart policy is `unless-stopped`; verify with `docker compose restart web`.
- Backups: nightly `pg_dump` of the `codeer` database to operator storage until judging ends.
- Disk: alert at 80% on the Docker volume partition.
- Reset policy: `demo:reset` runs only over operator SSH with the two safety
  tokens. It is never exposed as an HTTP endpoint, and the judge account cannot
  reach it.
- After judging: rotate `CODEER_JUDGE_PASSWORD` and `CODEER_USER_SESSION_SECRET`
  (invalidates judge cookies), then stop the tunnel.

## Acceptance checks

- Fixed HTTPS URL loads `/judge` from a clean external browser.
- Judge login succeeds; the judge cannot open organization settings.
- Frozen incident shows the DETERMINISTIC SEEDED REPLAY banner on every tab.
- No page references `localhost` or `127.0.0.1` links.
- Credentials remain valid for the full judging window.
