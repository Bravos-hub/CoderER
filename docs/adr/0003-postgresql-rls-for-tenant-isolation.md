# ADR 0003: PostgreSQL RLS as a Tenant Isolation Boundary

- Status: Accepted
- Date: 2026-07-12

## Context

Application predicates alone are vulnerable to omission during future feature work. CodeER may process highly sensitive private repositories and incident evidence.

## Decision

Keep explicit tenant predicates and additionally force PostgreSQL row-level security. Each transaction sets a local organization ID. Direct and parent-derived policies constrain all tenant-owned tables. A worker bypass exists only for the cross-tenant outbox dispatcher.

## Consequences

- accidental missing filters fail closed;
- every data access path must enter a tenant transaction;
- reporting and migration identities require separate reviewed roles;
- integration tests must run against PostgreSQL, not only mocks;
- connection-pool transaction boundaries must be respected.
