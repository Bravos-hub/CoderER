import { describe, expect, it } from 'vitest';
import { createJudgeLoginLimiter } from './judge-login-limiter';

describe('judge login limiter', () => {
  it('allows attempts below the per-IP threshold', () => {
    const limiter = createJudgeLoginLimiter();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(limiter.recordFailure('10.0.0.1')).toBe(false);
    }
    expect(limiter.isLimited('10.0.0.1')).toBe(false);
  });

  it('limits an IP after five failures in the window', () => {
    const limiter = createJudgeLoginLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.recordFailure('10.0.0.2');
    }
    expect(limiter.isLimited('10.0.0.2')).toBe(true);
    expect(limiter.isLimited('10.0.0.3')).toBe(false);
  });

  it('restores access after the window expires', () => {
    const limiter = createJudgeLoginLimiter({ windowMs: 1_000 });
    const start = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.recordFailure('10.0.0.4', start);
    }
    expect(limiter.isLimited('10.0.0.4', start)).toBe(true);
    expect(limiter.isLimited('10.0.0.4', start + 1_001)).toBe(false);
  });

  it('applies the global failure budget across IPs', () => {
    const limiter = createJudgeLoginLimiter({ maxFailuresGlobal: 10 });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.recordFailure(`10.1.0.${attempt}`);
    }
    expect(limiter.isLimited('192.168.1.1')).toBe(true);
  });

  it('clears the per-IP count after a successful login', () => {
    const limiter = createJudgeLoginLimiter();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      limiter.recordFailure('10.0.0.5');
    }
    limiter.recordSuccess('10.0.0.5');
    expect(limiter.isLimited('10.0.0.5')).toBe(false);
    expect(limiter.recordFailure('10.0.0.5')).toBe(false);
  });

  it('bounds tracked IPs under spoofing', () => {
    const limiter = createJudgeLoginLimiter({ maxTrackedIps: 3 });
    limiter.recordFailure('10.2.0.1');
    limiter.recordFailure('10.2.0.2');
    limiter.recordFailure('10.2.0.3');
    limiter.recordFailure('10.2.0.4');
    expect(() => limiter.recordFailure('10.2.0.5')).not.toThrow();
  });
});
