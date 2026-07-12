import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifacts = path.join(process.cwd(), 'artifacts');
await mkdir(artifacts, { recursive: true });

const result = await new Promise((resolve, reject) => {
  const child = spawn('npm', ['sbom', '--sbom-format', 'cyclonedx'], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

if (result.code !== 0) {
  console.error(result.stderr);
  process.exit(result.code ?? 1);
}

const output = path.join(artifacts, 'codeer-sbom.cdx.json');
await writeFile(output, result.stdout, { encoding: 'utf8', mode: 0o600 });
console.log(`SBOM written to ${path.relative(process.cwd(), output)}`);
