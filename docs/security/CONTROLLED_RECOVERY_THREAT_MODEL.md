# Controlled Recovery Threat Model

## Protected assets

Customer source code, approved treatment plans, immutable base commits, recovery policy, worktrees, patch versions, evidence citations, provider credentials, verification output, publication approvals, audit history and tenant boundaries.

## Threat actors and hostile inputs

- a repository author embedding instructions intended to broaden repair scope;
- a compromised model returning traversal paths, binary changes, fabricated citations or hidden dependency changes;
- a malicious tenant attempting cross-organization recovery access;
- a stale worker writing after lease loss;
- a service or agent identity attempting human publication approval;
- a patch that alters CI, infrastructure, migrations, authentication or security controls without elevated policy;
- a crafted Git repository using symlinks, submodules, sparse checkout, hooks or alternate object databases to escape confinement;
- verification output that hides unexpected generated files or cleanup failure.

## Primary controls

### Immutable authorization chain

Only an approved treatment-plan version can start recovery. The recovery records its policy version, treatment-plan version, base commit SHA and branch name. Any later revision produces a new patch version and approval round.

### Path and Git confinement

All paths are normalized and canonicalized below approved roots. Traversal, absolute paths, `.git` changes, symlink escape, submodule changes, binary patches and unsupported file types fail closed. Git commands use argument arrays with prompts, hooks and ambient configuration disabled.

### Deny-by-default patch policy

The model cannot expand scope or budgets. Dependency, lockfile, workflow, infrastructure, migration, generated-file and security-sensitive changes require explicit policy. File, line, hunk and byte budgets are evaluated before application.

### Atomic application and provenance

The system validates the complete diff before applying it. `git apply --check` precedes indexed application. Failure triggers rollback. Every hunk must cite an approved treatment step and diagnosis evidence; patch and file contents are integrity hashed.

### Independent review and verification

A separate security reviewer can block publication. Verification runs in the hardened sandbox with no host execution, no service credentials and bounded resources. Unexpected changes, original-failure persistence or cleanup failure block publication.

### Human governance

Only authenticated human `USER` actors with the required permission can approve publication. Service, system and agent actors are rejected. High-risk or multi-approval recoveries enforce separation of duties and count distinct actors per immutable patch version.

### Tenant isolation and execution integrity

Application authorization and forced PostgreSQL RLS protect all recovery records. Worker writes require a current lease. Stale workers are fenced, while cleanup and corrective cleanup evidence remain append-only.

## Residual risks

- a syntactically safe patch can still contain subtle business-logic defects;
- tests can be incomplete or environment-specific;
- a compromised identity provider can issue a valid human session;
- a malicious base repository may exploit an unknown Git or container-runtime vulnerability;
- a reviewer can approve an unsafe but policy-compliant patch.

These risks require MFA, protected branches, mandatory independent review, hardened Git/container infrastructure, private live-model evaluations, penetration testing, organization-specific policy and normal software supply-chain controls.

## Prohibited production configurations

Direct push to protected branches, automatic merge, local host execution of repository commands, writable container-runtime sockets, unrestricted network access, mutable execution images, model-selected permissions, unbounded diffs, service-account publication approval, bypassing RLS, accepting unverified cleanup or recreating a PR from any patch other than the approved digest.
