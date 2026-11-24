import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const username = 'propietario-fase2';
const password = randomBytes(24).toString('hex');
const prospectId = '00000000-0000-4000-8000-000000000201';
const conversationId = '00000000-0000-4000-8000-000000000202';
const messageId = '00000000-0000-4000-8000-000000000203';

const model = () => ({
  create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
  count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
});
const tx = { prospect: model(), conversation: model(), message: model(), suppression: model(), auditLog: model() };
const db = { ...tx, $transaction: vi.fn(), $disconnect: vi.fn() };
let app: FastifyInstance;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test', PORT: '3000', HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test?schema=public',
    CORS_ORIGIN: 'http://localhost:3000', OWNER_USERNAME: username,
    OWNER_PASSWORD_HASH: await bcrypt.hash(password, 12),
    JWT_SECRET: randomBytes(64).toString('hex'),
  });
  vi.doMock('../src/lib/prisma.js', () => ({ prisma: db }));
  const { buildServer } = await import('../src/server.js');
  app = await buildServer();
  await app.ready();
});

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === 'function') return operation(tx);
    if (Array.isArray(operation)) return Promise.all(operation);
    throw new Error('Transacción simulada desconocida');
  });
  tx.prospect.findUnique.mockResolvedValue({ id: prospectId, businessName: 'Empresa ficticia', status: 'NEW' });
  tx.conversation.findUnique.mockResolvedValue({ id: conversationId, prospectId, channel: 'EMAIL', status: 'OPEN' });
  tx.message.findFirst.mockResolvedValue({
    id: messageId,
    conversationId,
    status: 'DRAFT',
    direction: 'OUT',
    body: 'Borrador',
    conversation: { id: conversationId, prospectId, prospect: { id: prospectId, status: 'NEW' } },
  });
  tx.message.update.mockResolvedValue({ id: messageId, conversationId, status: 'PENDING_APPROVAL', direction: 'OUT', body: 'Borrador' });
  tx.auditLog.create.mockResolvedValue({ id: randomUUID() });
});

afterAll(async () => {
  if (app) await app.close();
  vi.doUnmock('../src/lib/prisma.js');
});

function authorization() {
  return { authorization: `Bearer ${app.jwt.sign({ sub: username, type: 'access', jti: randomUUID() }, { expiresIn: '30m' })}` };
}

describe('conversaciones y mensajes', () => {
  it('crea una conversación y registra auditoría', async () => {
    tx.conversation.create.mockResolvedValue({ id: conversationId, prospectId, channel: 'EMAIL', status: 'OPEN' });
    const response = await app.inject({
      method: 'POST', url: '/conversations', headers: authorization(),
      payload: { prospectId, channel: 'EMAIL' },
    });
    expect(response.statusCode).toBe(201);
    expect(tx.conversation.create).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('crea un borrador y lo mueve a aprobación', async () => {
    tx.message.create.mockResolvedValue({ id: messageId, conversationId, status: 'DRAFT', direction: 'OUT', body: 'Mensaje ficticio' });
    tx.message.update.mockResolvedValue({ id: messageId, conversationId, status: 'PENDING_APPROVAL', direction: 'OUT', body: 'Mensaje ficticio' });

    const created = await app.inject({
      method: 'POST', url: `/conversations/${conversationId}/messages`, headers: authorization(),
      payload: { direction: 'OUT', body: 'Mensaje ficticio' },
    });
    expect(created.statusCode).toBe(201);

    const requested = await app.inject({
      method: 'POST', url: `/conversations/${conversationId}/messages/${messageId}/request-approval`, headers: authorization(),
    });
    expect(requested.statusCode).toBeLessThan(300);
    expect(tx.message.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PENDING_APPROVAL' } }));
  });

  it('rechaza actualizar mensajes que no sean borradores', async () => {
    tx.message.findFirst.mockResolvedValue({ id: messageId, conversationId, status: 'APPROVED' });
    const response = await app.inject({
      method: 'PATCH', url: `/conversations/${conversationId}/messages/${messageId}`, headers: authorization(),
      payload: { body: 'No permitido' },
    });
    expect(response.statusCode).toBe(409);
  });
});
