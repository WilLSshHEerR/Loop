import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { approvalRoutes } from './modules/approvals/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { prospectRoutes } from './modules/prospects/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { discoveryRoutes } from './modules/discovery/routes.js';
import { authPlugin } from './plugins/auth.js';
import { installErrorHandler } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';

export async function buildServer() {
  const app = Fastify({ logger, disableRequestLogging: true });
  installErrorHandler(app);
  app.addHook('onClose', async () => { await prisma.$disconnect(); });

  await app.register(rateLimitPlugin);
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(prospectRoutes, { prefix: '/prospects' });
  await app.register(approvalRoutes, { prefix: '/approvals' });
  await app.register(conversationRoutes, { prefix: '/conversations' });
  await app.register(discoveryRoutes, { prefix: '/discovery' });
  return app;
}