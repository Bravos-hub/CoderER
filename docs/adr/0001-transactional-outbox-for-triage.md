# ADR 0001: Transactional Outbox for Triage Dispatch

- Status: Accepted
- Date: 2026-07-12

## Context

Writing an incident to PostgreSQL and publishing a triage job to Redis are two independent operations. Direct publish can produce a committed incident without work or a queued job without committed incident state.

## Decision

Persist a uniquely keyed outbox message in the same serializable transaction as incident state and events. A dispatcher claims rows with `FOR UPDATE SKIP LOCKED`, publishes to BullMQ, then marks them published. Failures retry with a lease and dead-letter threshold.

## Consequences

- accepted intent is durable in PostgreSQL;
- Redis outages delay but do not lose work;
- duplicate delivery must be tolerated;
- the dispatcher adds operational complexity;
- outbox lag becomes an explicit SLI.
