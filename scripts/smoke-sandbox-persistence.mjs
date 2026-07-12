import { randomUUID } from 'node:crypto';
import {
  ActorRole,
  ActorType,
  SandboxArtifactRetention,
  SandboxArtifactSchema,
  SandboxCleanupProofSchema,
  SandboxCommandPhase,
  SandboxCommandResultSchema,
  SandboxCommandStatus,
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxResult,
  StartReproductionSchema,
} from '@codeer/contracts';
import {
  createDatabasePool,
  IncidentStore,
  SandboxStore,
  TenantResourceNotFoundError,
  withTransaction,
} from '@codeer/database';
import {
  SandboxLogAccumulator,
  compareFailureSignatures,
  evaluateSandboxPolicy,
} from '@codeer/sandbox';
import { sha256Hex } from '@codeer/security';

const appUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_WORKER_URL;
if (!appUrl || !workerUrl) {
  throw new Error('DATABASE_URL and DATABASE_WORKER_URL are required.');
}

const appPool = createDatabasePool(appUrl, { max: 4, application_name: 'sandbox-persistence-api' });
const workerPool = createDatabasePool(workerUrl, {
  max: 4,
  application_name: 'sandbox-persistence-worker',
});
const incidentStore = new IncidentStore(appPool);
const appSandboxStore = new SandboxStore(appPool);
const workerSandboxStore = new SandboxStore(workerPool);

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const repositoryId = randomUUID();
const intakeId = randomUUID();
const worktreeId = randomUUID();
const context = {
  organizationId,
  actorId: 'ci-sandbox-persistence',
  actorType: ActorType.SERVICE,
  actorRoles: [ActorRole.SERVICE],
  requestId: `request-${randomUUID()}`,
  correlationId: `correlation-${randomUUID()}`,
};

const input = StartReproductionSchema.parse({
  worktreeId,
  image: 'node:24-bookworm-slim',
  installCommands: [],
  reproductionCommands: [
    {
      phase: SandboxCommandPhase.REPRODUCE,
      executable: 'node',
      arguments: ['scripts/reproduce-failure.mjs'],
      workingDirectory: '.',
      networkMode: SandboxNetworkMode.NONE,
      expectedExitCodes: [17],
      environment: { CI: 'true' },
    },
  ],
  failureSignature: {
    expectedText: 'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
    minimumSimilarity: 0.9,
    requireNonZeroExit: true,
  },
  repeatCount: 2,
  artifactPaths: ['artifacts/reproduction.json'],
});
const policy = evaluateSandboxPolicy(input, {
  production: false,
  approvedImageRegistries: ['docker.io'],
  defaultImage: input.image,
});
if (!policy.allowed)
  throw new Error(`Persistence smoke policy blocked: ${policy.reasons.join('; ')}`);

try {
  await withTransaction(
    async (client) => {
      await client.query(
        `INSERT INTO "Organization" ("id","slug","name","createdAt","updatedAt")
         VALUES ($1,$2,$3,NOW(),NOW())`,
        [organizationId, `sandbox-${organizationId.slice(0, 8)}`, 'Sandbox Persistence Smoke'],
      );
      await client.query(
        `INSERT INTO "Repository" (
           "id","organizationId","provider","providerRepoId","owner","name","fullName",
           "visibility","defaultBranch","cloneUrl","htmlUrl","createdAt","updatedAt"
         ) VALUES ($1,$2,'GITHUB',$3,'codeer-ci','sandbox-fixture','codeer-ci/sandbox-fixture',
           'PRIVATE','main','https://github.com/codeer-ci/sandbox-fixture.git',
           'https://github.com/codeer-ci/sandbox-fixture',NOW(),NOW())`,
        [repositoryId, organizationId, randomUUID()],
      );
      await client.query(
        `INSERT INTO "RepositoryIntake" (
           "id","organizationId","repositoryId","requestedBy","requestedUrl","selectedBaseBranch",
           "status","progress","requestId","requestedAt","completedAt","updatedAt"
         ) VALUES ($1,$2,$3,$4,'https://github.com/codeer-ci/sandbox-fixture','main',
           'READY',100,$5,NOW(),NOW(),NOW())`,
        [intakeId, organizationId, repositoryId, context.actorId, context.requestId],
      );
      await client.query(
        `INSERT INTO "RepositoryWorktree" (
           "id","repositoryId","intakeId","branchName","baseBranch","baseSha","relativePath","status","createdAt"
         ) VALUES ($1,$2,$3,'codeer/recovery/smoke','main',$4,$5,'ACTIVE',NOW())`,
        [worktreeId, repositoryId, intakeId, 'a'.repeat(40), 'sandbox-fixture'],
      );
    },
    { tenantOrganizationId: organizationId },
    appPool,
  );

  const incident = await incidentStore.createIncident({
    context,
    input: {
      repositoryId,
      title: 'Deterministic sandbox fixture failure',
      description: 'Persistence smoke for the hardened sandbox execution lifecycle.',
      source: 'MANUAL',
      labels: ['ci-smoke', 'sandbox'],
      impact: {
        availability: 1,
        affectedUsers: 1,
        revenueImpact: 0,
        dataIntegrity: 0,
        securityImpact: 0,
        environment: 'test',
      },
      signals: {
        errorMessage: 'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
        failingCommand: 'node scripts/reproduce-failure.mjs',
        deploymentBlocked: false,
        failingTests: true,
        securityExposure: false,
        dataIntegrityRisk: false,
        productionUnavailable: false,
        authenticationBroken: false,
        dependencyIssue: false,
        apiContractMismatch: true,
        frontendFunctionalityFailure: false,
        workaroundAvailable: true,
        recurrenceCount: 2,
      },
    },
    idempotencyKey: `incident-${randomUUID()}`,
    idempotencyTtlSeconds: 3600,
    organizationDefaults: {
      id: organizationId,
      slug: `sandbox-${organizationId.slice(0, 8)}`,
      name: 'Sandbox Persistence Smoke',
    },
  });

  const idempotencyKey = `reproduction-${randomUUID()}`;
  const createCommand = {
    context,
    incidentId: incident.id,
    input,
    policy,
    idempotencyKey,
    idempotencyTtlSeconds: 3600,
  };
  const created = await appSandboxStore.createReproduction(createCommand);
  const replayed = await appSandboxStore.createReproduction(createCommand);
  if (created.id !== replayed.id || created.executionId !== replayed.executionId) {
    throw new Error('Sandbox reproduction idempotency failed.');
  }

  const unscoped = await appPool.query(
    `SELECT COUNT(*)::int AS count FROM "FailureReproduction" WHERE "id"=$1`,
    [created.id],
  );
  if (unscoped.rows[0]?.count !== 0) {
    throw new Error('Forced row-level security leaked a reproduction without tenant context.');
  }

  let crossTenantBlocked = false;
  try {
    await appSandboxStore.getReproduction(otherOrganizationId, created.id);
  } catch (error) {
    crossTenantBlocked = error instanceof TenantResourceNotFoundError;
  }
  if (!crossTenantBlocked) throw new Error('Cross-tenant reproduction lookup was not blocked.');

  const job = {
    executionId: created.executionId,
    reproductionId: created.id,
    incidentId: incident.id,
    organizationId,
    requestedBy: context.actorId,
    requestId: context.requestId,
    correlationId: context.correlationId,
    requestedAt: new Date().toISOString(),
    attempt: 1,
  };
  const envelope = await workerSandboxStore.claimExecution(job, 'ci-worker', 60_000);
  if (!envelope || envelope.reproductionId !== created.id) {
    throw new Error('Worker could not acquire the sandbox execution lease.');
  }
  const duplicateClaim = await workerSandboxStore.claimExecution(job, 'ci-worker', 60_000);
  if (duplicateClaim !== null) {
    throw new Error('A duplicate queue delivery acquired an already-active execution lease.');
  }
  await workerSandboxStore.heartbeat(organizationId, created.executionId, 'ci-worker', 60_000);

  const commandId = randomUUID();
  const command = input.reproductionCommands[0];
  await workerSandboxStore.commandStarted(
    organizationId,
    created.executionId,
    commandId,
    1,
    command,
    'ci-worker',
  );
  const completedCommand = SandboxCommandResultSchema.parse({
    id: commandId,
    sequence: 1,
    phase: command.phase,
    executable: command.executable,
    arguments: command.arguments,
    workingDirectory: command.workingDirectory,
    status: SandboxCommandStatus.SUCCEEDED,
    exitCode: 17,
    signal: null,
    durationMs: 25,
    timedOut: false,
    oomKilled: false,
    outputDigest: sha256Hex('CODEER_FIXTURE_FAILURE'),
    startedAt: new Date(Date.now() - 25).toISOString(),
    completedAt: new Date().toISOString(),
  });
  await workerSandboxStore.commandCompleted(
    organizationId,
    created.executionId,
    completedCommand,
    'ci-worker',
  );

  const accumulator = new SandboxLogAccumulator({
    executionId: created.executionId,
    maximumBytes: 64 * 1024,
  });
  const chunks = accumulator.append(
    'stderr',
    'authorization=Bearer fixture_token_must_be_redacted CODEER_FIXTURE_FAILURE',
    commandId,
  );
  await workerSandboxStore.appendLogChunks(
    organizationId,
    created.executionId,
    chunks,
    'ci-worker',
  );
  const artifact = SandboxArtifactSchema.parse({
    id: randomUUID(),
    executionId: created.executionId,
    path: 'artifacts/reproduction.json',
    mediaType: 'application/json',
    byteSize: 42,
    digest: sha256Hex('{"reproduced":true}'),
    retention: SandboxArtifactRetention.INCIDENT,
    storageReference: null,
    createdAt: new Date().toISOString(),
  });
  await workerSandboxStore.recordArtifacts(
    organizationId,
    incident.id,
    created.executionId,
    [artifact],
    'ci-worker',
  );
  const failedCleanup = SandboxCleanupProofSchema.parse({
    executionId: created.executionId,
    containerIds: ['fixture-container'],
    volumeIds: ['fixture-volume'],
    networkIds: [],
    verifiedAbsent: false,
    attempts: 1,
    digest: sha256Hex('fixture cleanup proof failed'),
    error: 'Synthetic first cleanup proof could not verify absence.',
    completedAt: new Date(Date.now() - 1000).toISOString(),
  });
  await workerSandboxStore.recordCleanup(organizationId, failedCleanup, 'ci-worker');

  const cleanup = SandboxCleanupProofSchema.parse({
    executionId: created.executionId,
    containerIds: ['fixture-container'],
    volumeIds: ['fixture-volume'],
    networkIds: [],
    verifiedAbsent: true,
    attempts: 1,
    digest: sha256Hex('fixture cleanup proof'),
    error: null,
    completedAt: new Date().toISOString(),
  });
  await workerSandboxStore.recordCleanup(organizationId, cleanup, 'ci-worker');
  const comparison = compareFailureSignatures(
    input.failureSignature.expectedText,
    'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
    input.failureSignature.minimumSimilarity,
  );
  await workerSandboxStore.completeExecution(
    organizationId,
    created.executionId,
    {
      status: SandboxExecutionStatus.COMPLETED,
      result: SandboxResult.REPRODUCED,
      comparison,
      environmentFingerprint: sha256Hex('ci-environment'),
      confidence: 1,
      cleanup,
    },
    'ci-worker',
  );

  let staleWriterBlocked = false;
  try {
    await workerSandboxStore.updateStatus(
      organizationId,
      created.executionId,
      SandboxExecutionStatus.COLLECTING,
      {},
      'ci-worker',
    );
  } catch (error) {
    staleWriterBlocked = /lease was lost/i.test(error instanceof Error ? error.message : '');
  }
  if (!staleWriterBlocked) {
    throw new Error('A worker wrote after terminal completion cleared its execution lease.');
  }

  const detail = await appSandboxStore.getReproduction(organizationId, created.id);
  const logs = await appSandboxStore.listLogs(organizationId, created.id, { limit: 100 });
  const artifacts = await appSandboxStore.listArtifacts(organizationId, created.id);
  if (detail.result !== SandboxResult.REPRODUCED || detail.cleanup?.verifiedAbsent !== true) {
    throw new Error('Completed reproduction result or cleanup proof was not persisted.');
  }
  if (
    logs.items.length === 0 ||
    logs.items.some((entry) => entry.content.includes('fixture_token'))
  ) {
    throw new Error('Redacted log persistence failed.');
  }
  if (artifacts.length !== 1 || artifacts[0].digest !== artifact.digest) {
    throw new Error('Artifact manifest persistence failed.');
  }
  let cleanupProofCount = 0;
  await withTransaction(
    async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM "SandboxCleanupRecord" WHERE "executionId"=$1`,
        [created.executionId],
      );
      cleanupProofCount = result.rows[0]?.count ?? 0;
    },
    { tenantOrganizationId: organizationId },
    workerPool,
  );
  if (cleanupProofCount !== 2) {
    throw new Error('Immutable cleanup correction history was not retained.');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      reproductionId: created.id,
      executionId: created.executionId,
      idempotency: true,
      tenantIsolation: true,
      leaseAcquired: true,
      duplicateClaimBlocked: true,
      staleWriterBlocked: true,
      logs: logs.items.length,
      artifacts: artifacts.length,
      cleanupVerified: detail.cleanup.verifiedAbsent,
      cleanupProofs: cleanupProofCount,
      result: detail.result,
    }),
  );
} finally {
  await Promise.all([appPool.end(), workerPool.end()]);
}
