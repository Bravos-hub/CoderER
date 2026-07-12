import { randomUUID } from 'node:crypto';
import { posix as path } from 'node:path';
import {
  SandboxCommandPhase,
  SandboxCommandRequestSchema,
  SandboxNetworkMode,
  SandboxNetworkPolicySchema,
  SandboxPolicyDecisionSchema,
  SandboxResourceLimitsSchema,
  type SandboxCommandRequest,
  type SandboxNetworkPolicy,
  type SandboxPolicyDecision,
  type SandboxResourceLimits,
  type StartReproductionInput,
} from '@codeer/contracts';
import { containsCredentialMaterial } from '@codeer/security';

export const SANDBOX_POLICY_VERSION = 'sandbox-policy/2026-07-12.1';

const FORBIDDEN_ARGUMENT = /(?:&&|\|\||[;`]|\$\(|>\s*\/|<\s*\/)/;
const FORBIDDEN_NODE_FLAGS = new Set([
  '-e',
  '--eval',
  '-p',
  '--print',
  '-r',
  '--require',
  '--loader',
  '--experimental-loader',
  '--import',
]);
const SAFE_ENVIRONMENT_KEYS = new Set([
  'CI',
  'NODE_ENV',
  'NO_COLOR',
  'FORCE_COLOR',
  'TZ',
  'LANG',
  'LC_ALL',
  'NPM_CONFIG_FUND',
  'NPM_CONFIG_AUDIT',
  'NPM_CONFIG_UPDATE_NOTIFIER',
  'NPM_CONFIG_IGNORE_SCRIPTS',
  'PNPM_HOME',
  'YARN_ENABLE_SCRIPTS',
  'YARN_ENABLE_TELEMETRY',
]);

export interface SandboxPolicyOptions {
  production: boolean;
  approvedImageRegistries: readonly string[];
  defaultImage: string;
  defaultResourceLimits?: Partial<SandboxResourceLimits>;
  installationNetwork?: string | undefined;
  installationAllowedRegistries?: readonly string[] | undefined;
  installationAllowedDomains?: readonly string[] | undefined;
  allowInstallScriptsOverride?: boolean | undefined;
}

function normalizedWorkingDirectory(value: string): string | undefined {
  if (value.includes('\\') || value.includes('\0') || path.isAbsolute(value)) return undefined;
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) return undefined;
  return normalized === '.' ? '.' : normalized.replace(/^\.\//, '');
}

function isDigestPinnedImage(image: string): boolean {
  return /@sha256:[0-9a-f]{64}$/i.test(image);
}

function imageRegistry(image: string): string {
  const segments = image.split('/');
  if (segments.length === 1) return 'docker.io';
  const first = segments[0] ?? '';
  return first.includes('.') || first.includes(':') || first === 'localhost' ? first : 'docker.io';
}

function commandPolicy(command: SandboxCommandRequest): string[] {
  const reasons: string[] = [];
  const workingDirectory = normalizedWorkingDirectory(command.workingDirectory);
  if (!workingDirectory)
    reasons.push(`Working directory is outside the repository: ${command.workingDirectory}`);
  if (
    command.arguments.some(
      (argument) =>
        FORBIDDEN_ARGUMENT.test(argument) ||
        [...argument].some((character) => ['\0', '\r', '\n'].includes(character)),
    )
  ) {
    reasons.push(`Command contains shell-control syntax: ${command.executable}`);
  }
  if (containsCredentialMaterial(command.environment)) {
    reasons.push(`Command environment contains credential-like material: ${command.executable}`);
  }
  for (const key of Object.keys(command.environment)) {
    if (!SAFE_ENVIRONMENT_KEYS.has(key))
      reasons.push(`Environment variable is not allowlisted: ${key}`);
  }
  if (
    command.phase === SandboxCommandPhase.REPRODUCE &&
    command.networkMode !== SandboxNetworkMode.NONE
  ) {
    reasons.push('Reproduction commands must execute with networking disabled.');
  }
  if (
    command.phase === SandboxCommandPhase.INSTALL &&
    command.networkMode === SandboxNetworkMode.NONE
  ) {
    // Offline installs are permitted and preferred.
  }
  if (
    command.phase !== SandboxCommandPhase.INSTALL &&
    command.networkMode === SandboxNetworkMode.RESTRICTED_INSTALL
  ) {
    reasons.push('Restricted installation networking is only allowed during the install phase.');
  }

  if (command.executable === 'npm') {
    const [first, second] = command.arguments;
    const allowed =
      (command.phase === SandboxCommandPhase.INSTALL && first === 'ci') ||
      (command.phase === SandboxCommandPhase.REPRODUCE &&
        (first === 'test' ||
          (first === 'run' && Boolean(second) && /^[A-Za-z0-9:_-]{1,128}$/.test(second ?? ''))));
    if (!allowed)
      reasons.push(
        `npm invocation is outside the approved command profile: ${command.arguments.join(' ')}`,
      );
    if (
      command.phase === SandboxCommandPhase.INSTALL &&
      !command.arguments.includes('--ignore-scripts')
    ) {
      reasons.push(
        'npm installation must include --ignore-scripts unless an approved policy override exists.',
      );
    }
  }

  if (command.executable === 'pnpm') {
    const [first, second] = command.arguments;
    const allowed =
      (command.phase === SandboxCommandPhase.INSTALL && first === 'install') ||
      (command.phase === SandboxCommandPhase.REPRODUCE &&
        (first === 'test' ||
          (first === 'run' && Boolean(second) && /^[A-Za-z0-9:_-]{1,128}$/.test(second ?? ''))));
    if (!allowed)
      reasons.push(
        `pnpm invocation is outside the approved command profile: ${command.arguments.join(' ')}`,
      );
    if (command.phase === SandboxCommandPhase.INSTALL) {
      if (!command.arguments.includes('--frozen-lockfile'))
        reasons.push('pnpm install must use --frozen-lockfile.');
      if (!command.arguments.includes('--ignore-scripts'))
        reasons.push('pnpm install must use --ignore-scripts.');
    }
  }

  if (command.executable === 'yarn') {
    const [first, second] = command.arguments;
    const allowed =
      (command.phase === SandboxCommandPhase.INSTALL && first === 'install') ||
      (command.phase === SandboxCommandPhase.REPRODUCE &&
        (first === 'test' ||
          (first === 'run' && Boolean(second) && /^[A-Za-z0-9:_-]{1,128}$/.test(second ?? ''))));
    if (!allowed)
      reasons.push(
        `yarn invocation is outside the approved command profile: ${command.arguments.join(' ')}`,
      );
    if (
      command.phase === SandboxCommandPhase.INSTALL &&
      !command.arguments.includes('--immutable')
    ) {
      reasons.push('yarn install must use --immutable.');
    }
  }

  if (command.executable === 'node') {
    const entry = command.arguments[0];
    if (!entry || entry.startsWith('-') || FORBIDDEN_NODE_FLAGS.has(entry)) {
      reasons.push('node must execute a repository-relative JavaScript entry file.');
    } else {
      const normalized = normalizedWorkingDirectory(entry);
      if (!normalized || !/\.(?:c|m)?js$/i.test(normalized)) {
        reasons.push('node entry file must be a repository-relative .js, .cjs or .mjs file.');
      }
    }
    if (command.arguments.some((argument) => FORBIDDEN_NODE_FLAGS.has(argument))) {
      reasons.push('node dynamic code-loading flags are prohibited.');
    }
  }

  return reasons;
}

function normalizeCommand(
  command: SandboxCommandRequest,
  limits: SandboxResourceLimits,
): SandboxCommandRequest {
  const parsed = SandboxCommandRequestSchema.parse(command);
  return {
    ...parsed,
    workingDirectory:
      normalizedWorkingDirectory(parsed.workingDirectory) ?? parsed.workingDirectory,
    timeoutMs: Math.min(parsed.timeoutMs ?? limits.commandTimeoutMs, limits.commandTimeoutMs),
    environment: Object.fromEntries(
      Object.entries(parsed.environment).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function evaluateSandboxPolicy(
  input: StartReproductionInput,
  options: SandboxPolicyOptions,
  now = new Date(),
): SandboxPolicyDecision {
  const policyCeilings = SandboxResourceLimitsSchema.parse(options.defaultResourceLimits ?? {});
  const requestedLimits = input.resourceLimits ?? {};
  const reasons: string[] = [];
  const limitFields = [
    'cpuCores',
    'memoryBytes',
    'pids',
    'workspaceBytes',
    'tempBytes',
    'commandTimeoutMs',
    'executionTimeoutMs',
    'maximumCommands',
    'maximumLogBytes',
    'maximumArtifactBytes',
  ] as const satisfies readonly (keyof SandboxResourceLimits)[];
  for (const field of limitFields) {
    const requested = requestedLimits[field];
    const ceiling = policyCeilings[field];
    if (requested !== undefined && requested > ceiling) {
      reasons.push(`Requested ${field} exceeds the operator policy ceiling ${ceiling}.`);
    }
  }
  const resourceLimits = SandboxResourceLimitsSchema.parse(
    Object.fromEntries(
      limitFields.map((field) => [
        field,
        Math.min(requestedLimits[field] ?? policyCeilings[field], policyCeilings[field]),
      ]),
    ),
  );
  const requestedNetwork = SandboxNetworkPolicySchema.parse({
    mode: SandboxNetworkMode.NONE,
    denyPrivateNetworks: true,
    denyMetadataServices: true,
    ...input.networkPolicy,
  });
  const operatorRegistries = [...(options.installationAllowedRegistries ?? [])]
    .map((value) => value.toLowerCase())
    .sort();
  const operatorDomains = [...(options.installationAllowedDomains ?? [])]
    .map((value) => value.toLowerCase())
    .sort();
  for (const registry of requestedNetwork.allowedRegistries) {
    if (!operatorRegistries.includes(registry.toLowerCase())) {
      reasons.push(`Requested installation registry is not operator-approved: ${registry}`);
    }
  }
  for (const domain of requestedNetwork.allowedDomains) {
    if (!operatorDomains.includes(domain.toLowerCase())) {
      reasons.push(`Requested installation domain is not operator-approved: ${domain}`);
    }
  }
  const networkPolicy: SandboxNetworkPolicy =
    requestedNetwork.mode === SandboxNetworkMode.RESTRICTED_INSTALL
      ? {
          ...requestedNetwork,
          allowedRegistries:
            requestedNetwork.allowedRegistries.length > 0
              ? requestedNetwork.allowedRegistries.map((value) => value.toLowerCase()).sort()
              : operatorRegistries,
          allowedDomains:
            requestedNetwork.allowedDomains.length > 0
              ? requestedNetwork.allowedDomains.map((value) => value.toLowerCase()).sort()
              : operatorDomains,
          ...(options.installationNetwork ? { dockerNetwork: options.installationNetwork } : {}),
        }
      : {
          ...requestedNetwork,
          mode: SandboxNetworkMode.NONE,
          dockerNetwork: undefined,
          allowedRegistries: [],
          allowedDomains: [],
        };
  const image = input.image || options.defaultImage;
  const commands = [...input.installCommands, ...input.reproductionCommands].map((command) =>
    normalizeCommand(command, resourceLimits),
  );
  const usesRestrictedInstallNetwork = commands.some(
    (command) => command.networkMode === SandboxNetworkMode.RESTRICTED_INSTALL,
  );
  if (
    usesRestrictedInstallNetwork &&
    networkPolicy.mode !== SandboxNetworkMode.RESTRICTED_INSTALL
  ) {
    reasons.push(
      'Installation commands requesting network access require an explicit restricted network policy.',
    );
  }
  if (commands.length > resourceLimits.maximumCommands) {
    reasons.push(
      `Command count ${commands.length} exceeds policy maximum ${resourceLimits.maximumCommands}.`,
    );
  }
  const registry = imageRegistry(image);
  if (!options.approvedImageRegistries.includes(registry)) {
    reasons.push(`Container registry is not approved: ${registry}`);
  }
  if (options.production && !isDigestPinnedImage(image)) {
    reasons.push('Production sandbox images must be pinned by sha256 digest.');
  }
  if (
    networkPolicy.mode === SandboxNetworkMode.RESTRICTED_INSTALL &&
    networkPolicy.allowedRegistries.length === 0 &&
    networkPolicy.allowedDomains.length === 0
  ) {
    reasons.push('Restricted installation networking requires an operator destination allowlist.');
  }
  if (
    networkPolicy.mode === SandboxNetworkMode.RESTRICTED_INSTALL &&
    !networkPolicy.dockerNetwork
  ) {
    reasons.push(
      'Restricted installation networking requires a pre-provisioned egress-controlled Docker network.',
    );
  }
  if (
    networkPolicy.dockerNetwork &&
    ['host', 'bridge', 'default', 'none'].includes(networkPolicy.dockerNetwork)
  ) {
    reasons.push(
      'Installation networking must use a dedicated egress-controlled network, not a built-in Docker network.',
    );
  }
  for (const command of commands) reasons.push(...commandPolicy(command));

  const overrideRequired = reasons.some((reason) => reason.includes('--ignore-scripts'));
  const overrideAccepted = Boolean(
    options.allowInstallScriptsOverride &&
    input.policyOverrideReason &&
    input.policyOverrideReason.length >= 20,
  );
  const effectiveReasons =
    overrideRequired && overrideAccepted
      ? reasons.filter((reason) => !reason.includes('--ignore-scripts'))
      : reasons;

  return SandboxPolicyDecisionSchema.parse({
    allowed: effectiveReasons.length === 0,
    policyVersion: SANDBOX_POLICY_VERSION,
    decisionId: randomUUID(),
    reasons: effectiveReasons,
    normalizedCommands: commands,
    resourceLimits,
    networkPolicy,
    image,
    imageDigestRequired: options.production,
    overrideRequired,
    evaluatedAt: now.toISOString(),
  });
}
