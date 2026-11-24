import type { FastifyServerOptions } from 'fastify';
import { env } from '../config/env.js';

// Never serialize URLs, headers, bodies, errors or their potentially sensitive messages.
export const logger: FastifyServerOptions['logger'] = {
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  serializers: {
    req: () => ({}),
    res: () => ({}),
    err: () => ({ type: 'Error', message: '', stack: '' }),
    error: () => ({ type: 'Error' }),
  },
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]',
      'headers.authorization', 'headers.cookie', 'headers["set-cookie"]',
      'password', 'passwordHash', 'token', 'secret', 'code',
      '*.password', '*.passwordHash', '*.token', '*.secret', '*.code',
      '*.accessToken', '*.refreshToken', '*.challengeToken',
    ],
    remove: true,
  },
};