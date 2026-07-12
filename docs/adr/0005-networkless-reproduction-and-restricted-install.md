# ADR 0005: Networkless Reproduction and Restricted Installation

## Status

Accepted

## Context

Untrusted repository code with network access can exfiltrate source, scan internal infrastructure, access metadata services or download mutable behavior. Some dependency installations still require approved registries.

## Decision

Reproduction commands always run with network mode `none`. Installation is a separate phase and may use only a pre-provisioned restricted network backed by an egress policy. The policy engine rejects reproduction networking and unsafe built-in Docker networks.

## Consequences

- reproduced behavior may differ from applications that require live external services;
- such cases are reported as inconclusive unless safe service doubles are provided;
- registry/DNS allowlists and private-network denial must be implemented in infrastructure, not assumed from a Docker network name;
- network policy becomes durable evidence attached to every run.
