import jwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env.js';
import { tokenSchema } from '../modules/auth/security.js';

export const authPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  fastify.addHook('onRequest', async (request, reply) => {
    const path = (request.raw.url ?? '').split('?', 1)[0] ?? '';
    if (path === '/health' || path === '/auth' || path.startsWith('/auth/')) return;
    try {
      const payload = tokenSchema.safeParse(await request.jwtVerify());
      if (payload.success && payload.data.type === 'access' && payload.data.sub === env.OWNER_USERNAME) return;
    } catch {
      // Missing, expired, malformed, or incorrectly signed token.
    }
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Autenticación requerida.' } });
  });
};

// Fastify's plugin metadata makes the hook and JWT decoration available in the
// registration scope, rather than only inside this plugin's child scope.
Object.assign(authPlugin, { [Symbol.for('skip-override')]: true });