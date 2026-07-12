# ADR 0008: Separate Untrusted Evidence from Instructions

**Status:** Accepted

## Decision

Repository material, logs, comments, metadata, user context and model output are untrusted data. They are serialized separately from system and organization policy. Agents may use only application-defined, agent-specific, read-only tools.

## Consequences

Prompt injection cannot grant capabilities. Tool behavior remains deterministic and auditable. Some investigations may stop for insufficient evidence rather than using a generic shell or internet tool; this is an intentional fail-closed tradeoff.
