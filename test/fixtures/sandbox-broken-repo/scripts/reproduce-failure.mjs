import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/reproduction.json',
  JSON.stringify({ reproduced: true, failure: 'CODEER_FIXTURE_FAILURE', timestamp: 'stable' }),
  'utf8',
);

const fakeCredential = ['ghp', 'fixture', 'token', 'must', 'be', 'redacted'].join('_');
console.error(`authorization=Bearer ${fakeCredential}`);
console.error('CODEER_FIXTURE_FAILURE: deterministic build contract mismatch');
process.exit(17);
