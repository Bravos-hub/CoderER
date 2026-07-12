import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, posix as path, sep } from 'node:path';
import {
  SandboxArtifactRetention,
  SandboxArtifactSchema,
  SandboxCommandStatus,
  SandboxNetworkMode,
  type SandboxArtifact,
  type SandboxCommandRequest,
  type SandboxPolicyDecision,
} from '@codeer/contracts';
import { redactSecretsFromText, sha256Hex } from '@codeer/security';

export interface PreparedSandbox {
  executionId: string;
  volumeName: string;
  worktreePath: string;
  labels: Record<string, string>;
  imageIdentity: {
    id: string;
    repoDigests: string[];
  };
  helperImageIdentity: {
    id: string;
    repoDigests: string[];
  };
}

export interface SandboxOutputEvent {
  stream: 'stdout' | 'stderr' | 'system';
  content: string;
  occurredAt: Date;
}

export interface SandboxCommandOutcome {
  containerId: string;
  status: SandboxCommandStatus;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  oomKilled: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputDigest: string;
  startedAt: Date;
  completedAt: Date;
}

export interface SandboxCleanupOutcome {
  containerIds: string[];
  volumeIds: string[];
  networkIds: string[];
  verifiedAbsent: boolean;
  attempts: number;
  error: string | null;
  completedAt: Date;
}

export interface SandboxProvider {
  prepare(input: {
    executionId: string;
    organizationId: string;
    incidentId: string;
    worktreePath: string;
    policy: SandboxPolicyDecision;
  }): Promise<PreparedSandbox>;
  execute(
    prepared: PreparedSandbox,
    command: SandboxCommandRequest,
    policy: SandboxPolicyDecision,
    onOutput: (event: SandboxOutputEvent) => Promise<void> | void,
    abortSignal?: AbortSignal,
  ): Promise<SandboxCommandOutcome>;
  collectArtifacts(
    prepared: PreparedSandbox,
    paths: readonly string[],
    maximumTotalBytes: number,
  ): Promise<SandboxArtifact[]>;
  cleanup(prepared: PreparedSandbox): Promise<SandboxCleanupOutcome>;
  cleanupExecution(executionId: string): Promise<SandboxCleanupOutcome>;
  reconcile(staleBefore: Date): Promise<{ removedContainers: string[]; removedVolumes: string[] }>;
}

export interface DockerSandboxProviderOptions {
  dockerBinary?: string;
  dockerHost?: string | undefined;
  dockerTlsVerify?: boolean | undefined;
  dockerCertPath?: string | undefined;
  helperImage: string;
  trustedWorkspaceRoot: string;
  commandOutputLimitBytes?: number;
  workspaceVolumeDriver?: string | undefined;
  workspaceVolumeSizeOption?: string | undefined;
}

interface ProcessResult {
  code: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function safeDockerName(prefix: string, value: string): string {
  return `${prefix}-${value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .slice(0, 48)}`;
}

function validateArtifactPath(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value)) {
    throw new Error(`Artifact path is not repository-relative: ${value}`);
  }
  const normalized = path.normalize(value).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Artifact path escapes the workspace: ${value}`);
  }
  return normalized;
}

const MAX_SOURCE_TREE_ENTRIES = 200_000;

async function measureSourceTree(root: string): Promise<{ bytes: number; entries: number }> {
  const pending = [root];
  let bytes = 0;
  let entries = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const metadata = await lstat(current);
    entries += 1;
    if (entries > MAX_SOURCE_TREE_ENTRIES) {
      throw new SandboxPolicyViolationError(
        `Repository workspace exceeds the ${MAX_SOURCE_TREE_ENTRIES}-entry transfer limit.`,
      );
    }
    if (metadata.isDirectory()) {
      const children = await readdir(current);
      for (const child of children) pending.push(`${current}${sep}${child}`);
      continue;
    }
    if (metadata.isFile() || metadata.isSymbolicLink()) {
      bytes += metadata.size;
      if (!Number.isSafeInteger(bytes)) {
        throw new SandboxPolicyViolationError('Repository workspace size exceeded safe limits.');
      }
      continue;
    }
    throw new SandboxPolicyViolationError(
      'Repository workspace contains an unsupported special filesystem entry.',
    );
  }

  return { bytes, entries };
}

async function confinedRealPath(root: string, candidate: string): Promise<string> {
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${sep}`)) {
    throw new Error('Worktree path is outside the configured repository workspace root.');
  }
  return realCandidate;
}

export class SandboxPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxPolicyViolationError';
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  private readonly docker: string;
  private readonly outputLimit: number;
  private readonly dockerEnvironment: NodeJS.ProcessEnv;

  constructor(private readonly options: DockerSandboxProviderOptions) {
    this.docker = options.dockerBinary ?? 'docker';
    this.outputLimit = Math.max(64 * 1024, options.commandOutputLimitBytes ?? 16 * 1024 * 1024);
    this.dockerEnvironment = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      ...(options.dockerHost ? { DOCKER_HOST: options.dockerHost } : {}),
      ...(options.dockerTlsVerify ? { DOCKER_TLS_VERIFY: '1' } : {}),
      ...(options.dockerCertPath ? { DOCKER_CERT_PATH: options.dockerCertPath } : {}),
    };
  }

  async prepare(input: {
    executionId: string;
    organizationId: string;
    incidentId: string;
    worktreePath: string;
    policy: SandboxPolicyDecision;
  }): Promise<PreparedSandbox> {
    const worktreePath = await confinedRealPath(
      this.options.trustedWorkspaceRoot,
      input.worktreePath,
    );
    const pathWithoutWindowsDrive = /^[a-zA-Z]:[\\/]/.test(worktreePath)
      ? worktreePath.slice(2)
      : worktreePath;
    if (pathWithoutWindowsDrive.includes(':') || /[\r\n]/.test(worktreePath)) {
      throw new Error(
        'Configured repository workspace paths must not contain colons or line breaks.',
      );
    }
    const inspectImage = async (image: string, purpose: string) => {
      const inspection = await this.runDocker(
        ['image', 'inspect', '--format', '{{.Id}}|{{join .RepoDigests ","}}', image],
        30_000,
      );
      const [id = '', repoDigestText = ''] = inspection.stdout.trim().split('|', 2);
      if (!/^sha256:[0-9a-f]{64}$/i.test(id)) {
        throw new Error(`${purpose} image identity could not be verified before execution.`);
      }
      return {
        id: id.toLowerCase(),
        repoDigests: repoDigestText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .sort(),
      };
    };
    const [imageIdentity, helperImageIdentity] = await Promise.all([
      inspectImage(input.policy.image, 'Sandbox'),
      inspectImage(this.options.helperImage, 'Sandbox helper'),
    ]);
    const sourceTree = await measureSourceTree(worktreePath);
    if (sourceTree.bytes > input.policy.resourceLimits.workspaceBytes) {
      throw new SandboxPolicyViolationError(
        `Repository workspace exceeds the approved ${input.policy.resourceLimits.workspaceBytes}-byte limit.`,
      );
    }

    const volumeName = safeDockerName('codeer-workspace', input.executionId);
    const labels = {
      'com.codeer.managed': 'true',
      'com.codeer.execution-id': input.executionId,
      'com.codeer.organization-id': input.organizationId,
      'com.codeer.incident-id': input.incidentId,
      'com.codeer.created-at': new Date().toISOString(),
    };
    const volumeArguments = [
      'volume',
      'create',
      ...(this.options.workspaceVolumeDriver
        ? ['--driver', this.options.workspaceVolumeDriver]
        : []),
      ...(this.options.workspaceVolumeSizeOption
        ? [
            '--opt',
            `${this.options.workspaceVolumeSizeOption}=${input.policy.resourceLimits.workspaceBytes}`,
          ]
        : []),
      ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
      volumeName,
    ];
    await this.runDocker(volumeArguments, 30_000);

    const transferContainer = safeDockerName(
      'codeer-transfer',
      `${input.executionId}-${randomUUID()}`,
    );
    try {
      await this.runDocker(
        [
          'create',
          '--name',
          transferContainer,
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--pids-limit',
          '64',
          '--memory',
          '256m',
          '--mount',
          `type=volume,src=${volumeName},dst=/workspace`,
          '--label',
          'com.codeer.managed=true',
          '--label',
          `com.codeer.execution-id=${input.executionId}`,
          '--label',
          `com.codeer.created-at=${new Date().toISOString()}`,
          this.options.helperImage,
          'true',
        ],
        30_000,
      );
      await this.runDocker(
        ['cp', `${worktreePath}/.`, `${transferContainer}:/workspace/`],
        5 * 60_000,
      );
      await this.runDocker(['rm', '-f', transferContainer], 30_000);
      await this.runDocker(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--pids-limit',
          '64',
          '--memory',
          '256m',
          '--user',
          '0:0',
          '--mount',
          `type=volume,src=${volumeName},dst=/workspace`,
          this.options.helperImage,
          'rm',
          '-rf',
          '--',
          '/workspace/.git',
        ],
        60_000,
      );
      await this.runDocker(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--cap-add',
          'CHOWN',
          '--security-opt',
          'no-new-privileges:true',
          '--pids-limit',
          '64',
          '--memory',
          '256m',
          '--user',
          '0:0',
          '--mount',
          `type=volume,src=${volumeName},dst=/workspace`,
          this.options.helperImage,
          'chown',
          '-R',
          '1000:1000',
          '/workspace',
        ],
        5 * 60_000,
      );
    } catch (error) {
      await this.runDocker(['rm', '-f', transferContainer], 30_000).catch(() => undefined);
      await this.runDocker(['volume', 'rm', '-f', volumeName], 30_000).catch(() => undefined);
      throw error;
    }

    const prepared: PreparedSandbox = {
      executionId: input.executionId,
      volumeName,
      worktreePath,
      labels,
      imageIdentity,
      helperImageIdentity,
    };
    try {
      const transferredBytes = await this.workspaceSize(prepared);
      if (transferredBytes > input.policy.resourceLimits.workspaceBytes) {
        throw new SandboxPolicyViolationError(
          `Transferred workspace exceeds the approved ${input.policy.resourceLimits.workspaceBytes}-byte limit.`,
        );
      }
      return prepared;
    } catch (error) {
      await this.cleanupResources(input.executionId, [volumeName]).catch(() => undefined);
      throw error;
    }
  }

  async execute(
    prepared: PreparedSandbox,
    command: SandboxCommandRequest,
    policy: SandboxPolicyDecision,
    onOutput: (event: SandboxOutputEvent) => Promise<void> | void,
    abortSignal?: AbortSignal,
  ): Promise<SandboxCommandOutcome> {
    const startedAt = new Date();
    const commandContainer = safeDockerName(
      'codeer-command',
      `${prepared.executionId}-${randomUUID()}`,
    );
    const network =
      command.networkMode === SandboxNetworkMode.NONE ? 'none' : policy.networkPolicy.dockerNetwork;
    if (!network)
      throw new Error('A restricted Docker network is required for installation commands.');
    if (command.networkMode === SandboxNetworkMode.RESTRICTED_INSTALL) {
      await this.assertRestrictedInstallNetwork(policy);
    }
    const timeoutMs = Math.min(
      command.timeoutMs ?? policy.resourceLimits.commandTimeoutMs,
      policy.resourceLimits.commandTimeoutMs,
    );
    const environment = {
      HOME: '/tmp/home',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      CI: 'true',
      NO_COLOR: '1',
      TZ: 'UTC',
      LANG: 'C.UTF-8',
      ...command.environment,
    };
    const createArgs = [
      'create',
      '--name',
      commandContainer,
      '--network',
      network,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--ipc',
      'none',
      '--init',
      '--ulimit',
      'core=0:0',
      '--ulimit',
      'nofile=1024:1024',
      '--ulimit',
      `nproc=${policy.resourceLimits.pids}:${policy.resourceLimits.pids}`,
      '--stop-timeout',
      '1',
      '--pids-limit',
      String(policy.resourceLimits.pids),
      '--memory',
      String(policy.resourceLimits.memoryBytes),
      '--cpus',
      String(policy.resourceLimits.cpuCores),
      '--user',
      '1000:1000',
      '--workdir',
      command.workingDirectory === '.' ? '/workspace' : `/workspace/${command.workingDirectory}`,
      '--tmpfs',
      `/tmp:rw,noexec,nosuid,nodev,size=${policy.resourceLimits.tempBytes},mode=1777`,
      '--mount',
      `type=volume,src=${prepared.volumeName},dst=/workspace`,
      '--label',
      'com.codeer.managed=true',
      '--label',
      `com.codeer.execution-id=${prepared.executionId}`,
      '--label',
      `com.codeer.created-at=${new Date().toISOString()}`,
      ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      policy.image,
      command.executable,
      ...command.arguments,
    ];
    const created = await this.runDocker(createArgs, 30_000);
    const containerId = created.stdout.trim() || commandContainer;
    await onOutput({
      stream: 'system',
      content: `Sandbox command container created: ${basename(containerId)}`,
      occurredAt: new Date(),
    });

    const output = await this.runDocker(
      ['start', '--attach', commandContainer],
      timeoutMs,
      async (stream, content) => onOutput({ stream, content, occurredAt: new Date() }),
      abortSignal,
    );
    const inspected = await this.runDocker(
      ['inspect', '--format', '{{.State.ExitCode}}|{{.State.OOMKilled}}', commandContainer],
      15_000,
    ).catch(() => ({ code: 1, signal: null, stdout: '', stderr: '', timedOut: false }));
    const [exitCodeText = '', oomKilledText = 'false'] = inspected.stdout.trim().split('|', 2);
    const exitCode = /^\d+$/.test(exitCodeText) ? Number(exitCodeText) : output.code;
    const oomKilled = oomKilledText === 'true';
    const workspaceBytes = await this.workspaceSize(prepared).catch(() => Number.NaN);
    await this.runDocker(['rm', '-f', commandContainer], 30_000).catch(() => undefined);
    if (!Number.isSafeInteger(workspaceBytes)) {
      throw new Error('Sandbox workspace usage could not be measured after command execution.');
    }
    if (workspaceBytes > policy.resourceLimits.workspaceBytes) {
      throw new SandboxPolicyViolationError(
        `Sandbox workspace exceeded the approved ${policy.resourceLimits.workspaceBytes}-byte limit.`,
      );
    }
    const completedAt = new Date();
    const status = output.timedOut
      ? SandboxCommandStatus.TIMED_OUT
      : abortSignal?.aborted
        ? SandboxCommandStatus.CANCELLED
        : command.expectedExitCodes.includes(exitCode)
          ? SandboxCommandStatus.SUCCEEDED
          : SandboxCommandStatus.FAILED;
    return {
      containerId,
      status,
      exitCode,
      signal: output.signal,
      timedOut: output.timedOut,
      oomKilled,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      stdout: output.stdout,
      stderr: output.stderr,
      outputDigest: sha256Hex(`${output.stdout}\n${output.stderr}`),
      startedAt,
      completedAt,
    };
  }

  async collectArtifacts(
    prepared: PreparedSandbox,
    paths: readonly string[],
    maximumTotalBytes: number,
  ): Promise<SandboxArtifact[]> {
    const artifacts: SandboxArtifact[] = [];
    let totalBytes = 0;
    for (const requestedPath of paths) {
      const relativePath = validateArtifactPath(requestedPath);
      const workspacePath = `/workspace/${relativePath}`;
      const resolvedPathResult = await this.runDocker(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--mount',
          `type=volume,src=${prepared.volumeName},dst=/workspace,readonly`,
          this.options.helperImage,
          'realpath',
          '-e',
          '--',
          workspacePath,
        ],
        30_000,
      ).catch(() => undefined);
      const resolvedPath = resolvedPathResult?.stdout.trim() ?? '';
      if (!resolvedPath.startsWith('/workspace/')) continue;
      const stat = await this.runDocker(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--mount',
          `type=volume,src=${prepared.volumeName},dst=/workspace,readonly`,
          this.options.helperImage,
          'stat',
          '-c',
          '%F|%s',
          '--',
          resolvedPath,
        ],
        30_000,
      ).catch(() => undefined);
      const [fileType = '', byteSizeText = ''] = stat?.stdout.trim().split('|', 2) ?? [];
      if (fileType !== 'regular file' || !/^\d+$/.test(byteSizeText)) continue;
      const byteSize = Number(byteSizeText);
      if (byteSize < 0 || totalBytes + byteSize > maximumTotalBytes) break;
      const digestResult = await this.runDocker(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--mount',
          `type=volume,src=${prepared.volumeName},dst=/workspace,readonly`,
          this.options.helperImage,
          'sha256sum',
          '--',
          resolvedPath,
        ],
        60_000,
      );
      const digest = digestResult.stdout.trim().split(/\s+/)[0] ?? '';
      if (!/^[0-9a-f]{64}$/i.test(digest)) continue;
      artifacts.push(
        SandboxArtifactSchema.parse({
          id: randomUUID(),
          executionId: prepared.executionId,
          path: relativePath,
          mediaType: 'application/octet-stream',
          byteSize,
          digest: digest.toLowerCase(),
          retention: SandboxArtifactRetention.INCIDENT,
          storageReference: null,
          createdAt: new Date().toISOString(),
        }),
      );
      totalBytes += byteSize;
    }
    return artifacts;
  }

  async cleanup(prepared: PreparedSandbox): Promise<SandboxCleanupOutcome> {
    return await this.cleanupResources(prepared.executionId, [prepared.volumeName]);
  }

  async cleanupExecution(executionId: string): Promise<SandboxCleanupOutcome> {
    return await this.cleanupResources(executionId, []);
  }

  private async cleanupResources(
    executionId: string,
    knownVolumeIds: readonly string[],
  ): Promise<SandboxCleanupOutcome> {
    let attempts = 0;
    let containerIds: string[] = [];
    let volumeIds = [...knownVolumeIds];
    let error: string | null = null;
    let verifiedAbsent = false;

    for (attempts = 1; attempts <= 3 && !verifiedAbsent; attempts += 1) {
      const containerList = await this.runDockerAllowFailure(
        ['ps', '-aq', '--filter', `label=com.codeer.execution-id=${executionId}`],
        30_000,
      );
      const volumeList = await this.runDockerAllowFailure(
        ['volume', 'ls', '-q', '--filter', `label=com.codeer.execution-id=${executionId}`],
        30_000,
      );
      if (containerList.code !== 0 || volumeList.code !== 0) {
        error = this.safeDockerFailure(
          'Sandbox cleanup listing failed',
          `${containerList.stderr} ${volumeList.stderr}`,
        );
        continue;
      }
      containerIds = [
        ...new Set([...containerIds, ...containerList.stdout.split(/\s+/).filter(Boolean)]),
      ];
      volumeIds = [...new Set([...volumeIds, ...volumeList.stdout.split(/\s+/).filter(Boolean)])];
      for (const containerId of containerIds) {
        const removal = await this.runDockerAllowFailure(['rm', '-f', containerId], 30_000);
        if (removal.code !== 0 && !this.isDockerNotFound(removal.stderr)) {
          error = this.safeDockerFailure('Container cleanup failed', removal.stderr);
        }
      }
      for (const volumeId of volumeIds) {
        const removal = await this.runDockerAllowFailure(['volume', 'rm', '-f', volumeId], 30_000);
        if (removal.code !== 0 && !this.isDockerNotFound(removal.stderr)) {
          error = this.safeDockerFailure('Volume cleanup failed', removal.stderr);
        }
      }

      const remainingContainers = await this.runDockerAllowFailure(
        ['ps', '-aq', '--filter', `label=com.codeer.execution-id=${executionId}`],
        30_000,
      );
      const remainingVolumes = await this.runDockerAllowFailure(
        ['volume', 'ls', '-q', '--filter', `label=com.codeer.execution-id=${executionId}`],
        30_000,
      );
      verifiedAbsent =
        remainingContainers.code === 0 &&
        remainingContainers.stdout.trim() === '' &&
        remainingVolumes.code === 0 &&
        remainingVolumes.stdout.trim() === '';
      if (!verifiedAbsent && attempts < 3) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, attempts * 250));
      }
    }

    return {
      containerIds,
      volumeIds,
      networkIds: [],
      verifiedAbsent,
      attempts: Math.min(attempts, 3),
      error: verifiedAbsent
        ? null
        : (error ?? 'Cleanup verification could not prove resource absence.'),
      completedAt: new Date(),
    };
  }

  async reconcile(
    staleBefore: Date,
  ): Promise<{ removedContainers: string[]; removedVolumes: string[] }> {
    const containers = await this.runDocker(
      ['ps', '-aq', '--filter', 'label=com.codeer.managed=true'],
      30_000,
    );
    const removedContainers: string[] = [];
    for (const id of containers.stdout.split(/\s+/).filter(Boolean)) {
      const created = await this.runDocker(
        ['inspect', '--format', '{{.Created}}', id],
        15_000,
      ).catch(() => undefined);
      if (!created || Date.parse(created.stdout.trim()) >= staleBefore.getTime()) continue;
      await this.runDocker(['rm', '-f', id], 30_000).catch(() => undefined);
      removedContainers.push(id);
    }
    const volumeResult = await this.runDocker(
      ['volume', 'ls', '-q', '--filter', 'label=com.codeer.managed=true'],
      30_000,
    );
    const removedVolumes: string[] = [];
    for (const volume of volumeResult.stdout.split(/\s+/).filter(Boolean)) {
      const inspect = await this.runDocker(
        ['volume', 'inspect', '--format', '{{index .Labels "com.codeer.created-at"}}', volume],
        15_000,
      ).catch(() => undefined);
      if (!inspect || Date.parse(inspect.stdout.trim()) >= staleBefore.getTime()) continue;
      await this.runDocker(['volume', 'rm', '-f', volume], 30_000).catch(() => undefined);
      removedVolumes.push(volume);
    }
    return { removedContainers, removedVolumes };
  }

  private async assertRestrictedInstallNetwork(policy: SandboxPolicyDecision): Promise<void> {
    const network = policy.networkPolicy.dockerNetwork;
    if (!network) {
      throw new SandboxPolicyViolationError(
        'Restricted installation networking is not configured.',
      );
    }
    const expectedDestinationsDigest = sha256Hex(
      JSON.stringify({
        allowedDomains: [...policy.networkPolicy.allowedDomains].sort(),
        allowedRegistries: [...policy.networkPolicy.allowedRegistries].sort(),
        denyMetadataServices: policy.networkPolicy.denyMetadataServices,
        denyPrivateNetworks: policy.networkPolicy.denyPrivateNetworks,
      }),
    );
    const inspection = await this.runDocker(
      [
        'network',
        'inspect',
        '--format',
        '{{index .Labels "com.codeer.egress-controlled"}}|{{index .Labels "com.codeer.allowed-destinations-sha256"}}|{{.Driver}}|{{.Internal}}',
        network,
      ],
      30_000,
    );
    const [egressControlled = '', destinationsDigest = '', driver = '', internal = ''] =
      inspection.stdout.trim().split('|', 4);
    if (egressControlled !== 'true') {
      throw new SandboxPolicyViolationError(
        'Restricted installation network is not attested as egress-controlled.',
      );
    }
    if (destinationsDigest.toLowerCase() !== expectedDestinationsDigest) {
      throw new SandboxPolicyViolationError(
        'Restricted installation network destination policy does not match the approved sandbox policy.',
      );
    }
    if (!driver || ['host', 'null'].includes(driver) || internal === 'true') {
      throw new SandboxPolicyViolationError(
        'Restricted installation network has an unsupported isolation profile.',
      );
    }
  }

  private async workspaceSize(prepared: PreparedSandbox): Promise<number> {
    const measured = await this.runDocker(
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--pids-limit',
        '64',
        '--memory',
        '256m',
        '--mount',
        `type=volume,src=${prepared.volumeName},dst=/workspace,readonly`,
        this.options.helperImage,
        'du',
        '-sb',
        '/workspace',
      ],
      60_000,
    );
    const value = Number(measured.stdout.trim().split(/\s+/)[0] ?? Number.NaN);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Sandbox workspace byte usage was invalid.');
    }
    return value;
  }

  private async runDockerAllowFailure(
    args: readonly string[],
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return await this.runDocker(args, timeoutMs, () => undefined);
  }

  private isDockerNotFound(stderr: string): boolean {
    return /(?:no such (?:volume|container|object)|not found)/i.test(stderr);
  }

  private safeDockerFailure(prefix: string, stderr: string): string {
    const redacted = redactSecretsFromText(stderr)
      .value.replace(/[\r\n]+/g, ' ')
      .trim();
    return redacted ? `${prefix}: ${redacted.slice(-1_000)}` : prefix;
  }

  private async runDocker(
    args: readonly string[],
    timeoutMs: number,
    onOutput?: (stream: 'stdout' | 'stderr', content: string) => Promise<void> | void,
    abortSignal?: AbortSignal,
  ): Promise<ProcessResult> {
    return await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
      const child = spawn(this.docker, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.dockerEnvironment,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputChain = Promise.resolve();
      let outputError: unknown;
      const append = (
        stream: 'stdout' | 'stderr',
        chunk: Buffer,
        readable: NodeJS.ReadableStream,
      ) => {
        const content = chunk.toString('utf8');
        if (stream === 'stdout') stdout = (stdout + content).slice(-this.outputLimit);
        else stderr = (stderr + content).slice(-this.outputLimit);
        if (!onOutput) return;
        readable.pause();
        outputChain = outputChain
          .then(async () => await onOutput(stream, content))
          .catch((error: unknown) => {
            outputError ??= error;
          })
          .finally(() => readable.resume());
      };
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk, child.stdout));
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk, child.stderr));
      const terminate = () => {
        timedOut = true;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(terminate, timeoutMs);
      timer.unref();
      const onAbort = () => child.kill('SIGKILL');
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      child.once('error', (error) => {
        clearTimeout(timer);
        abortSignal?.removeEventListener('abort', onAbort);
        rejectPromise(error);
      });
      child.once('close', (code, signal) => {
        void (async () => {
          clearTimeout(timer);
          abortSignal?.removeEventListener('abort', onAbort);
          await outputChain;
          if (outputError) {
            rejectPromise(
              outputError instanceof Error
                ? outputError
                : new Error('Sandbox log persistence failed.'),
            );
            return;
          }
          const result = { code: code ?? 1, signal, stdout, stderr, timedOut };
          if (result.code !== 0 && !onOutput && !timedOut) {
            rejectPromise(
              new Error(
                this.safeDockerFailure(
                  `Docker command failed (${args[0] ?? 'unknown'})`,
                  stderr.slice(-1_000),
                ),
              ),
            );
            return;
          }
          resolvePromise(result);
        })();
      });
    });
  }
}
