# Incident Engine Operations Runbook

## Purpose

Operational procedures for deploying, observing, recovering and safely replaying the Sprint 3 incident engine.

## Dependencies

- PostgreSQL 17-compatible service;
- Redis 8-compatible service;
- CodeER API;
- CodeER worker;
- CodeER web BFF;
- managed secret source for API and context-signing secrets.

## Deployment order

1. take or verify a recoverable database backup;
2. apply the reviewed database migration with a migration-only identity;
3. validate tables, indexes, triggers and RLS policies;
4. deploy workers with concurrency set to zero or keep them stopped;
5. deploy API and run readiness checks;
6. deploy web BFF;
7. enable outbox dispatcher and triage workers;
8. create a synthetic incident and verify the complete timeline;
9. monitor error rate, dispatch lag and dead-letter count.

## Required production configuration

```env
NODE_ENV=production
API_AUTH_MODE=api-key
API_REQUIRE_TENANT_CONTEXT=true
API_REQUIRE_SIGNED_CONTEXT=true
REQUIRE_IDEMPOTENCY_KEYS=true
CODEER_API_KEY=<secret>
REQUEST_CONTEXT_SIGNING_SECRET=<different-secret>
CODEER_CONTEXT_SIGNING_SECRET=<same-context-secret-on-bff>
DATABASE_URL=<tls-postgresql-url>
REDIS_URL=<tls-redis-url>
```

API and context-signing secrets must be different and rotated independently.

## Database role separation

Use separate database credentials for schema administration and runtime traffic.

- `DATABASE_ADMIN_URL` is restricted to migration and role-provisioning jobs.
- `DATABASE_URL` belongs to a non-superuser runtime role with `NOBYPASSRLS`.
- `DATABASE_RUNTIME_USER` and `DATABASE_RUNTIME_PASSWORD` are consumed only by the provisioning job.
- API and worker containers must never receive the administrative database credential.

After every schema deployment, run `npm run db:provision:runtime` to grant the runtime role access to newly created tables, sequences and functions. Rotate the runtime password through the platform secret manager and restart dependent services without exposing it in logs.

## Readiness checks

- `GET /api/v1/health` proves process liveness.
- `GET /api/v1/health/ready` checks database connectivity.
- queue readiness must be monitored independently through worker metrics and a synthetic message.

A pod or instance must not receive normal traffic until readiness succeeds.

## Key signals

Minimum operational dashboards:

- incident create rate and latency by organization;
- 4xx and 5xx rates;
- authorization denials;
- optimistic-concurrency conflicts;
- database pool usage and wait time;
- transaction retries by SQLSTATE;
- outbox pending count and oldest age;
- outbox processing lease age;
- dead-letter count;
- triage queue depth, active jobs, failures and duration;
- evidence redaction count;
- timeline integrity failures;
- repository-health score distribution.

## Outbox investigation

### Pending backlog

1. verify Redis connectivity;
2. verify the dispatcher loop is running;
3. inspect oldest `availableAt` and `createdAt` values;
4. inspect database lock waits;
5. verify `OUTBOX_BATCH_SIZE` and poll interval;
6. scale dispatcher instances carefully—claiming uses `SKIP LOCKED` and supports concurrency.

### Processing rows older than lease

They are reclaimable after `OUTBOX_LOCK_TIMEOUT_MS`. Do not manually update them unless the dispatcher is stopped and the action is documented.

### Dead-letter message

1. capture message ID, topic, incident ID and safe error code;
2. determine whether the error is permanent or configuration-related;
3. correct the cause;
4. create a new outbox row with a new deduplication key or use an approved replay utility;
5. never reset attempts in place without an audit record.

## Triage failure

1. inspect the BullMQ job using the incident and request IDs;
2. inspect safe worker logs;
3. confirm the incident remains non-terminal;
4. verify PostgreSQL transaction rollback left no partial triage result;
5. after remediation, call the triage endpoint with `force=true` using the latest incident version context;
6. confirm a new `TRIAGE_REQUESTED` event and outbox key were created.

## Timeline integrity failure

Treat as a security incident.

1. stop recovery actions for the affected incident;
2. preserve database, audit, application and infrastructure logs;
3. compare event rows with backup and external chain-head anchors;
4. identify whether the mismatch is sequence, previous hash or payload hash;
5. do not rewrite the event chain;
6. open a CodeER internal SEV-1 security incident;
7. notify the affected organization under the contractual process.

## Cross-tenant access alert

1. immediately disable affected API credentials;
2. stop API traffic if exposure is ongoing;
3. preserve signed request context and audit records;
4. verify RLS policies are enabled and forced;
5. determine affected rows and tenants;
6. activate legal and customer-notification procedures;
7. fix through a reviewed migration or application patch;
8. add a regression test before restoring access.

## Backup and restore

Back up:

- PostgreSQL with point-in-time recovery;
- Redis only as operational convenience, not authoritative data;
- encrypted evidence object storage when introduced;
- KMS key metadata and recovery procedures;
- deployment configuration and migration history.

Quarterly restore drill:

1. restore into an isolated account/network;
2. validate schema and migration version;
3. verify RLS policies;
4. sample incident and audit hash chains;
5. run the incident integration smoke journey;
6. record RPO, RTO and discrepancies.

## Capacity guidance

Scale API separately from workers. Increase worker concurrency only after observing database transaction latency and lock contention. Keep a bounded database pool per process; total connections across all replicas must remain below the managed database limit with operational headroom.

When timeline volume becomes material, partition `IncidentEvent` and `AuditLog` by month and retain global uniqueness/index requirements through partition-aware design.

## Safe rollback

Application rollback is allowed when the previous version remains schema-compatible. Database migrations are forward-only by default. A destructive down migration is not acceptable during an incident. Use a reviewed compensating migration after backup and impact analysis.
