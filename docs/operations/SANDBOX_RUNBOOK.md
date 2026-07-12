# Sandbox Operations Runbook

## Ownership

The sandbox service requires named owners for application, database, execution-fleet, network-security and incident-response duties. A production deployment must not rely on a general-purpose Docker host owned informally by developers.

## Pre-deployment checklist

- Execution images and helper image are approved and digest-pinned.
- Remote Docker endpoint is dedicated to CodeER sandboxes.
- Mutual TLS or an equivalently authenticated transport is enabled.
- Worker cannot access the host Unix Docker socket.
- Execution nodes cannot reach CodeER control-plane databases, Redis or cloud metadata.
- Restricted installation network is enforced by an egress gateway.
- Workspace volume driver enforces byte quotas.
- Mandatory access control profile is active.
- API and worker database roles are provisioned separately.
- Migrations, role-boundary tests and sandbox smoke tests pass.
- Queue concurrency is below verified fleet capacity.
- Reconciliation job is scheduled and alerted.
- Logs and metrics are connected to the security monitoring platform.

## Deployment sequence

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run db:migrate:all
npm run db:provision:runtime
npm run db:verify:roles
npm run test:integration:incident
npm run test:integration:sandbox:persistence
npm run test:integration:sandbox:docker
```

Then deploy in this order:

1. migrations;
2. database roles and grants;
3. API;
4. outbox/triage worker;
5. sandbox execution worker at concurrency zero;
6. validate daemon connectivity and image identity;
7. raise sandbox concurrency gradually;
8. web command centre.

## Required production variables

```env
NODE_ENV=production
SANDBOX_DEFAULT_IMAGE=registry.example/codeer/node@sha256:<digest>
SANDBOX_HELPER_IMAGE=registry.example/codeer/helper@sha256:<digest>
SANDBOX_APPROVED_REGISTRIES=registry.example
SANDBOX_DOCKER_HOST=tcp://sandbox-daemon.internal:2376
SANDBOX_DOCKER_TLS_VERIFY=true
SANDBOX_DOCKER_CERT_PATH=/run/secrets/docker-client
SANDBOX_WORKSPACE_VOLUME_DRIVER=<quota-aware-driver>
SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION=<driver-size-option>
SANDBOX_INSTALL_NETWORK=codeer-install-egress
SANDBOX_INSTALL_ALLOWED_REGISTRIES=registry.npmjs.org
SANDBOX_INSTALL_ALLOWED_DOMAINS=registry.npmjs.org
SANDBOX_EXECUTION_TIMEOUT_MS=2700000
SANDBOX_EXECUTION_LEASE_MS=60000
SANDBOX_STALE_AFTER_MS=3600000
SANDBOX_EXECUTION_CONCURRENCY=1
```

Secrets and client certificates must come from the deployment secret manager, not environment files committed to Git.

The stale-resource threshold must be greater than the maximum execution timeout plus its lease window. Configuration validation rejects unsafe combinations.

The restricted installation network must be provisioned by trusted infrastructure with both labels below:

```text
com.codeer.egress-controlled=true
com.codeer.allowed-destinations-sha256=<digest of sorted approved destinations and deny flags>
```

The worker checks both labels before attachment. The labels are an attestation contract, not a firewall; the gateway must still enforce DNS, registry, metadata, private-network and control-plane denial.

## Health indicators

Watch:

- oldest pending outbox message;
- sandbox queue depth and age;
- active executions versus capacity;
- heartbeat age;
- execution phase duration;
- timeouts, OOM kills and policy blocks;
- log/artifact truncation;
- cleanup verification failures;
- resources removed by reconciliation;
- daemon connection errors;
- volume allocation failures;
- restricted-network deny logs.

## Common incidents

### Queue grows but no execution starts

1. Check Redis and outbox dispatcher health.
2. Confirm `sandbox.reproduction.requested` messages are being published.
3. Confirm sandbox worker is subscribed and has concurrency above zero.
4. Check database role and lease errors.
5. Verify remote Docker authentication.
6. Do not manually mark executions complete.

### Execution remains in an active state

1. Compare `heartbeatAt` and `leaseExpiresAt` with current time.
2. Verify worker process and Docker daemon.
3. Run database lease reconciliation.
4. Run provider resource reconciliation.
5. Confirm cleanup proof before retrying.

```bash
npm run sandbox:reconcile
```

### Cleanup failed

Treat as a security-relevant operational incident.

1. Pause new execution admission for the affected fleet.
2. Locate resources by `com.codeer.execution-id` and `com.codeer.managed=true` labels.
3. Capture metadata without copying repository contents into tickets.
4. Force-remove containers.
5. Remove execution volumes only after confirming they are not attached.
6. Re-run absence checks.
7. Append a new cleanup proof; never edit or delete the failed proof.
8. Record the operator action in the incident audit trail.
9. Investigate daemon/storage failure before restoring capacity.

### Remote Docker certificate failure

1. Verify certificate validity and SANs.
2. Confirm client key permissions.
3. Rotate through the secret manager.
4. Keep execution admission paused until mutual authentication succeeds.
5. Never disable TLS verification as a recovery shortcut.

### Installation cannot reach a registry

1. Confirm the request was approved for `RESTRICTED_INSTALL`.
2. Check egress DNS and gateway policy.
3. Confirm the registry/domain is allowlisted.
4. Check registry availability and certificate chain.
5. Do not switch the command to unrestricted bridge or host networking.

### Suspected container escape

1. Disable the execution fleet immediately.
2. Isolate affected nodes at the network layer.
3. Preserve host/runtime telemetry and audit evidence.
4. Rotate worker-to-daemon credentials.
5. Rotate any node-level credentials even though they should not enter sandboxes.
6. Rebuild nodes from trusted images.
7. Conduct tenant impact analysis.
8. Notify affected customers under the security-response policy.

## Reconciliation

Run at least once per configured reconciliation interval:

```bash
SANDBOX_STALE_AFTER_MS=3600000 npm run sandbox:reconcile
```

A healthy result removes nothing during normal operation. Any removed resource must emit an alert and be correlated with an execution record.

## Backup and retention

Sandbox workspace volumes are ephemeral and are not backed up. Durable records are:

- policy snapshots;
- command metadata;
- redacted log chunks;
- artifact manifests;
- reproduction result;
- cleanup proof;
- audit and incident events.

External artifacts, when enabled, must follow tenant retention and legal-hold policy. Deleting an ephemeral workspace must not delete the durable audit record.

## Capacity changes

Before increasing concurrency:

1. load test CPU, memory, PID and disk contention;
2. prove quota enforcement;
3. test daemon and database failure behavior;
4. confirm cleanup under worker termination;
5. verify egress limits;
6. update fleet and tenant quotas;
7. roll out gradually with abort thresholds.

## Rollback

To stop unsafe execution without disabling incident management:

1. set sandbox worker replicas or concurrency to zero;
2. leave API policy evaluation and durable request records available;
3. drain or preserve queue messages;
4. reconcile active resources;
5. deploy the previous worker/provider version;
6. run Docker and persistence smoke tests;
7. restore concurrency gradually.

Never roll back the database by dropping sandbox evidence tables. Forward-fix schemas and preserve audit history.
