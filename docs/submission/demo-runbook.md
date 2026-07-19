# Competition Demo Runbook

Authoritative closeout issue: #29.

This runbook freezes the July 19, 2026 competition demo around one deterministic incident. It is not a new product sprint.

## Frozen primary demo incident

- Scenario: deterministic sandbox fixture contract failure.
- Incident short code: `ER-20260719-DEMO`
- Incident ID: `00000000-0000-4000-8000-000000290004`
- Repository: `CodeER/sandbox-broken-repo`
- Repository ID: `00000000-0000-4000-8000-000000290001`
- Fixture source: `test/fixtures/sandbox-broken-repo`
- Reset-restored local repository: `/tmp/codeer-demo-repositories/primary`
- External reference: `competition-closeout-primary-demo-2026-07-19`

The scenario is seeded as a completed vertical slice:

```text
Repository admitted
→ incident detected
→ evidence collected
→ reproduction recorded
→ investigation completed
→ treatment plan approved
→ controlled repair created
→ independent verification passed
→ publication package produced
→ incident closure displayed
```

Do not depend on live failures for the recorded demo or judging. The seeded records include the sandbox logs, redacted evidence, GPT-5.6 invocation metadata, treatment-plan approval, accepted patch, verification report, pull-request package, publication record and closure record.

## One-command bootstrap

The full local bootstrap (infrastructure, migrations, runtime roles, demo reset and verification) runs as:

```bash
npm run demo:bootstrap
```

It ends by starting the web, api and worker dev servers. Use `node scripts/demo-bootstrap.mjs --no-start` to prepare everything without starting the application.

## One-command reset

Prerequisites (already covered by `demo:bootstrap`):

```bash
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
```

Reset only the deterministic demo slice:

```bash
npm run demo:reset
```

Verify the seeded slice at any time:

```bash
npm run demo:verify
```

The reset command:

- recreates the fixture repository under `/tmp/codeer-demo-repositories/primary`;
- creates a stable local Git base commit;
- removes prior rows for `competition-closeout-primary-demo-2026-07-19`;
- reseeds the demo repository, incident, evidence, reproduction, investigation, recovery, verification, publication and closure records;
- prints the generated base commit and primary identifiers.

Safety boundary:

- it requires both `CODEER_DEMO_RESET_ENABLED=true` and `CODEER_DEMO_RESET_CONFIRMATION=RESET-COMPETITION-DEMO`;
- it refuses unknown database hosts or database names (allowlists via `CODEER_DEMO_RESET_ALLOWED_HOSTS` / `CODEER_DEMO_RESET_ALLOWED_DATABASES`);
- it only ever targets the frozen competition tenant `00000000-0000-4000-8000-000000000001` and rows tied to the frozen demo external reference / repository provider ID;
- it confines the restored repository to the configured demo root;
- it does not delete unrelated tenant records.

## Start the demo

```bash
npm run demo:start
```

Open:

- Judge login: `http://localhost:3000/judge`
- Command centre: `http://localhost:3000/incidents`
- Primary incident: `http://localhost:3000/incidents/00000000-0000-4000-8000-000000290004`
- Publications: `http://localhost:3000/publications`

## Judge access

Judge access is runtime-configured and credentials must be delivered privately.

Set these values in the host environment or local `.env` used only for judging:

```bash
CODEER_USER_SESSION_SECRET=<32+ character random secret>
CODEER_JUDGE_ACCESS_ENABLED=true
CODEER_JUDGE_USERNAME=<private judge username>
CODEER_JUDGE_PASSWORD=<private judge password>
CODEER_JUDGE_SESSION_HOURS=8
```

The `/judge` page creates a signed `USER` session with role `INCIDENT_COMMANDER`.

The Compose `app` profile forwards these variables into the `web` container, so the same `.env` file drives local and containerized judging.

The endpoint is hardened for a temporary competition account: it fails closed on weak configuration (secret <32 characters, password <12 characters, invalid organization UUID), clamps sessions to 12 hours, returns `Cache-Control: no-store`, rejects oversized bodies, enforces a same-origin check in production, and rate limits failed attempts (5 per IP per 10 minutes, 30 globally per 10 minutes, in-process). Every attempt writes a structured audit record without the password. For a multi-instance deployment, move throttling to Redis or an identity provider.

The judge role can read and operate the demo workflow, including treatment-plan and publication decisions. It does not receive `ORGANIZATION_OWNER`, `ORGANIZATION_ADMIN`, `SERVICE`, private keys, GitHub App private keys, database credentials, Redis credentials or infrastructure credentials.

Removal procedure:

1. Stop the demo process.
2. Remove or rotate `CODEER_JUDGE_PASSWORD`.
3. Rotate `CODEER_USER_SESSION_SECRET` to invalidate existing judge cookies.
4. Restart the demo if continued access is required.

## Public HTTPS demo URL

For temporary judging or recording, start the local stack first, then run:

```bash
npm run demo:tunnel
```

Equivalent direct command:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Place the resulting HTTPS URL in the Devpost draft only while the tunnel is active. For the recorded video, capture the tunnel URL and the working application in the same recording session.

If the tunnel restarts, update the submission draft immediately with the new URL.
