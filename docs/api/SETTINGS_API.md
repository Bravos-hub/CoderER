# Organization Settings API

Base path: `/api/v1/settings`. Requests require the normal API authentication and signed tenant
context. Mutations additionally require an authenticated human `USER` actor with the
`ORGANIZATION_OWNER` or `ORGANIZATION_ADMIN` role.

Supported kinds are `ORGANIZATION`, `AI`, `RECOVERY`, `PUBLICATION` and `SECURITY`.

## Read the latest version

`GET /settings/:kind` returns the latest immutable setting version for the current organization, or
`null` when the kind has not been configured.

## Append a version

`POST /settings/:kind` accepts:

```json
{
  "expectedVersion": 0,
  "enforcement": "ENFORCED",
  "description": "Organization policy description",
  "configuration": { "retentionDays": 365 }
}
```

`expectedVersion` is zero for the first version and must match the latest stored version thereafter.
The response contains the appended version, canonical SHA-256 `contentHash`, creator and timestamp.
Concurrent or stale writes fail instead of overwriting policy. Enforcement is `ENFORCED` or
`MONITOR`; the configuration must be a JSON object.
