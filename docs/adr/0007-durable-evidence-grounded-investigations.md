# ADR 0007: Durable Evidence-Grounded Investigations

**Status:** Accepted

## Decision

Investigation is a durable state machine persisted through checkpoints, leases, immutable events and a transactional outbox. Model calls are not the workflow system of record. Every published claim must cite a committed context item by source ID and digest.

## Consequences

Worker crashes and provider failures are resumable. Stale workers are fenced. The design adds persistence and reconciliation complexity, but prevents partial or unauditable AI conclusions from becoming recovery authority.
