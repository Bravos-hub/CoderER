# CodeER Threat Model

## 1. Scope

This threat model covers repository admission, GitHub App authentication, clone and worktree creation, Redis queues, the API and web boundary, future Codex orchestration, sandbox execution, evidence storage, verification and pull-request generation.

## 2. Protected assets

1. GitHub App private keys and installation tokens.
2. OpenAI and infrastructure credentials.
3. Customer source code, configuration and Git history.
4. Build logs, test output, patches and diagnosis evidence.
5. Repository integrity and branch protection.
6. CodeER control-plane availability and audit records.
7. Customer identity, organization and authorization data.

## 3. Trust boundaries

```text
Browser
  -> Next.js BFF
  -> authenticated API
  -> Redis queue
  -> worker control plane
  -> repository workspace
  -> isolated execution sandbox
  -> Codex/model gateway
  -> verification engine
  -> GitHub pull request
```

Every arrow is a validation and authorization boundary. Queue data, model output and repository content are untrusted even when produced inside CodeER.

## 4. Principal threats and controls

| Threat                         | Example                                                | Required controls                                                                                                                     |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Credential theft               | Token appears in a clone URL or log                    | GitHub App short-lived tokens, header-based Git auth, log redaction, secret manager, no browser exposure                              |
| Command injection              | Repository name becomes shell syntax                   | `spawn` with argument arrays, `shell: false`, strict schemas, command allowlists                                                      |
| Path traversal                 | Crafted owner or branch escapes workspace              | canonical paths, safe segments, root containment checks, no archive extraction without validation                                     |
| Malicious Git configuration    | Filter or helper executes during checkout              | ignore system/global Git config, disable prompts and hooks, allow HTTPS protocol only, skip LFS smudge                                |
| Repository resource exhaustion | Huge history, branch count or file tree                | shallow clone, branch pagination cap, file and byte limits, timeouts, queue concurrency limits                                        |
| SSRF                           | User provides an internal Git or API host              | canonical `github.com` repository URLs, HTTPS-only API endpoints, controlled egress                                                   |
| Unauthorized repository access | User admits another organization's private repo        | GitHub installation authorization, tenant mapping and repository permission checks before clone                                       |
| Queue tampering                | Forged or replayed job                                 | authenticated API, schema validation at producer and consumer, opaque IDs, future signed job envelopes                                |
| Agent prompt injection         | Repository instructions tell the agent to leak secrets | treat repository text as data, tool policy engine, no direct secret access, structured outputs, independent verification              |
| Sandbox escape                 | Build script attacks host or Docker socket             | no Docker socket mount, rootless/non-root execution, dropped capabilities, seccomp/AppArmor, network deny by default, resource quotas |
| Excessive patch                | Agent edits unrelated files                            | patch size and file limits, treatment-plan approval, changed-file allowlist, human review                                             |
| Verification spoofing          | Repair agent reports its own success                   | independent verification process, immutable original failure evidence, deterministic commands                                         |
| Sensitive error disclosure     | API returns stack or filesystem paths                  | centralized exception filter, correlation IDs, secure internal logs                                                                   |
| Supply-chain compromise        | Malicious dependency or action                         | lockfile, `npm ci`, Dependabot, audit, CodeQL, SBOM, reviewed/pinned CI actions                                                       |

## 5. Agent-specific security rules

- Model output is never executable by default.
- Each proposed command is parsed into a structured command request.
- A policy engine decides whether the command, working directory, timeout, environment and network profile are allowed.
- Agents receive scoped repository context and short-lived capabilities, not platform-wide credentials.
- The repair agent cannot mark its own work verified.
- The release agent can prepare a pull request but cannot merge it.
- Evidence is append-only and linked to the incident, worktree, command and actor that created it.

## 6. MVP residual risks

The initial workspace does not yet provide tenant identity, sandbox execution, encrypted evidence persistence, signed queue envelopes or complete audit immutability. Those features are mandatory before onboarding private enterprise repositories. The MVP should be used only with controlled demo repositories until the corresponding security gates pass.

## 7. Security acceptance gate

A production release is blocked unless:

- no critical or high known dependency vulnerability remains without documented exception;
- authentication and authorization tests pass;
- private-repository access is verified against installation permissions;
- sandbox escape and network-isolation tests pass;
- secrets scanning and CodeQL pass;
- rollback instructions exist;
- audit events cover admission, approval, execution, verification and PR creation;
- a human security reviewer approves the change.
