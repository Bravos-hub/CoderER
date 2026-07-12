# Secure Development Lifecycle

## Design

Every feature identifies assets, actors, trust boundaries, abuse cases and rollback behaviour. Changes involving authentication, GitHub permissions, command execution, sandboxes, network egress, secrets, cryptography, evidence or release automation require an explicit security review.

## Implementation

- Validate inputs with shared runtime schemas.
- Prefer typed APIs and structured agent outputs.
- Never construct shell command strings.
- Keep credentials out of logs, URLs and persistent job results.
- Apply time, size, count and concurrency limits to external work.
- Add tests for rejected malicious input, not only valid input.

## Review

Pull requests use the security checklist and CODEOWNERS. Reviewers inspect permission changes, data flow, error disclosure, dependency updates, migration safety and rollback instructions.

## Verification

Required gates are formatting, linting, type checking, unit tests, production builds, secret-pattern scanning, production dependency audit, CodeQL and dependency review. Security-sensitive features add integration and abuse-case tests.

## Release

Releases use immutable commits, generated SBOMs, protected environments and least-privilege deployment identities. Commercial releases will add signed provenance and artifact signatures.

## Operations

Security events are monitored, vulnerabilities are privately disclosed, tokens are rotated, access is reviewed and recovery procedures are rehearsed. Any credential exposure triggers revocation first, investigation second.
