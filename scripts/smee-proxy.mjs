#!/usr/bin/env node
/**
 * Starts smee-client to forward GitHub webhooks to the local API.
 * Reads WEBHOOK_PROXY_URL from the environment and forwards to
 * http://localhost:4100/api/v1/webhooks/github by default.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import SmeeClient from 'smee-client';

// Load local .env if present so WEBHOOK_PROXY_URL can be kept out of shell history.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Ignore unsupported or malformed .env files; explicit env vars still work.
  }
}

const source = process.env.WEBHOOK_PROXY_URL;
const target = process.env.WEBHOOK_TARGET_URL || 'http://localhost:4100/api/v1/webhooks/github';

if (!source) {
  console.error('WEBHOOK_PROXY_URL is required. Set it in .env and try again.');
  process.exit(1);
}

const smee = new SmeeClient({ source, target, logger: console });

const events = smee.start();

process.on('SIGINT', () => {
  events.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  events.close();
  process.exit(0);
});
