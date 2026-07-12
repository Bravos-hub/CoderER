# CodeER Security Policy

Security is a release criterion for CodeER, not a post-launch feature. CodeER handles source code, repository metadata, installation credentials, command execution, build logs, patches and pull-request output. A weakness in any boundary can affect customer repositories, so suspected vulnerabilities must be handled privately and promptly.

## Reporting a vulnerability

Do not open a public issue. Use the repository's **Security** tab and select **Report a vulnerability** to create a private security advisory:

`https://github.com/Bravos-hub/CoderER/security/advisories/new`

Include the affected component, reproduction steps, impact, required privileges, logs with secrets removed, and any proposed mitigation. Do not include real customer source code or credentials.

## Response targets

| Severity | Initial acknowledgement |   Triage target |          Remediation target |
| -------- | ----------------------: | --------------: | --------------------------: |
| Critical |                24 hours |        48 hours | Immediate emergency release |
| High     |                48 hours | 3 business days |                      7 days |
| Medium   |         3 business days |          7 days |                     30 days |
| Low      |         5 business days |         14 days |             Planned release |

Targets may change after impact analysis, but risk acceptance must be documented.

## Supported versions

During Build Week, only the latest `main` branch and current tagged release are supported. Commercial releases will define explicit support windows and security patch channels.

## Security guarantees

CodeER must never:

- push directly to a protected default branch;
- automatically merge a generated repair;
- place credentials in Git command arguments or remote URLs;
- expose credentials, stack traces or private filesystem paths in user-facing errors;
- execute repository code outside an isolated sandbox;
- trust agent-generated commands without policy validation;
- accept repository paths that escape the configured workspace root;
- treat an AI-generated patch as verified recovery.

## Required repository settings

Before production, enable branch protection, required pull-request reviews, required CI and CodeQL checks, secret scanning, push protection, Dependabot alerts, private vulnerability reporting, signed release artifacts and restricted GitHub App permissions.
