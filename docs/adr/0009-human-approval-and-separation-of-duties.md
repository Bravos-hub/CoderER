# ADR 0009: Human Approval and Separation of Duties

**Status:** Accepted

## Decision

Only authenticated human `USER` actors may decide treatment plans. Service, system and agent identities are prohibited. Plans can require multiple distinct approvers; duplicate actor decisions are idempotent, and final approval occurs only when the threshold is reached.

## Consequences

The BFF requires a signed human session for decision routes. High-risk plans can enforce dual control. Identity-provider compromise remains a critical risk and must be mitigated by MFA, short session lifetime, managed signing keys and audit monitoring.
