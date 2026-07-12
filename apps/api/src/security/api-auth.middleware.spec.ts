import { describe, expect, it } from 'vitest';
import { isValidApiKey } from './api-auth.middleware.js';

describe('API authentication', () => {
  const secret = 'a-secure-development-key-with-more-than-32-characters';

  it('accepts the exact key', () => {
    expect(isValidApiKey(secret, secret)).toBe(true);
  });

  it('rejects absent and different keys', () => {
    expect(isValidApiKey(secret, undefined)).toBe(false);
    expect(isValidApiKey(secret, `${secret}-wrong`)).toBe(false);
  });
});
