import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { consumeRefresh, consumeSecondFactor, recordFailure, retryAfter, tokenSchema } from './security.js';

const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
}).strict();
const secondFactorSchema = z.object({
  challengeToken: z.string().min(1).max(4096),
  code: z.string().regex(/^\d{6}$/),
}).strict();
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }).strict();

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function blocked(reply: FastifyReply, seconds: number) {
  return reply.header('Retry-After', String(seconds)).code(429).send({
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos. Inténtalo más tarde.' },
  });
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  function sign(type: 'challenge' | 'access' | 'refresh', expiresIn: string): string {
    return fastify.jwt.sign(
      { sub: env.OWNER_USERNAME, type, jti: randomUUID() },
      { algorithm: 'HS256', expiresIn },
    );
  }

  function verify(token: string, type: 'challenge' | 'refresh') {
    try {
      const payload = tokenSchema.safeParse(fastify.jwt.verify(token));
      if (!payload.success || payload.data.type !== type || payload.data.sub !== env.OWNER_USERNAME) return null;
      return payload.data;
    } catch {
      return null;
    }
  }

  function tokens() {
    return { accessToken: sign('access', '30m'), refreshToken: sign('refresh', '7d') };
  }

  fastify.post('/login', async (request, reply) => {
    let remaining = retryAfter(request.ip);
    if (remaining) return blocked(reply, remaining);
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return error(reply, 400, 'INVALID_INPUT', 'Datos de entrada inválidos.');

    // Compare even for an unknown username to avoid an obvious timing distinction.
    const passwordMatches = await bcrypt.compare(body.data.password, env.OWNER_PASSWORD_HASH);
    // Another request may have triggered a lock while bcrypt was running.
    remaining = retryAfter(request.ip);
    if (remaining) return blocked(reply, remaining);
    if (body.data.username !== env.OWNER_USERNAME || !passwordMatches) {
      remaining = recordFailure(request.ip);
      if (remaining) return blocked(reply, remaining);
      return error(reply, 401, 'INVALID_CREDENTIALS', 'Credenciales inválidas.');
    }
    return reply.send({ challengeToken: sign('challenge', '5m') });
  });

  fastify.post('/verify-2fa', async (request, reply) => {
    let remaining = retryAfter(request.ip);
    if (remaining) return blocked(reply, remaining);
    const body = secondFactorSchema.safeParse(request.body);
    if (!body.success) return error(reply, 400, 'INVALID_INPUT', 'Datos de entrada inválidos.');

    const challenge = verify(body.data.challengeToken, 'challenge');
    const now = Date.now();
    const totp = authenticator.clone();
    totp.options = { window: 1, step: 30, epoch: now };
    const delta = challenge ? totp.checkDelta(body.data.code, env.TOTP_SECRET) : null;
    const step = delta === null ? null : Math.floor(now / 30_000) + delta;
    if (!challenge || step === null || !consumeSecondFactor(challenge.jti, challenge.exp, step, now)) {
      remaining = recordFailure(request.ip);
      if (remaining) return blocked(reply, remaining);
      return error(reply, 401, 'INVALID_SECOND_FACTOR', 'Desafío o código inválido.');
    }
    return reply.send(tokens());
  });

  fastify.post('/refresh', async (request, reply) => {
    const body = refreshSchema.safeParse(request.body);
    if (!body.success) return error(reply, 400, 'INVALID_INPUT', 'Datos de entrada inválidos.');
    const refresh = verify(body.data.refreshToken, 'refresh');
    if (!refresh || !consumeRefresh(refresh.jti, refresh.exp)) {
      return error(reply, 401, 'INVALID_REFRESH', 'Token de renovación inválido.');
    }
    return reply.send(tokens());
  });
};