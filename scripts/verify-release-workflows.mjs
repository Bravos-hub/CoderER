import { readFile } from 'node:fs/promises';

const workflows = new URL('../.github/workflows/', import.meta.url);

async function load(name) {
  try {
    return await readFile(new URL(name, workflows), 'utf8');
  } catch {
    console.error(`Required workflow is missing: .github/workflows/${name}`);
    process.exit(1);
  }
}

function assertTokens(name, content, tokens) {
  const missing = tokens.filter((token) => !content.includes(token));
  if (missing.length) {
    console.error(`${name} is missing required configuration: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const ci = await load('ci.yml');
assertTokens('ci.yml', ci, [
  'name: CI',
  'pull_request:',
  'branches: [main]',
  'npm run lint',
  'npm run typecheck',
  'npm run test',
  'npm run security:check',
]);

const security = await load('security.yml');
assertTokens('security.yml', security, [
  'name: Security',
  'pull_request:',
  'branches: [main]',
  'supply-chain:',
  'dependency-review:',
  'actions/dependency-review-action@v4',
  'fail-on-severity: high',
  'npm run security:secrets',
  'npm run security:audit',
  'npm run security:sbom',
]);
// The dependency-review gate must run on pull requests and must never be
// silently disabled. It is intentionally scoped to pull_request events.
if (!security.includes("if: github.event_name == 'pull_request'")) {
  console.error('security.yml dependency-review job must be scoped to pull_request events.');
  process.exit(1);
}
if (/if:\s*false/.test(security)) {
  console.error(
    'security.yml contains a disabled job (if: false). Security gates must not be skipped.',
  );
  process.exit(1);
}

const codeql = await load('codeql.yml');
assertTokens('codeql.yml', codeql, [
  'name: CodeQL',
  'branches: [main]',
  'github/codeql-action/analyze',
]);

// Domain security workflows must exist; their internal gates are owned by
// their respective sprint validations.
await load('recovery-security.yml');
await load('sandbox-security.yml');

console.log('Release workflow static validation passed.');
