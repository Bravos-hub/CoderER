# CodeER Security Architecture

## Security principles

1. **Zero implicit trust:** repository content, user input, queue messages and model output are untrusted.
2. **Least privilege:** each service, agent and GitHub token receives only the permissions needed for one operation.
3. **Fail closed:** production startup fails when authentication or required security configuration is absent.
4. **Credential containment:** secrets remain server-side and are never included in browser bundles, Git URLs, command arguments or evidence.
5. **Isolation by default:** repository modification and execution occur in separate worktrees and hardened sandboxes.
6. **Independent verification:** the component that repairs code is not the authority that declares recovery.
7. **Evidence and auditability:** material decisions and operations emit attributable, timestamped events.

## Current controls

### Web boundary

The browser calls same-origin Next.js route handlers. The BFF validates admission input and adds the internal bearer credential server-side. Security headers deny framing, restrict content sources and disable unnecessary browser capabilities.

### API boundary

The API uses a strict origin allowlist, bounded request bodies, rate limiting, bearer authentication in production, request correlation IDs, whitelist validation and centralized safe errors. API keys are transitional; enterprise identity will replace them with OIDC sessions and organization-scoped authorization.

### GitHub boundary

Repository URLs must use canonical credential-free GitHub HTTPS. Private access uses short-lived GitHub App installation tokens. The GitHub API client uses HTTPS and bounded request/branch limits.

### Git boundary

Git runs with `shell: false`, terminal prompts disabled, global and system config disabled, hooks redirected to the null device, non-HTTPS protocols denied and credentials passed only through an ephemeral HTTP header environment. Clone depth, duration, output, file count and bytes are bounded.

### Container boundary

Application containers run as an unprivileged UID, drop Linux capabilities, enable `no-new-privileges`, use read-only root filesystems and receive writable storage only where required. Databases bind to loopback for local development. Production requires managed private networks, TLS and external secret management.

### Supply chain

The repository includes a lockfile, deterministic `npm ci`, Dependabot, dependency review, CodeQL, production dependency audit, a baseline secret-pattern scanner and CycloneDX SBOM generation.

## Required pre-enterprise controls

- OIDC/SAML identity and organization-scoped RBAC.
- GitHub App permission verification and tenant-to-installation binding.
- KMS-backed envelope encryption for evidence and credentials.
- Dedicated per-session sandbox runtime with CPU, memory, PID, disk and time quotas.
- Egress proxy with destination allowlists and DNS controls.
- Signed and versioned command-policy bundles.
- Append-only audit storage and SIEM export.
- Data retention, deletion and residency policies.
- Backup restoration tests and disaster recovery objectives.
- Incident response runbooks and external penetration testing.
