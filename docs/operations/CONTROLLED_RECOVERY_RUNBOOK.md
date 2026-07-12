# Controlled Recovery Operations Runbook

## Health indicators

Monitor queue depth, oldest request age, active/expired leases, stage duration, policy-block rate, patch rejection rate, security rejection rate, verification failure rate, cleanup failure, revision count, approval backlog, model cost, sandbox utilization and cross-tenant authorization failures.

## Recovery stuck in progress

1. Inspect the latest checkpoint, heartbeat and lease expiry.
2. Confirm worker, Redis, PostgreSQL, provider and sandbox health.
3. Do not edit status or checkpoint rows manually.
4. After lease expiry, run `npm run recovery:reconcile`.
5. Preserve correlation IDs, model request IDs, patch digest and cleanup evidence.
6. Do not resume when the worktree root or base commit can no longer be verified.

## Policy-blocked patch

Review the deterministic reasons and treatment-plan scope. Do not weaken global policy to pass one recovery. Request a new treatment-plan/recovery revision with explicit elevated approval for dependencies, workflows, infrastructure, migrations or security-sensitive files.

## Security rejection

Keep the recovery non-publishable. Inspect findings, diff and evidence citations. Escalate suspected secret exposure, privilege escalation, authentication bypass, CI permission broadening or data migration risk to the security incident process.

## Verification failure

Compare the original failure, mandatory checks, unexpected changes and sandbox cleanup. A failure requires a new patch version; never overwrite the failed verification or approve publication based on manual local testing alone.

## Cleanup failure

Page operations. Quarantine the worker/sandbox host if resource absence cannot be proven. Run reconciliation after confirming no active lease. Append corrective cleanup evidence; never edit the failed record.

## Publication approval incident

Service-account decisions must return 403. Verify identity-edge signature, actor type, role, patch version and expected recovery version. Confirm distinct approvers and separation of duties. Do not change approval counts by SQL.

## Migration and deployment order

1. Apply Sprint 6 migration with the migration role.
2. Provision and verify runtime/worker roles and forced RLS.
3. Deploy API and worker with recovery creation disabled.
4. Run recovery persistence, Git and sandbox smoke tests.
5. Deploy the command-centre UI.
6. Enable recovery creation for a controlled tenant.
7. Keep publication adapters disabled until protected-branch and GitHub App reviews pass.

## Rollback

Disable new recovery creation and queue dispatch. Allow in-flight work to reach cleanup or cancel it through the API. Preserve immutable evidence and worktrees needed for investigation. Roll back application binaries without dropping recovery tables. Reconcile all managed worktrees and branches before declaring rollback complete.

## Release gates

Source checks, production builds, Prisma validation, migration execution, role/RLS verification, recovery persistence smoke, real Git worktree tests, hardened sandbox verification, adversarial evaluation, secret/dependency/container scans, human-session integration, multi-approver tests and operational review must pass.
