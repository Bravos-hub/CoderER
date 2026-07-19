# Judging Access

This file records how judges should access and evaluate CodeER. Complete the TODOs before the July 21, 2026 at 9:00 PM EAT internal submission deadline.

## Repository

- Repository: `https://github.com/Bravos-hub/CoderER`
- Current Sprint 7 draft PR: `https://github.com/Bravos-hub/CoderER/pull/23`
- Repository visibility for final submission: TODO: public or shared privately with required judge accounts.

If private, share with:

```text
testing@devpost.com
build-week-event@openai.com
```

Verify access from an account that is not already a repository member.

## Demo Access

- Hosted demo URL: set in the Devpost draft only while the Cloudflare tunnel is active.
- Demo account: runtime-configured judge user via `/judge`.
- Demo password delivery method: private Devpost/judge channel only; do not commit credentials.
- Seeded broken repository: `CodeER/sandbox-broken-repo` from `test/fixtures/sandbox-broken-repo`.
- Frozen incident: `ER-20260719-DEMO` / `00000000-0000-4000-8000-000000290004`.
- Reset command: `npm run demo:reset`.
- Startup command: `npm run demo:start`.
- HTTPS tunnel command: `npm run demo:tunnel`.
- Read-only replay fallback: open `/incidents/00000000-0000-4000-8000-000000290004` after reset.

Judge runtime variables:

```bash
CODEER_USER_SESSION_SECRET=<32+ character random secret>
CODEER_JUDGE_ACCESS_ENABLED=true
CODEER_JUDGE_USERNAME=<delivered privately>
CODEER_JUDGE_PASSWORD=<delivered privately>
CODEER_JUDGE_SESSION_HOURS=8
```

The judge session is a signed human `USER` session with `INCIDENT_COMMANDER` role only. It does not grant organization-owner privileges or infrastructure credentials.

Deployment wiring and hardening (Sprint 9 release branch):

- `docker-compose.yml` forwards all four `CODEER_JUDGE_*` variables (plus `CODEER_USER_SESSION_SECRET`) into the `web` container; judge login previously failed in the Compose `app` profile because they were missing.
- Judge access fails closed: disabled by default, and rejected at login unless the session secret is ≥32 characters, the password is ≥12 characters, and the organization id is a valid UUID. Session lifetime is clamped to a 12-hour maximum.
- The login endpoint returns `Cache-Control: no-store`, rejects bodies over 2 KiB, enforces a same-origin check in production, and applies an in-process limiter (5 failed attempts per IP per 10 minutes, 30 failed attempts globally per 10 minutes; a successful login clears the per-IP count). The limiter is process-local — a multi-instance deployment must move throttling to Redis, an identity provider or the edge proxy.
- Every attempt emits one structured audit record (timestamp, outcome, request id, hashed IP, actor id on success). Passwords are never logged.
- Verify after deployment: the judge can operate the demo workflow but cannot open organization settings or administration views.

Full runbook: `docs/submission/demo-runbook.md`.

## Local Evaluation

Judges or reviewers with Docker can run the local stack with:

```bash
cp .env.example .env
npm ci --ignore-scripts --no-audit --no-fund
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run demo:reset
npm run demo:start
```

Open:

- Judge login: `http://localhost:3000/judge`
- Command centre: `http://localhost:3000/incidents`
- Primary incident: `http://localhost:3000/incidents/00000000-0000-4000-8000-000000290004`
- API readiness: `http://localhost:4100/api/v1/health/ready`

## Webhook Testing

For local Sprint 7 webhook verification, use Smee:

```bash
npm run proxy:github-webhook
```

The target CodeER endpoint is:

```text
http://127.0.0.1:4100/api/v1/webhooks/github
```

Set the GitHub App Webhook URL to the Smee channel URL while the proxy is running.

## Video

- YouTube URL: TODO
- Duration target: 2 minutes 50 seconds
- Must include audio, Codex usage, GPT-5.6 product usage, and the recovery workflow.
