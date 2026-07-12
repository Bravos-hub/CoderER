## Purpose

Describe the user or engineering problem addressed by this change.

## Changes

-

## Evidence and validation

- [ ] `npm run check` passes.
- [ ] New or changed behaviour has tests.
- [ ] Logs and screenshots contain no secrets or personal data.
- [ ] The patch is limited to the intended scope.

## Security review

- [ ] Inputs are validated at the trust boundary.
- [ ] Authentication and authorization remain fail-closed.
- [ ] No credential is placed in source, URLs, command arguments, logs, queue results, or browser bundles.
- [ ] Shell and Git operations use argument arrays with `shell: false`.
- [ ] File paths are constrained to an approved workspace root.
- [ ] Network access and third-party permissions use least privilege.
- [ ] Failure messages exposed to users do not reveal stack traces, tokens, internal paths, or infrastructure details.
- [ ] Dependency, container, database, and migration changes were reviewed.

## Rollback

Describe how to disable or reverse this change safely.
