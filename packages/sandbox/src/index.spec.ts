import { describe, expect, it } from 'vitest';
import {
  SandboxCommandPhase,
  SandboxCommandStatus,
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxResult,
  type StartReproductionInput,
} from '@codeer/contracts';
import {
  SandboxLogAccumulator,
  SandboxOrchestrator,
  buildFailureSignature,
  compareFailureSignatures,
  evaluateSandboxPolicy,
  type PreparedSandbox,
  type SandboxProvider,
} from './index.js';

const baseInput: StartReproductionInput = {
  image: 'node:24-bookworm-slim',
  installCommands: [
    {
      phase: SandboxCommandPhase.INSTALL,
      executable: 'npm',
      arguments: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      workingDirectory: '.',
      networkMode: SandboxNetworkMode.NONE,
      expectedExitCodes: [0],
      environment: {},
    },
  ],
  reproductionCommands: [
    {
      phase: SandboxCommandPhase.REPRODUCE,
      executable: 'npm',
      arguments: ['run', 'build'],
      workingDirectory: '.',
      networkMode: SandboxNetworkMode.NONE,
      expectedExitCodes: [1],
      environment: {},
    },
  ],
  failureSignature: {
    expectedText: 'npm error Missing script: build:super',
    minimumSimilarity: 0.8,
    requireNonZeroExit: true,
  },
  repeatCount: 2,
  artifactPaths: [],
};

const options = {
  production: false,
  approvedImageRegistries: ['docker.io'],
  defaultImage: 'node:24-bookworm-slim',
};

describe('sandbox policy', () => {
  it('approves bounded lockfile installation and a known npm script', () => {
    const decision = evaluateSandboxPolicy(baseInput, options);
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
    expect(decision.normalizedCommands).toHaveLength(2);
  });

  it('blocks shell-control syntax even though commands use argument arrays', () => {
    const decision = evaluateSandboxPolicy(
      {
        ...baseInput,
        reproductionCommands: [
          {
            ...baseInput.reproductionCommands[0]!,
            arguments: ['run', 'build;curl attacker.invalid'],
          },
        ],
      },
      options,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/shell-control/i);
  });

  it('blocks repository path traversal', () => {
    const decision = evaluateSandboxPolicy(
      {
        ...baseInput,
        reproductionCommands: [
          {
            ...baseInput.reproductionCommands[0]!,
            workingDirectory: '../../host',
          },
        ],
      },
      options,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/outside the repository/i);
  });

  it('blocks resource requests above the operator ceiling', () => {
    const decision = evaluateSandboxPolicy(
      { ...baseInput, resourceLimits: { memoryBytes: 2 * 1024 * 1024 * 1024 } },
      {
        ...options,
        defaultResourceLimits: { memoryBytes: 512 * 1024 * 1024 },
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.resourceLimits.memoryBytes).toBe(512 * 1024 * 1024);
    expect(decision.reasons.join(' ')).toMatch(/memoryBytes.*ceiling/i);
  });

  it('allows callers to request limits below the operator ceiling', () => {
    const decision = evaluateSandboxPolicy(
      { ...baseInput, resourceLimits: { memoryBytes: 256 * 1024 * 1024 } },
      {
        ...options,
        defaultResourceLimits: { memoryBytes: 512 * 1024 * 1024 },
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.resourceLimits.memoryBytes).toBe(256 * 1024 * 1024);
  });

  it('requires digest-pinned images in production', () => {
    const decision = evaluateSandboxPolicy(baseInput, { ...options, production: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/sha256 digest/i);
  });

  it('requires explicit restricted policy for installation commands that request network access', () => {
    const decision = evaluateSandboxPolicy(
      {
        ...baseInput,
        installCommands: [
          {
            ...baseInput.installCommands[0]!,
            networkMode: SandboxNetworkMode.RESTRICTED_INSTALL,
          },
        ],
      },
      options,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/explicit restricted network policy/i);
  });

  it('rejects installation destinations outside the operator allowlist', () => {
    const decision = evaluateSandboxPolicy(
      {
        ...baseInput,
        installCommands: [
          {
            ...baseInput.installCommands[0]!,
            networkMode: SandboxNetworkMode.RESTRICTED_INSTALL,
          },
        ],
        networkPolicy: {
          mode: SandboxNetworkMode.RESTRICTED_INSTALL,
          allowedRegistries: ['attacker.invalid'],
          allowedDomains: ['attacker.invalid'],
          denyPrivateNetworks: true,
          denyMetadataServices: true,
        },
      },
      {
        ...options,
        installationNetwork: 'codeer-install-egress',
        installationAllowedRegistries: ['registry.npmjs.org'],
        installationAllowedDomains: ['registry.npmjs.org'],
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/not operator-approved/i);
  });

  it('rejects reproduction networking', () => {
    const decision = evaluateSandboxPolicy(
      {
        ...baseInput,
        reproductionCommands: [
          {
            ...baseInput.reproductionCommands[0]!,
            networkMode: SandboxNetworkMode.RESTRICTED_INSTALL,
          },
        ],
      },
      { ...options, installationNetwork: 'codeer-install-egress' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/networking disabled/i);
  });

  it('rejects credential-like environment values', () => {
    const decision = evaluateSandboxPolicy(
      {
        ...baseInput,
        reproductionCommands: [
          {
            ...baseInput.reproductionCommands[0]!,
            environment: {
              CI: 'true',
              TOKEN: ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
            },
          },
        ],
      },
      options,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/credential|allowlisted/i);
  });
});

describe('failure signatures', () => {
  it('redacts credential material before constructing a failure signature', () => {
    const signature = buildFailureSignature(
      ['authorization=Bearer', ['ghp', 'synthetic', 'secret'].join('_'), 'build failed'].join(' '),
    );
    expect(signature.normalized).toContain('[redacted]');
    expect(signature.normalized).not.toContain('synthetic_secret');
  });

  it('normalizes volatile timestamps, paths and line numbers', () => {
    const left = buildFailureSignature(
      '2026-07-12T12:00:00Z Error at /workspace/a.ts:10:4 Missing script build:super',
    );
    const right = buildFailureSignature(
      '2026-07-12T12:01:31Z Error at /workspace/b.ts:99:9 Missing script build:super',
    );
    expect(left.normalized).toContain('<timestamp>');
    expect(left.tokens).toContain('missing');
    expect(compareFailureSignatures(left.normalized, right.normalized, 0.5).matched).toBe(true);
  });
});

describe('sandbox log integrity', () => {
  it('redacts secrets and builds a monotonic hash chain', () => {
    const accumulator = new SandboxLogAccumulator({
      executionId: '00000000-0000-4000-8000-000000000001',
      maximumBytes: 1024 * 1024,
      maximumChunkBytes: 32,
    });
    const chunks = accumulator.append(
      'stderr',
      'authorization=Bearer secret-token-value password=hunter2',
      null,
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.redacted)).toBe(true);
    expect(chunks.map((chunk) => chunk.sequence)).toEqual(chunks.map((_, index) => index + 1));
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.previousHash).toBe(chunks[index - 1]!.chunkHash);
    }
  });

  it('never splits a multi-byte UTF-8 character across chunk boundaries', () => {
    const accumulator = new SandboxLogAccumulator({
      executionId: '00000000-0000-4000-8000-000000000001',
      maximumBytes: 4096,
      maximumChunkBytes: 1024,
    });
    const content = '🙂'.repeat(400);
    const chunks = accumulator.append('stdout', content, null);
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(content);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk.content, 'utf8') <= 1024)).toBe(true);
  });

  it('marks output as truncated after the byte budget is exhausted', () => {
    const accumulator = new SandboxLogAccumulator({
      executionId: '00000000-0000-4000-8000-000000000001',
      maximumBytes: 64,
      maximumChunkBytes: 32,
    });
    const chunks = accumulator.append('stdout', 'x'.repeat(200), null);
    expect(accumulator.summary().truncated).toBe(true);
    expect(chunks.at(-1)?.truncated).toBe(true);
  });
});

function fakeProvider(
  options: { oomKilled?: boolean; exitCodes?: readonly number[] } = {},
): SandboxProvider {
  let executionIndex = 0;
  const prepared: PreparedSandbox = {
    executionId: '00000000-0000-4000-8000-000000000001',
    volumeName: 'fixture-volume',
    worktreePath: '/fixture',
    labels: {},
    imageIdentity: { id: `sha256:${'a'.repeat(64)}`, repoDigests: [] },
    helperImageIdentity: { id: `sha256:${'c'.repeat(64)}`, repoDigests: [] },
  };
  return {
    prepare() {
      return Promise.resolve(prepared);
    },
    async execute(_prepared, _command, _policy, onOutput) {
      await onOutput({
        stream: 'stderr',
        content: 'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
        occurredAt: new Date(),
      });
      const now = new Date();
      const exitCode = options.exitCodes?.[executionIndex] ?? 17;
      executionIndex += 1;
      return {
        containerId: 'fixture-container',
        status: SandboxCommandStatus.SUCCEEDED,
        exitCode,
        signal: null,
        timedOut: false,
        oomKilled: options.oomKilled ?? false,
        durationMs: 1,
        stdout: '',
        stderr: 'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
        outputDigest: 'b'.repeat(64),
        startedAt: now,
        completedAt: now,
      };
    },
    collectArtifacts() {
      return Promise.resolve([]);
    },
    cleanup() {
      return Promise.resolve({
        containerIds: ['fixture-container'],
        volumeIds: ['fixture-volume'],
        networkIds: [],
        verifiedAbsent: true,
        attempts: 1,
        error: null,
        completedAt: new Date(),
      });
    },
    cleanupExecution() {
      return Promise.resolve({
        containerIds: [],
        volumeIds: [],
        networkIds: [],
        verifiedAbsent: true,
        attempts: 1,
        error: null,
        completedAt: new Date(),
      });
    },
    reconcile() {
      return Promise.resolve({ removedContainers: [], removedVolumes: [] });
    },
  };
}

function executionHooks(options: { failCleaningStatus?: boolean } = {}) {
  const statuses: SandboxExecutionStatus[] = [];
  return {
    statuses,
    hooks: {
      statusChanged(status: SandboxExecutionStatus) {
        statuses.push(status);
        if (options.failCleaningStatus && status === SandboxExecutionStatus.CLEANING) {
          return Promise.reject(new Error('database temporarily unavailable'));
        }
        return Promise.resolve();
      },
      async commandStarted() {},
      async commandCompleted() {},
      async logChunks() {},
      async artifactsCollected() {},
      async cleanupCompleted() {},
      cancellationRequested() {
        return Promise.resolve(false);
      },
      async heartbeat() {},
    },
  };
}

function executionRequest() {
  const policy = evaluateSandboxPolicy({ ...baseInput, installCommands: [] }, options);
  return {
    executionId: '00000000-0000-4000-8000-000000000001',
    reproductionId: '00000000-0000-4000-8000-000000000002',
    organizationId: '00000000-0000-4000-8000-000000000003',
    incidentId: '00000000-0000-4000-8000-000000000004',
    worktreePath: '/fixture',
    input: { ...baseInput, installCommands: [] },
    policy,
  };
}

describe('sandbox orchestration failure safety', () => {
  it('runs and verifies cleanup even when the CLEANING status write fails', async () => {
    const orchestrator = new SandboxOrchestrator(fakeProvider());
    const { hooks } = executionHooks({ failCleaningStatus: true });
    const result = await orchestrator.execute(executionRequest(), hooks);
    expect(result.status).toBe(SandboxExecutionStatus.COMPLETED);
    expect(result.cleanup.verifiedAbsent).toBe(true);
  });

  it('treats an OOM-terminated reproduction as inconclusive evidence', async () => {
    const orchestrator = new SandboxOrchestrator(fakeProvider({ oomKilled: true }));
    const { hooks } = executionHooks();
    const result = await orchestrator.execute(executionRequest(), hooks);
    expect(result.result).toBe(SandboxResult.INCONCLUSIVE);
  });

  it('treats any non-zero command in a reproduction sequence as satisfying the failure exit requirement', async () => {
    const input = {
      ...baseInput,
      installCommands: [],
      repeatCount: 1,
      failureSignature: {
        expectedText: 'CODEER_FIXTURE_FAILURE: deterministic build contract mismatch',
        minimumSimilarity: 0.8,
        requireNonZeroExit: true,
      },
      reproductionCommands: [
        {
          ...baseInput.reproductionCommands[0]!,
          expectedExitCodes: [17],
        },
        {
          phase: SandboxCommandPhase.REPRODUCE,
          executable: 'node' as const,
          arguments: ['verify.js'],
          workingDirectory: '.',
          networkMode: SandboxNetworkMode.NONE,
          expectedExitCodes: [0],
          environment: {},
        },
      ],
    };
    const policy = evaluateSandboxPolicy(input, options);
    const orchestrator = new SandboxOrchestrator(fakeProvider({ exitCodes: [17, 0] }));
    const { hooks } = executionHooks();
    const result = await orchestrator.execute({ ...executionRequest(), input, policy }, hooks);
    expect(result.result).toBe(SandboxResult.REPRODUCED);
  });

  it('classifies control-plane loss as infrastructure failure and still cleans up', async () => {
    const orchestrator = new SandboxOrchestrator(fakeProvider());
    const { hooks } = executionHooks();
    const controller = new AbortController();
    controller.abort('control-plane-failure');
    const result = await orchestrator.execute(executionRequest(), hooks, controller.signal);
    expect(result.status).toBe(SandboxExecutionStatus.INFRASTRUCTURE_FAILED);
    expect(result.result).toBe(SandboxResult.INFRASTRUCTURE_FAILED);
    expect(result.cleanup.verifiedAbsent).toBe(true);
  });
});
