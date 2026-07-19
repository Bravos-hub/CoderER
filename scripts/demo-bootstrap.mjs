import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';

const INCIDENT_URL = 'http://localhost:3000/incidents/00000000-0000-4000-8000-000000290004';
const JUDGE_URL = 'http://localhost:3000/judge';
const startApplication = !process.argv.includes('--no-start');

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function checkPrerequisites() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22 || nodeMajor > 26) {
    throw new Error(`Node ${process.versions.node} is outside the supported range 22–26.`);
  }
  run('docker', ['--version'], { stdio: 'pipe' });
  run('docker', ['compose', 'version'], { stdio: 'pipe' });
}

console.log('==> Checking prerequisites');
checkPrerequisites();

console.log('==> Starting PostgreSQL and Redis');
run('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'redis']);

console.log('==> Applying database migrations');
run('npm', ['run', 'db:migrate:all']);

console.log('==> Provisioning runtime database roles');
run('npm', ['run', 'db:provision:runtime']);
run('npm', ['run', 'db:verify:roles']);

console.log('==> Resetting the deterministic demo');
run('npm', ['run', 'demo:reset']);

console.log('==> Verifying the seeded demo');
run('npm', ['run', 'demo:verify']);

console.log('');
console.log('CodeER demo environment is ready.');
console.log(`Judge login:      ${JUDGE_URL}`);
console.log(`Command centre:   http://localhost:3000/incidents`);
console.log(`Primary incident: ${INCIDENT_URL}`);
console.log('');

if (startApplication) {
  console.log('==> Starting web, api and worker (Ctrl+C to stop)');
  const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.log('Start the stack with: npm run demo:start');
}
