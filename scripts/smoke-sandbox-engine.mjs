import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SandboxCommandPhase,
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxResult,
  StartReproductionSchema,
} from '@codeer/contracts';
import { DockerSandboxProvider, SandboxOrchestrator, evaluateSandboxPolicy } from '@codeer/sandbox';

const fixtureRoot = resolve('test/fixtures');
const worktreePath = resolve(fixtureRoot, 'sandbox-broken-repo');
await access(worktreePath);

const image = process.env.SANDBOX_SMOKE_IMAGE ?? 'node:24-bookworm-slim';
const helperImage = process.env.SANDBOX_HELPER_IMAGE ?? image;
const executionId = randomUUID();
const organizationId = randomUUID();
const incidentId = randomUUID();
const reproductionId = randomUUID();

const input = StartReproductionSchema.parse({
  image,
  installCommands: [],
  reproductionCommands: [
    {
      phase: SandboxCommandPhase.REPRODUCE,
      executable: 'node',
      arguments: ['scripts/reproduce-failure.mjs'],
      workingDirectory: '.',
      timeoutMs: 30_000,
      networkMode: SandboxNetworkMode.NONE,
      expectedExitCodes: [17],
      environment: { CI: 'true', NODE_ENV: 'test' },
    },
  ],
  failureSignature: {
    expectedText: 'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
    minimumSimilarity: 0.9,
    requireNonZeroExit: true,
  },
  repeatCount: 2,
  resourceLimits: {
    cpuCores: 0.5,
    memoryBytes: 256 * 1024 * 1024,
    pids: 64,
    workspaceBytes: 128 * 1024 * 1024,
    tempBytes: 32 * 1024 * 1024,
    commandTimeoutMs: 30_000,
    executionTimeoutMs: 120_000,
    maximumCommands: 4,
    maximumLogBytes: 256 * 1024,
    maximumArtifactBytes: 1024 * 1024,
  },
  networkPolicy: {
    mode: SandboxNetworkMode.NONE,
    allowedRegistries: [],
    allowedDomains: [],
    denyPrivateNetworks: true,
    denyMetadataServices: true,
  },
  artifactPaths: ['artifacts/reproduction.json'],
});

const policy = evaluateSandboxPolicy(input, {
  production: false,
  approvedImageRegistries: ['docker.io'],
  defaultImage: image,
  defaultResourceLimits: input.resourceLimits,
});
if (!policy.allowed) throw new Error(`Smoke policy was blocked: ${policy.reasons.join('; ')}`);

const provider = new DockerSandboxProvider({
  helperImage,
  trustedWorkspaceRoot: fixtureRoot,
  dockerHost: process.env.SANDBOX_DOCKER_HOST,
  dockerTlsVerify: process.env.SANDBOX_DOCKER_TLS_VERIFY === 'true',
  dockerCertPath: process.env.SANDBOX_DOCKER_CERT_PATH,
  commandOutputLimitBytes: 1024 * 1024,
  workspaceVolumeDriver: process.env.SANDBOX_WORKSPACE_VOLUME_DRIVER,
  workspaceVolumeSizeOption: process.env.SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION,
});
const orchestrator = new SandboxOrchestrator(provider);
const statuses = [];
const logs = [];
const commands = [];
const artifacts = [];
let cleanup;

const abortController = new AbortController();
const timeout = setTimeout(() => abortController.abort('timeout'), 150_000);
timeout.unref();

try {
  const result = await orchestrator.execute(
    {
      executionId,
      reproductionId,
      organizationId,
      incidentId,
      worktreePath,
      input,
      policy,
    },
    {
      async statusChanged(status) {
        statuses.push(status);
      },
      async commandStarted() {},
      async commandCompleted(command) {
        commands.push(command);
      },
      async logChunks(chunks) {
        logs.push(...chunks);
      },
      async artifactsCollected(items) {
        artifacts.push(...items);
      },
      async cleanupCompleted(value) {
        cleanup = value;
      },
      async cancellationRequested() {
        return false;
      },
      async heartbeat() {},
    },
    abortController.signal,
  );

  if (result.status !== SandboxExecutionStatus.COMPLETED) {
    throw new Error(`Sandbox smoke ended in ${result.status}`);
  }
  if (result.result !== SandboxResult.REPRODUCED) {
    throw new Error(`Expected REPRODUCED, received ${result.result}`);
  }
  if (!result.comparison?.matched || result.confidence < 0.9) {
    throw new Error('Failure-signature comparison did not meet the smoke threshold.');
  }
  if (commands.length !== 2 || commands.some((entry) => entry.exitCode !== 17)) {
    throw new Error('Repeat-run command evidence was not captured correctly.');
  }
  if (artifacts.length !== 1 || !/^[0-9a-f]{64}$/.test(artifacts[0].digest)) {
    throw new Error('Artifact integrity manifest was not produced.');
  }
  if (!cleanup?.verifiedAbsent || result.cleanup.verifiedAbsent !== true) {
    throw new Error('Cleanup proof did not verify resource absence.');
  }
  const logText = logs.map((entry) => entry.content).join('\n');
  if (logText.includes('fixture_token_must_be_redacted') || !logText.includes('[REDACTED]')) {
    throw new Error('Synthetic credential was not redacted from sandbox logs.');
  }
  for (let index = 1; index < logs.length; index += 1) {
    if (logs[index].sequence !== logs[index - 1].sequence + 1) {
      throw new Error('Sandbox logs were not monotonic.');
    }
    if (logs[index].previousHash !== logs[index - 1].chunkHash) {
      throw new Error('Sandbox log hash chain is invalid.');
    }
  }
  if (!statuses.includes(SandboxExecutionStatus.CLEANING)) {
    throw new Error('Sandbox cleanup lifecycle state was not observed.');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      executionId,
      result: result.result,
      confidence: result.confidence,
      commands: commands.length,
      logs: logs.length,
      artifacts: artifacts.length,
      cleanupVerified: result.cleanup.verifiedAbsent,
      environmentFingerprint: result.environmentFingerprint,
    }),
  );
} finally {
  clearTimeout(timeout);
}
