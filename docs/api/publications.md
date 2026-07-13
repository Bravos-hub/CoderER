# Publication API

All routes require a signed CodeER identity context in production. Mutating routes require idempotency or optimistic-version input as documented.

## Create a publication

`POST /api/v1/recoveries/:recoveryId/publications`

Headers:

- `Idempotency-Key`: 8-128 safe characters
- signed tenant and actor context headers

Body:

```json
{
  "installationId": "12345678",
  "approvedPackage": {
    "recoveryId": "uuid",
    "incidentId": "uuid",
    "organizationId": "uuid",
    "repositoryId": "uuid",
    "treatmentPlanId": "uuid",
    "patchVersion": 1,
    "baseCommitSha": "40-hex",
    "patchDigest": "64-hex",
    "treeDigest": "64-hex",
    "branchName": "codeer/recovery/incident-recovery-v1",
    "targetBaseBranch": "main",
    "publicationApprovalCount": 2,
    "publicationApprovedAt": "ISO-8601",
    "securityReviewApproved": true,
    "verificationPassed": true,
    "pullRequestTitle": "Fix build failure",
    "pullRequestBody": "..."
  },
  "policy": {
    "version": "v1",
    "allowedBaseBranches": ["main"],
    "recoveryBranchPrefix": "codeer/recovery",
    "requiredChecks": ["build", "test"],
    "requiredApprovals": 2,
    "requireCodeOwnerApproval": true,
    "maximumPublicationAttempts": 3,
    "webhookReplayWindowSeconds": 600,
    "postMergeVerificationRequired": true,
    "retentionDays": 365
  }
}
```

The API verifies the recovery is `READY_TO_PUBLISH`, the current patch version and base SHA match, the GitHub installation belongs to the organization, and policy permits publication. It writes the publication and transactional outbox message atomically.

## Read routes

- `GET /api/v1/recoveries/:recoveryId/publications`
- `GET /api/v1/publications/:publicationId`
- `GET /api/v1/publications/:publicationId/events`
- `GET /api/v1/publications/:publicationId/checks`
- `GET /api/v1/publications/:publicationId/reviews`

## Control routes

- `POST /api/v1/publications/:publicationId/cancel`
- `POST /api/v1/publications/:publicationId/retry`
- `POST /api/v1/publications/:publicationId/mark-ready`

Control bodies include `expectedVersion` and require a trusted human identity where the action is a governance decision.
