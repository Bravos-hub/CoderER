import { resolve } from 'node:path';
import { DockerSandboxProvider } from '@codeer/sandbox';

const staleAfterMs = Number(process.env.SANDBOX_STALE_AFTER_MS ?? 60 * 60 * 1000);
if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 60_000) {
  throw new Error('SANDBOX_STALE_AFTER_MS must be an integer of at least 60000.');
}
const helperImage = process.env.SANDBOX_HELPER_IMAGE ?? 'node:24-bookworm-slim';
const trustedWorkspaceRoot = resolve(
  process.env.REPOSITORY_WORKSPACE_ROOT ?? '/var/lib/codeer/workspaces',
);
const provider = new DockerSandboxProvider({
  helperImage,
  trustedWorkspaceRoot,
  dockerHost: process.env.SANDBOX_DOCKER_HOST,
  dockerTlsVerify: process.env.SANDBOX_DOCKER_TLS_VERIFY === 'true',
  dockerCertPath: process.env.SANDBOX_DOCKER_CERT_PATH,
  workspaceVolumeDriver: process.env.SANDBOX_WORKSPACE_VOLUME_DRIVER,
  workspaceVolumeSizeOption: process.env.SANDBOX_WORKSPACE_VOLUME_SIZE_OPTION,
});
const staleBefore = new Date(Date.now() - staleAfterMs);
const result = await provider.reconcile(staleBefore);
console.log(JSON.stringify({ staleBefore: staleBefore.toISOString(), ...result }));
