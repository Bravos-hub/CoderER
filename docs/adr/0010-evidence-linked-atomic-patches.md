# ADR 0010: Evidence-Linked Atomic Patches

## Status

Accepted.

## Context

Model-generated code changes are unsafe when applied as free-form file writes. CodeER needs a deterministic boundary that can explain every changed hunk, enforce organization policy and recover from partial failure.

## Decision

Recovery agents produce a structured canonical unified diff. Deterministic code parses and validates the whole patch before application. Every hunk references an approved treatment-plan step and diagnosis evidence. `git apply --check` is followed by indexed atomic application in an isolated worktree. A failed application is rolled back. Patch versions, files, hunks, policy decisions and content digests are immutable.

## Consequences

This limits some complex refactors and binary/generated changes, but it provides reproducibility, auditability, bounded scope and safe revision semantics. Elevated change categories require explicit policy rather than implicit model discretion.
