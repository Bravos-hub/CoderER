# GitHub Publication Operations Runbook

## Required configuration

- GitHub App ID
- private-key file mounted read-only from the secret manager
- webhook secret from the secret manager
- GitHub API base URL
- publication worker concurrency and lease duration
- approved recovery-branch prefix
- repository publication policies

Never place private keys or webhook secrets in `.env` committed to source, container images, CI logs or browser bundles.

## Preflight

1. Verify database migrations and forced RLS.
2. Verify the GitHub App installation maps to the correct CodeER organization.
3. Confirm permissions are limited to metadata read, contents write, pull requests write and checks read.
4. Confirm protected branches reject direct pushes from the app.
5. Confirm webhook ingress receives the raw request body.
6. Run signature, replay and cross-tenant tests.

## Failure handling

- `PUSH_FAILED`: verify installation access, repository selection and fast-forward branch state; retry through the API.
- `PR_CREATION_FAILED`: inspect sanitized provider status and retry; do not create a second branch.
- `CI_FAILED`: preserve check evidence and request a governed Sprint 6 revision when code changes are needed.
- `BASE_BRANCH_STALE`: do not force push or rebase in place; create a new recovery patch version from the new base.
- `SECURITY_BLOCKED`: require explicit remediation and fresh security review.
- `POST_MERGE_FAILED`: keep the incident open and escalate; do not falsify closure.

## Key rotation

Rotate the GitHub App private key and webhook secret through the secret manager. Support overlapping verification secrets during a controlled webhook-secret rotation. Revoke previous keys after all workers have reloaded.

## Rollback

Disable publication workers, revoke the installation token, suspend the CodeER GitHub App installation if compromise is suspected, and leave published pull requests as drafts. Existing immutable evidence remains available for investigation.
