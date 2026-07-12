import { describe, expect, it } from 'vitest';
import { isRetryableDatabaseError } from './index.js';

describe('database resilience policy', () => {
  it('retries serialization failures and deadlocks', () => {
    expect(isRetryableDatabaseError({ code: '40001' })).toBe(true);
    expect(isRetryableDatabaseError({ code: '40P01' })).toBe(true);
  });

  it('does not retry validation or unique constraint failures', () => {
    expect(isRetryableDatabaseError({ code: '23505' })).toBe(false);
    expect(isRetryableDatabaseError(new Error('invalid query'))).toBe(false);
  });
});
