# ADR 0002: Hash-Chained Incident and Audit History

- Status: Accepted
- Date: 2026-07-12

## Context

CodeER proposes and later executes source-code repairs. Operators must be able to detect silent changes to the evidence and decision history.

## Decision

Canonicalize event data and chain SHA-256 hashes through `previousHash`. Reject update/delete on incident events and audit logs. Recompute the incident chain on detail reads and expose the integrity result.

## Consequences

- mutation is detectable;
- sequence gaps are detectable;
- canonical serialization is a compatibility contract;
- database administrators can still replace multiple rows unless chain heads are anchored externally;
- future releases should sign periodic chain heads with KMS.
