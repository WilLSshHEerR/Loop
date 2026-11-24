import { describe, expect, it } from 'vitest';
import { tokenSchema } from '../src/modules/auth/security.js';

describe('validación de tokens', () => {
	it('rechaza tokens sin los campos obligatorios', () => {
		expect(tokenSchema.safeParse({ type: 'access' }).success).toBe(false);
	});
});