# Incident API

Base path: `/api/v1`

## Request security

Production requests require:

```http
Authorization: Bearer <internal-service-token>
X-Request-Id: <safe-unique-id>
X-Correlation-Id: <safe-correlation-id>
X-CodeER-Organization-Id: <uuid>
X-CodeER-Actor-Id: <actor-id>
X-CodeER-Actor-Type: USER|SERVICE|AGENT|SYSTEM
X-CodeER-Actor-Roles: INCIDENT_COMMANDER,RESPONDER
X-CodeER-Context-Timestamp: <ISO-8601>
X-CodeER-Context-Signature: <base64url-hmac-sha256>
```

Clients should normally use the same-origin web BFF rather than construct internal headers directly.

## Error envelope

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Actor is not authorized for incident:transition.",
  "requestId": "..."
}
```

Sensitive internal errors are replaced by the secure exception filter. Use `requestId` to correlate with server logs.

## Create incident

`POST /incidents`

Requires `incident:create`. Manual severity requires `incident:severity:override` and a reason.

```http
Idempotency-Key: incident-20260712-build-001
Content-Type: application/json
```

```json
{
  "repositoryId": "7f3df97f-56fa-4e9a-b3a8-c5b87df4a7bc",
  "title": "Production build blocked",
  "description": "The web workspace cannot resolve its shared contract package.",
  "source": "GITHUB_ACTIONS",
  "externalReference": "github-run:123456",
  "labels": ["build", "production"],
  "impact": {
    "availability": 2,
    "affectedUsers": 2500,
    "revenueImpact": 1,
    "dataIntegrity": 0,
    "securityImpact": 0,
    "environment": "production"
  },
  "signals": {
    "errorMessage": "Missing workspace package",
    "failingCommand": "npm run build",
    "deploymentBlocked": true,
    "failingTests": true
  }
}
```

Returns the admitted incident. Triage is requested transactionally in the same database commit.

## List incidents

`GET /incidents`

Query parameters:

- `limit` — 1–100, default 25;
- `cursor` — opaque cursor returned by previous page;
- `repositoryId`;
- `status`;
- `severity`;
- `source`.

```json
{
  "items": [],
  "nextCursor": null
}
```

The cursor represents `(lastActivityAt, id)` and must be treated as opaque.

## Incident detail

`GET /incidents/{incidentId}`

Returns:

- current aggregate;
- latest severity assessment;
- latest repository-health snapshot;
- bounded evidence list;
- ordered event timeline;
- timeline integrity result.

```json
{
  "timelineIntegrity": {
    "valid": true,
    "checkedEvents": 8,
    "brokenSequence": null,
    "reason": null
  }
}
```

Recovery must not proceed when `valid=false`.

## Add evidence

`POST /incidents/{incidentId}/evidence`

Requires `incident:evidence:add`; restricted evidence additionally requires `incident:evidence:restricted`.

```json
{
  "kind": "LOG",
  "source": "CI",
  "sensitivity": "INTERNAL",
  "title": "Production build log",
  "summary": "Failure excerpt collected from CI.",
  "payload": {
    "command": "npm run build",
    "output": "..."
  },
  "origin": "github-actions://run/123456"
}
```

Inline payload is limited to 256 KiB. Secret-bearing fields and token-shaped values are redacted before digesting and persistence.

## Request triage

`POST /incidents/{incidentId}/triage`

Requires `incident:triage:request`.

```json
{
  "force": false,
  "signals": {
    "deploymentBlocked": true,
    "recurrenceCount": 2
  }
}
```

Returns `202 Accepted` with the updated incident. The outbox dispatcher asynchronously publishes the triage job.

## Transition incident

`POST /incidents/{incidentId}/transitions`

Requires `incident:transition`.

```json
{
  "toStatus": "AWAITING_APPROVAL",
  "expectedVersion": 4,
  "reason": "Root cause and treatment plan are ready for review."
}
```

A stale `expectedVersion` returns `409 Conflict`.

## Latest repository health

`GET /repositories/{repositoryId}/health/latest`

Returns the newest immutable health snapshot in the active organization.

## Status codes

| Code | Meaning                                                 |
| ---: | ------------------------------------------------------- |
|  200 | Successful query or transition                          |
|  201 | Incident or evidence created                            |
|  202 | Triage accepted                                         |
|  400 | Contract, cursor or lifecycle error                     |
|  401 | Missing/invalid authentication or signed context        |
|  403 | Role lacks required permission                          |
|  404 | Resource not present in active tenant                   |
|  409 | Idempotency conflict or optimistic-concurrency conflict |
|  429 | Rate limit exceeded                                     |
|  500 | Safe internal failure response                          |
|  503 | Dependency readiness failure                            |
