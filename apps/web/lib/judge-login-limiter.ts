/**
 * Bounded in-process rate limiter for the judge login endpoint.
 *
 * Competition deployments run a single web instance, so process memory is an
 * acceptable store. A horizontally scaled or serverless deployment must move
 * these counters to Redis or delegate throttling to an identity provider or
 * edge proxy — see docs/submission/judging-access.md.
 */

const WINDOW_MS = 10 * 60 * 1_000;
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_GLOBAL = 30;
const MAX_TRACKED_IPS = 1_000;

interface FailureWindow {
  failures: number[];
}

export interface JudgeLoginLimiter {
  /** Returns true when another attempt from this IP must be refused. */
  isLimited(ip: string, now?: number): boolean;
  /** Records a failed attempt and returns whether the IP is now limited. */
  recordFailure(ip: string, now?: number): boolean;
  /** Clears the failure history for an IP after a successful login. */
  recordSuccess(ip: string): void;
}

export function createJudgeLoginLimiter(options?: {
  windowMs?: number;
  maxFailuresPerIp?: number;
  maxFailuresGlobal?: number;
  maxTrackedIps?: number;
}): JudgeLoginLimiter {
  const windowMs = options?.windowMs ?? WINDOW_MS;
  const maxFailuresPerIp = options?.maxFailuresPerIp ?? MAX_FAILURES_PER_IP;
  const maxFailuresGlobal = options?.maxFailuresGlobal ?? MAX_FAILURES_GLOBAL;
  const maxTrackedIps = options?.maxTrackedIps ?? MAX_TRACKED_IPS;
  const perIp = new Map<string, FailureWindow>();
  let globalFailures: number[] = [];

  function prune(values: number[], now: number): number[] {
    return values.filter((timestamp) => now - timestamp < windowMs);
  }

  function sweep(now: number): void {
    globalFailures = prune(globalFailures, now);
    for (const [key, window] of perIp) {
      window.failures = prune(window.failures, now);
      if (window.failures.length === 0) perIp.delete(key);
    }
  }

  function track(ip: string): FailureWindow {
    let window = perIp.get(ip);
    if (!window) {
      if (perIp.size >= maxTrackedIps) {
        // Bound memory under IP spoofing: evict the oldest entry.
        const oldest = perIp.keys().next().value;
        if (oldest !== undefined) perIp.delete(oldest);
      }
      window = { failures: [] };
      perIp.set(ip, window);
    }
    return window;
  }

  function limited(ip: string): boolean {
    if (globalFailures.length >= maxFailuresGlobal) return true;
    return (perIp.get(ip)?.failures.length ?? 0) >= maxFailuresPerIp;
  }

  return {
    isLimited(ip, now = Date.now()) {
      sweep(now);
      return limited(ip);
    },
    recordFailure(ip, now = Date.now()) {
      sweep(now);
      globalFailures.push(now);
      track(ip).failures.push(now);
      return limited(ip);
    },
    recordSuccess(ip) {
      perIp.delete(ip);
    },
  };
}

export const judgeLoginLimiter = createJudgeLoginLimiter();
