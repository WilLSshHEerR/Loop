import { describe, expect, it } from 'vitest';
import { consumeRefresh, consumeSecondFactor, recordFailure, retryAfter } from '../src/modules/auth/security.js';

describe('seguridad en memoria', () => {
  it('bloquea tras cinco fallos y desbloquea al terminar la ventana', () => {
    const ip = '192.0.2.201';
    const now = Date.now();
    for (let i = 0; i < 4; i++) expect(recordFailure(ip, now + i)).toBe(0);
    expect(recordFailure(ip, now + 4)).toBe(900);
    expect(retryAfter(ip, now + 1004)).toBe(899);
    expect(retryAfter(ip, now + 900_004)).toBe(0);
  });

  it('no permite reutilizar un desafío ni un paso TOTP', () => {
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    const expiry = Math.floor(now / 1000) + 300;
    expect(consumeSecondFactor('challenge-unit-a', expiry, step, now)).toBe(true);
    expect(consumeSecondFactor('challenge-unit-a', expiry, step + 1, now)).toBe(false);
    expect(consumeSecondFactor('challenge-unit-b', expiry, step, now)).toBe(false);
  });

  it('consume un token de renovación una sola vez', () => {
    const now = Date.now();
    const expiry = Math.floor(now / 1000) + 60;
    expect(consumeRefresh('refresh-unit-a', expiry, now)).toBe(true);
    expect(consumeRefresh('refresh-unit-a', expiry, now)).toBe(false);
  });
});