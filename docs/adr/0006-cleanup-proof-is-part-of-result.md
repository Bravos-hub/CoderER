# ADR 0006: Cleanup Proof Is Part of the Reproduction Result

## Status

Accepted

## Context

A sandbox can reproduce a failure successfully while still leaving containers, volumes or networks behind. Treating that run as complete hides security and cost risk.

## Decision

Cleanup runs in every terminal path and independently verifies resource absence. A failed absence proof changes the execution status to `CLEANUP_FAILED`. The removed resource identifiers, attempts, error and digest are persisted in an immutable cleanup record.

## Consequences

- a technically successful repository reproduction may still fail the overall execution;
- operators receive an explicit incident requiring reconciliation;
- cleanup must remain idempotent;
- production monitoring must alert on every cleanup failure and unexpected reconciled resource.
