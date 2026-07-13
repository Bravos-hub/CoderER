# GitHub Webhook Ingestion Guide

The webhook endpoint must receive the exact raw bytes used by GitHub when calculating `X-Hub-Signature-256`.

Processing order:

1. Read `X-GitHub-Delivery`, `X-GitHub-Event` and `X-Hub-Signature-256`.
2. Reject missing or malformed headers.
3. Verify HMAC-SHA256 over the raw body using constant-time comparison.
4. Compute and persist the payload digest and delivery ID.
5. Reject duplicate delivery IDs.
6. Parse JSON only after signature verification.
7. Resolve the installation ID to an organization.
8. Authorize the repository against that installation and organization.
9. Normalize the event into publication checks, reviews, comments or merge observations.
10. Persist an immutable processing outcome.

Supported event families should initially be limited to `check_run`, `check_suite`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `workflow_run`, `code_scanning_alert`, `secret_scanning_alert`, and `installation` events. Unknown events are acknowledged and recorded as ignored.
