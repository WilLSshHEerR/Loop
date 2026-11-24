import { z } from 'zod';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Attempts = { failures: number[]; blockedUntil: number };
const attempts = new Map<string, Attempts>();
const usedRefreshTokens = new Map<string, number>();
let lastCleanup = 0;

function cleanup(now: number): void {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;

  for (const [ip, state] of attempts) {
    state.failures = state.failures.filter((time) => time > now - WINDOW_MS);
    if (state.blockedUntil <= now && state.failures.length === 0) attempts.delete(ip);
  }

  for (const [jti, expiresAt] of usedRefreshTokens) {
    if (expiresAt <= now) usedRefreshTokens.delete(jti);
  }
}

/** Seconds until this IP is unblocked, or zero. Successful requests never erase failures. */
export function retryAfter(ip: string, now = Date.now()): number {
  cleanup(now);
  const until = attempts.get(ip)?.blockedUntil ?? 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** Records a login failure and returns the resulting lock duration. */
export function recordFailure(ip: string, now = Date.now()): number {
  cleanup(now);
  const state = attempts.get(ip) ?? { failures: [], blockedUntil: 0 };
  if (state.blockedUntil > now) return Math.ceil((state.blockedUntil - now) / 1000);

  state.failures = state.failures.filter((time) => time > now - WINDOW_MS);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES) state.blockedUntil = now + WINDOW_MS;
  attempts.set(ip, state);
  return Math.max(0, Math.ceil((state.blockedUntil - now) / 1000));
}

export const tokenSchema = z.object({
  sub: z.string().min(1),
  type: z.enum(['access', 'refresh']),
  jti: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
}).strict();

export function consumeRefresh(jti: string, exp: number, now = Date.now()): boolean {
  cleanup(now);
  if (usedRefreshTokens.has(jti)) return false;
  usedRefreshTokens.set(jti, exp * 1000);
  return true;
}