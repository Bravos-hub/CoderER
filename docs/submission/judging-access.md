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

- Hosted demo URL: TODO
- Demo account: TODO
- Demo password delivery method: TODO: do not commit secrets.
- Seeded broken repository: TODO
- Reset incident button or reset instructions: TODO
- Read-only replay fallback: TODO

## Local Evaluation

Judges or reviewers with Docker can run the local stack with:

```bash
cp .env.example .env
npm ci --ignore-scripts --no-audit --no-fund
npm run infra:up
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run dev
```

Open:

- Command centre: `http://localhost:3000/incidents`
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
