# Investigations API

Base path: `/api/v1`.

All routes require API authentication, signed tenant and actor context in production, server-side authorization and forced-RLS data access. Write requests use bounded JSON and idempotency or optimistic concurrency where applicable.

## Start and inspect investigations

- `POST /incidents/:incidentId/investigations` — starts an idempotent investigation for a completed, cleanup-verified `REPRODUCED` result.
- `GET /incidents/:incidentId/investigations` — cursor-paginated incident investigations.
- `GET /investigations/:investigationId` — current run, checkpoint and usage summary.
- `GET /investigations/:investigationId/events` — ordered hash-linked events.
- `GET /investigations/:investigationId/tool-calls` — bounded audited read-only tool calls.
- `GET /investigations/:investigationId/diagnosis` — citation-valid diagnosis when published.
- `GET /investigations/:investigationId/treatment-plans` — immutable plan versions.

Creation requires `Idempotency-Key` in production. Requested models must be organization approved. The API never accepts arbitrary prompts, tool definitions or provider credentials.

## Lifecycle controls

- `POST /investigations/:investigationId/cancel`
- `POST /investigations/:investigationId/resume`

Cancellation is durable and propagated to the worker/provider boundary. Resume is allowed only from explicitly resumable terminal states and committed checkpoints.

## Human treatment-plan decisions

- `POST /treatment-plans/:planId/approve`
- `POST /treatment-plans/:planId/reject`
- `POST /treatment-plans/:planId/request-revision`

The body includes `comment` and `expectedVersion`. These endpoints reject service, agent and system actors. Production requests require a fresh signed human identity context. Duplicate decisions by the same actor are idempotent. Approvals count distinct human actors and do not mark a plan approved until the configured threshold is met.

## Error behavior

Responses do not expose provider payloads, API keys, internal paths, SQL, stack traces or hidden model reasoning. Expected outcomes use stable 4xx responses for malformed input, missing tenant resources, stale versions, forbidden roles and invalid lifecycle state. Provider, tool, budget and security failures are represented in the durable investigation status and audit timeline.
