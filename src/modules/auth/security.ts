import { z } from 'zod';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Attempts = { failures: number[]; blockedUntil: number };
const attempts = new Map<string, Attempts>();
const usedChallenges = new Map<string, number>();
const usedTotpSteps = new Map<number, number>();
const usedRefreshTokens = new Map<string, number>();
let lastCleanup = 0;

function cleanup(now: number): void {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [ip, state] of attempts) {
    state.failures = state.failures.filter((time) => time > now - WINDOW_MS);
    if (state.blockedUntil <= now && state.failures.length === 0) attempts.delete(ip);
  }
  for (const collection of [usedChallenges, usedTotpSteps, usedRefreshTokens]) {
    for (const [key, expiresAt] of collection as Map<never, number>) {
      if (expiresAt <= now) collection.delete(key);
    }
  }
}

/** Seconds until this IP is unblocked, or zero. Successful requests never erase failures. */
export function retryAfter(ip: string, now = Date.now()): number {
  cleanup(now);
  const until = attempts.get(ip)?.blockedUntil ?? 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** Records a login or second-factor failure and returns the resulting lock duration. */
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
  type: z.enum(['challenge', 'access', 'refresh']),
  jti: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});

/** Atomically consume the challenge and TOTP time step within this process. */
export function consumeSecondFactor(jti: string, challengeExp: number, step: number, now: number): boolean {
  cleanup(now);
  if (usedChallenges.has(jti) || usedTotpSteps.has(step)) return false;
  usedChallenges.set(jti, challengeExp * 1000);
  // With a ±1 step window, this step remains valid through the following step.
  usedTotpSteps.set(step, (step + 2) * 30_000);
  return true;
}

export function consumeRefresh(jti: string, exp: number, now = Date.now()): boolean {
  cleanup(now);
  if (usedRefreshTokens.has(jti)) return false;
  usedRefreshTokens.set(jti, exp * 1000);
  return true;
}