import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { prisma } from '../../lib/prisma.js';

export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid }).strict();
export const empty = z.object({}).strict();
export const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const phone = z.string().trim().min(1).max(40);
export const text = (max: number) => z.string().trim().min(1).max(max);
export const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  return schema.parse(input);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!['P2034', '40001', '40P01'].includes(errorCode(error) ?? '')) throw error;
      if (attempt === 2) throw new ApiError(409, 'TRANSACTION_CONFLICT', 'Concurrent update; retry the request');
    }
  }
  throw new ApiError(409, 'TRANSACTION_CONFLICT', 'Concurrent update; retry the request');
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') } });
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const code = errorCode(error);
    if (code === 'P2002') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A record with the same unique value already exists' } });
    if (code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    if (typeof error === 'object' && error !== null && 'statusCode' in error &&
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
}

export function pageResult<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit };
}