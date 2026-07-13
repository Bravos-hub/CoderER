import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@codeer/config': source('./packages/config/src/index.ts'),
      '@codeer/contracts': source('./packages/contracts/src/index.ts'),
      '@codeer/github': source('./packages/github/src/index.ts'),
      '@codeer/logger': source('./packages/logger/src/index.ts'),
      '@codeer/incidents': source('./packages/incidents/src/index.ts'),
      '@codeer/security': source('./packages/security/src/index.ts'),
      '@codeer/database': source('./packages/database/src/index.ts'),
      '@codeer/repository': source('./packages/repository/src/index.ts'),
      '@codeer/sandbox': source('./packages/sandbox/src/index.ts'),
      '@codeer/ai': source('./packages/ai/src/index.ts'),
      '@codeer/recovery': source('./packages/recovery/src/index.ts'),
      '@codeer/publication': source('./packages/publication/src/index.ts'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
