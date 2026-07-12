## Purpose

Describe the user or engineering problem addressed by this change.

## Changes

-

## Evidence and validation

- [ ] `npm run check` passes.
- [ ] New or changed behavior has tests.
- [ ] Required PostgreSQL integration tests pass when persistence changed.
- [ ] Required Docker sandbox smoke tests pass when execution behavior changed.
- [ ] Logs, screenshots and artifacts contain no secrets or personal data.
- [ ] The patch is limited to the intended scope.

## Security review

- [ ] Inputs are validated at the trust boundary.
- [ ] Authentication, authorization and tenant isolation remain fail-closed.
- [ ] No credential is placed in source, URLs, command arguments, logs, queue results, artifacts or browser bundles.
- [ ] Process and Git execution use argument arrays with `shell: false`.
- [ ] File paths are canonicalized and constrained to an approved root.
- [ ] Network access and third-party permissions use least privilege.
- [ ] Failure messages exposed to users do not reveal stack traces, tokens, internal paths or infrastructure details.
- [ ] Dependency, container, database and migration changes were reviewed.

## Sandbox review

Complete this section when repository-controlled code or sandbox infrastructure changes.

- [ ] No repository command can execute on the API, worker or operator host.
- [ ] No Docker socket, privileged mode, host PID/IPC/network namespace, device mount or added capability is exposed.
- [ ] Sandbox images are approved and digest-pinned for production.
- [ ] Reproduction networking is disabled; installation egress is explicit and restricted.
- [ ] CPU, memory, PIDs, runtime, workspace, temp, output, log and artifact limits are enforced.
- [ ] Environment variables are constructed from an allowlist and contain no service credentials.
- [ ] Timeout, cancellation and worker-crash paths terminate work and trigger cleanup.
- [ ] Cleanup is idempotent and independently verified with immutable evidence.
- [ ] `npm run test:integration:sandbox:persistence` passes when sandbox persistence changed.
- [ ] `npm run test:integration:sandbox:docker` passes when provider or policy behavior changed.

## Rollback

Describe how to disable or reverse this change safely, including how to reconcile active sandbox executions and prove that resources are absent.

## Issue linkage

Use `Closes #<issue>` only when every acceptance criterion and required infrastructure gate has passed.
