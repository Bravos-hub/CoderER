# ADR 0004: Dedicated Remote Sandbox Execution Boundary

## Status

Accepted

## Context

Mounting `/var/run/docker.sock` into the general CodeER worker would give that worker root-equivalent control over its host and collapse the control-plane/execution-plane boundary. Executing repository commands directly on the worker host is unacceptable.

## Decision

Production sandbox workers must use a dedicated remote execution fleet through an authenticated Docker endpoint or a future provider with equivalent isolation. Production configuration rejects a local Unix Docker socket. Sandboxes never receive daemon credentials or a Docker socket.

## Consequences

- execution fleet can be isolated, patched, scaled and destroyed independently;
- worker-to-daemon credentials become security-sensitive and require rotation;
- network latency and daemon availability become explicit failure modes;
- local development may use a local daemon, but cannot be treated as production evidence;
- higher-risk tenants may later select a stronger microVM provider through the same interface.
