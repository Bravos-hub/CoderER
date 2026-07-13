# GitHub Publication Threat Model

## Protected assets

- GitHub App private key
- short-lived installation tokens
- protected branches
- approved patch and tree digests
- review and CI evidence
- tenant-to-installation mapping
- incident closure evidence

## Primary threats and controls

### Credential leakage

Private keys are loaded only by the trusted publication worker. Installation tokens are held in memory, expire quickly and are never serialized to queues, logs, model prompts, browser payloads or sandbox environments. Secret scanning patterns cover GitHub token formats and PEM keys.

### Forged or replayed webhooks

The raw body is verified with HMAC-SHA256 before JSON processing. `X-GitHub-Delivery` is unique and persisted. Replayed delivery IDs are rejected. Installation IDs are mapped to an organization only after signature verification.

### Cross-tenant publication

All publication records carry `organizationId`; tenant-sensitive tables use forced PostgreSQL RLS. The recovery package organization, repository, incident and recovery IDs must agree with the signed request context and installation mapping.

### Publishing an unapproved patch

The worker must compare the approved patch digest, base SHA, generated tree digest and persisted recovery package immediately before branch publication. A mismatch blocks publication.

### Protected-branch bypass

Publication policies require `allowProtectedBranchWrites=false`, `allowForcePush=false`, and `allowAutomaticMerge=false`. The adapter only creates or updates a recovery-prefixed branch with fast-forward semantics.

### Malicious review feedback

Review text is untrusted input. It is size-bounded, secret-redacted, hashed and sanitized before becoming revision evidence. It cannot become a shell command, Git operation or direct model system instruction.

### Stale base or race conditions

Merge readiness requires the observed base SHA to remain current. Publication writes are lease-fenced and versioned. A moved base branch enters `BASE_BRANCH_STALE` and requires a new governed recovery revision.

### Premature incident closure

Closure records require a passing post-merge verification record and are immutable. Failed, inconclusive or reverted merges cannot close an incident.
