import { rm } from 'node:fs/promises';

const paths = [
  'apps/web/.next',
  'apps/api/dist',
  'apps/worker/dist',
  'packages/contracts/dist',
  'packages/config/dist',
  'packages/logger/dist',
  'packages/database/dist',
  'coverage',
];

await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })));
console.log('Removed generated build output.');
