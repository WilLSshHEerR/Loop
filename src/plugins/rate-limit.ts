import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

export const rateLimitPlugin: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });
  // A root hook runs before authentication and also covers unmatched routes.
  app.addHook('onRequest', app.rateLimit());
};

Object.assign(rateLimitPlugin, { [Symbol.for('skip-override')]: true });