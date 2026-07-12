import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'coverage',
  'artifacts',
]);
const ignoredFiles = new Set(['package-lock.json']);
const patterns = [
  { name: 'private key', value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'GitHub token',
    value: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  { name: 'OpenAI-style API key', value: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'AWS access key', value: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', value: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
];

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await filesUnder(absolute)));
    else if (entry.isFile() && !ignoredFiles.has(entry.name)) output.push(absolute);
  }
  return output;
}

const findings = [];
for (const file of await filesUnder(root)) {
  const metadata = await stat(file);
  if (metadata.size > 1024 * 1024) continue;
  const content = await readFile(file, 'utf8').catch(() => undefined);
  if (content === undefined) continue;
  for (const pattern of patterns) {
    if (pattern.value.test(content)) {
      findings.push(`${path.relative(root, file)}: possible ${pattern.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error(
    'Potential secrets detected:\n' + findings.map((finding) => `- ${finding}`).join('\n'),
  );
  process.exit(1);
}
console.log('Secret-pattern scan passed.');
