# Recoveries API

Base path: `/api/v1`.

All routes require authenticated, signed tenant and actor context in production. Write routes require authorization, bounded JSON and either idempotency or optimistic concurrency.

## Start and inspect

- `POST /treatment-plans/:planId/recoveries` — starts an idempotent recovery from a fully approved treatment plan and immutable base commit.
- `GET /incidents/:incidentId/recoveries` — cursor-paginated recovery history.
- `GET /recoveries/:recoveryId` — current lifecycle, policy, base commit, patch version and error summary.
- `GET /recoveries/:recoveryId/events` — ordered, hash-addressed recovery events.
- `GET /recoveries/:recoveryId/patches` — immutable patch-version summaries.
- `GET /recoveries/:recoveryId/patches/:patchVersion` — diff, files, hunks, provenance and policy decision.
- `GET /recoveries/:recoveryId/security-review` — independent security decision.
- `GET /recoveries/:recoveryId/verification` — verification matrix and unexpected-change report.
- `GET /recoveries/:recoveryId/pull-request-package` — latest immutable review package.

Creation accepts only declared constraints, an immutable 40-character base SHA and a non-protected recovery branch. It does not accept arbitrary prompts, shell commands, provider credentials or GitHub tokens.

## Lifecycle controls

- `POST /recoveries/:recoveryId/cancel`
- `POST /recoveries/:recoveryId/resume`
- `POST /recoveries/:recoveryId/request-revision`

Revision requests require `expectedRecoveryVersion`, a bounded comment and optional additional constraints. A revision creates a new patch version; it never mutates an existing patch or approval record.

## Human publication decisions

- `POST /recoveries/:recoveryId/approve-publication`
- `POST /recoveries/:recoveryId/reject-publication`

Bodies include `comment` and `expectedVersion`. These routes reject service, system and agent actors. Approvals count distinct authenticated humans for the current immutable patch version. Separation-of-duties policy can prevent a treatment-plan approver from approving publication.

`READY_TO_PUBLISH` means the exact package is approved for a future draft-PR publication adapter. It is not proof that a branch was pushed or a pull request was created.

## Error behavior

Stable 4xx responses cover malformed IDs, stale versions, denied roles, invalid lifecycle transitions, unapproved plans, protected branches and policy-blocked scope. Internal paths, provider payloads, credentials, SQL, stack traces and hidden model reasoning are never returned.
