# Reproductions API

Base path: `/api/v1`

All routes require authenticated, signed organization and actor context in production. IDs are UUIDs and are resolved inside the active organization. Error responses are safe, structured and do not expose host paths, daemon details or credentials.

## Start a reproduction

`POST /incidents/{incidentId}/reproductions`

Required permission: `REQUEST_REPRODUCTION`.

Required production header:

```http
Idempotency-Key: <unique-client-generated-key>
```

Example request:

```json
{
  "worktreeId": "7df1f621-27df-48c8-9d98-700f7f36f986",
  "image": "registry.example/codeer/node@sha256:...",
  "installCommands": [
    {
      "phase": "INSTALL",
      "executable": "npm",
      "arguments": ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      "workingDirectory": ".",
      "timeoutMs": 600000,
      "networkMode": "RESTRICTED_INSTALL",
      "expectedExitCodes": [0],
      "environment": { "CI": "true" }
    }
  ],
  "reproductionCommands": [
    {
      "phase": "REPRODUCE",
      "executable": "npm",
      "arguments": ["run", "build"],
      "workingDirectory": ".",
      "timeoutMs": 600000,
      "networkMode": "NONE",
      "expectedExitCodes": [1],
      "environment": { "CI": "true" }
    }
  ],
  "failureSignature": {
    "expectedText": "Missing script: build:super",
    "minimumSimilarity": 0.85,
    "requireNonZeroExit": true
  },
  "repeatCount": 2,
  "artifactPaths": ["reports/build-result.json"]
}
```

The API returns `202 Accepted` for an approved queued request or a durable `POLICY_BLOCKED` representation when policy denies execution. Policy denial is not converted into a generic server error.

## List incident reproductions

`GET /incidents/{incidentId}/reproductions?limit=25&cursor=...&status=...&result=...`

Required permission: `READ_REPRODUCTION`.

Pagination is cursor-based. `limit` is bounded to 100.

## Get a reproduction

`GET /reproductions/{reproductionId}`

Returns:

- lifecycle status and final result;
- immutable policy decision;
- original and observed failure signatures;
- comparison rationale and similarity;
- environment fingerprint;
- command metadata and exit status;
- artifact manifest;
- cleanup proof;
- cancellation and timing fields.

Raw host paths, Docker credentials and source content are not returned.

## Cancel a reproduction

`POST /reproductions/{reproductionId}/cancel`

Required permission: `CANCEL_REPRODUCTION`.

Cancellation is cooperative and durable. The API records `cancellationRequestedAt`; the worker observes it, terminates active execution, performs cleanup and records the final state. Repeated cancellation requests are idempotent.

## Stream/poll logs

`GET /reproductions/{reproductionId}/logs?afterSequence=0&limit=100`

Logs are returned in ascending monotonic order. Each item contains content after redaction, byte size, stream, sequence, previous hash, chunk hash, truncation state and timestamp. The client should pass the last sequence as `afterSequence` for incremental polling.

A truncated stream is evidence that the configured byte limit was reached, not a transport error.

## List artifacts

`GET /reproductions/{reproductionId}/artifacts`

Returns an integrity manifest only in Sprint 4. Every artifact has a repository-relative path, media type, byte size, SHA-256 digest, retention class and optional storage reference.

## Status and result semantics

Status describes execution lifecycle. Result describes reproduction interpretation.

| Status                  | Meaning                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `REQUESTED`             | Durable request exists and awaits policy/worker processing. |
| `PREPARING`             | Workspace and image identity are being prepared.            |
| `INSTALLING`            | Approved dependency installation is running.                |
| `REPRODUCING`           | Network-disabled reproduction commands are running.         |
| `COLLECTING`            | Logs, signatures and artifacts are being finalized.         |
| `CLEANING`              | Execution resources are being removed and verified.         |
| `COMPLETED`             | Execution and cleanup completed.                            |
| `POLICY_BLOCKED`        | Policy denied execution.                                    |
| `CANCELLED`             | Authorized cancellation completed.                          |
| `TIMED_OUT`             | Deadline ended execution.                                   |
| `INFRASTRUCTURE_FAILED` | Provider could not produce trustworthy evidence.            |
| `CLEANUP_FAILED`        | Resource absence was not proved.                            |

| Result                  | Meaning                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `REPRODUCED`            | Every repeat consistently matched the expected failure and exit condition. |
| `NOT_REPRODUCED`        | Repeats consistently did not match.                                        |
| `INCONCLUSIVE`          | Runs diverged or evidence was insufficient.                                |
| `POLICY_BLOCKED`        | No execution occurred because policy denied it.                            |
| `INFRASTRUCTURE_FAILED` | Execution infrastructure, not the repository, failed.                      |

## Validation and limits

The API rejects:

- unsupported executables;
- command arrays above policy maximum;
- shell control syntax or control characters;
- absolute and traversing working directories;
- reproduction networking;
- unapproved registries or unpinned production images;
- environment keys outside the allowlist;
- credential-like environment values;
- oversized expected signatures;
- excessive repeats, artifacts or query pages;
- cross-tenant incident, worktree or reproduction IDs.
