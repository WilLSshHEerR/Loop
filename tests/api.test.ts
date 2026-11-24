import { describe, expect, it } from 'vitest';
import { tokenSchema } from '../src/modules/auth/security.js';

describe('validación de tokens', () => {
	it('rechaza tokens sin los campos obligatorios', () => {
		expect(tokenSchema.safeParse({ type: 'access' }).success).toBe(false);
	});

	it('acepta access y refresh y rechaza tipos desconocidos', () => {
		const now = Math.floor(Date.now() / 1000);
		const base = { sub: 'propietario', jti: '00000000-0000-4000-8000-000000000001', iat: now, exp: now + 60 };
		expect(tokenSchema.safeParse({ ...base, type: 'unknown' }).success).toBe(false);
		expect(tokenSchema.safeParse({ ...base, type: 'access' }).success).toBe(true);
		expect(tokenSchema.safeParse({ ...base, type: 'refresh' }).success).toBe(true);
	});
});