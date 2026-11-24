import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Credenciales efímeras: las pruebas no leen ni utilizan el .env real.
const username = 'propietario-de-prueba';
const password = randomBytes(24).toString('hex');
const prospectId = '00000000-0000-4000-8000-000000000101';
const conversationId = '00000000-0000-4000-8000-000000000102';
const messageId = '00000000-0000-4000-8000-000000000103';
const prospect = {
  id: prospectId, businessName: 'Empresa ficticia', category: 'Comercio',
  address: 'Calle de ejemplo 1', city: 'Madrid', state: 'Madrid',
  email: 'demo@example.invalid', phone: '+12025550123', status: 'NEW',
};
const conversation = { id: conversationId, prospectId, prospect };
const message = { id: messageId, conversationId, status: 'PENDING_APPROVAL', conversation };

function model() {
  return {
    create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
    count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
  };
}
function client() {
  return { prospect: model(), conversation: model(), message: model(), suppression: model(), auditLog: model() };
}
// Cliente transaccional separado para detectar escrituras fuera de la transacción.
const tx = client();
const db = { ...client(), $transaction: vi.fn(), $disconnect: vi.fn() };
let app: FastifyInstance;
let nextIp = 1;
const ip = () => `198.51.100.${nextIp++}`;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test', PORT: '3000', HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test?schema=public',
    CORS_ORIGIN: 'http://localhost:3000', OWNER_USERNAME: username,
    OWNER_PASSWORD_HASH: await bcrypt.hash(password, 12), JWT_SECRET: randomBytes(64).toString('hex'),
    POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test',
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
  for (const prisma of [db, tx]) {
    prisma.prospect.findUnique.mockResolvedValue(prospect);
    prisma.prospect.findFirst.mockResolvedValue(prospect);
    prisma.conversation.findUnique.mockResolvedValue(conversation);
    prisma.conversation.findFirst.mockResolvedValue(conversation);
    prisma.message.findUnique.mockResolvedValue(message);
    prisma.message.findFirst.mockResolvedValue(message);
    prisma.message.update.mockResolvedValue({ ...message, status: 'APPROVED' });
    prisma.message.updateMany.mockResolvedValue({ count: 1 });
    prisma.suppression.findFirst.mockResolvedValue(null);
    prisma.suppression.findUnique.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({ id: randomUUID() });
  }
});

afterAll(async () => {
  if (app) await app.close();
  vi.doUnmock('../src/lib/prisma.js');
});

function authorization() {
  const token = app.jwt.sign({ sub: username, type: 'access', jti: randomUUID() }, { expiresIn: '30m' });
  return { authorization: `Bearer ${token}` };
}

describe('autenticación mediante inject', () => {
  it('exige acceso y rechaza credenciales inválidas', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/prospects', remoteAddress: ip() });
    expect(anonymous.statusCode).toBe(401);

    const invalid = await app.inject({
      method: 'POST', url: '/auth/login', remoteAddress: ip(),
      payload: { username, password: 'incorrecta' },
    });
    expect(invalid.statusCode).toBe(401);
  });

  it('devuelve access y refresh tras un login correcto', async () => {
    const login = await app.inject({
      method: 'POST', url: '/auth/login', remoteAddress: ip(),
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toHaveProperty('accessToken');
    expect(login.json()).toHaveProperty('refreshToken');
  });

  it('rechaza usar refresh como token de acceso', async () => {
    const login = await app.inject({
      method: 'POST', url: '/auth/login', remoteAddress: ip(),
      payload: { username, password },
    });
    const denied = await app.inject({
      method: 'GET', url: '/prospects',
      headers: { authorization: `Bearer ${login.json().refreshToken}` },
      remoteAddress: ip(),
    });
    expect(denied.statusCode).toBe(401);
  });

  it('bloquea la IP en el quinto fallo', async () => {
    const remoteAddress = ip();
    for (let i = 0; i < 4; i++) {
      const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress, payload: { username, password: 'incorrecta' } });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress, payload: { username, password: 'incorrecta' } });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rota el refresh y impide reutilizarlo', async () => {
    const login = await app.inject({
      method: 'POST', url: '/auth/login', remoteAddress: ip(),
      payload: { username, password },
    });
    const { refreshToken } = login.json();
    expect(refreshToken).toBeTruthy();

    const rotated = await app.inject({ method: 'POST', url: '/auth/refresh', remoteAddress: ip(), payload: { refreshToken } });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().accessToken).toBeTruthy();
    expect(rotated.json().refreshToken).not.toBe(refreshToken);

    const reused = await app.inject({ method: 'POST', url: '/auth/refresh', remoteAddress: ip(), payload: { refreshToken } });
    expect(reused.statusCode).toBe(401);
  });

  it('valida el payload de login y renovación', async () => {
    const invalidLogin = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: ip(), payload: { username: '', password: '' } });
    expect(invalidLogin.statusCode).toBe(400);
    const invalidRefresh = await app.inject({ method: 'POST', url: '/auth/refresh', remoteAddress: ip(), payload: { refreshToken: '' } });
    expect(invalidRefresh.statusCode).toBe(400);
  });
});

describe('CRUD de prospectos', () => {
  it('crea un prospecto con los campos de negocio', async () => {
    db.prospect.create.mockResolvedValue(prospect);
    tx.prospect.create.mockResolvedValue(prospect);
    const payload = { businessName: prospect.businessName, category: prospect.category, address: prospect.address, city: prospect.city, state: prospect.state, email: prospect.email, phone: prospect.phone, status: prospect.status };
    const response = await app.inject({ method: 'POST', url: '/prospects', headers: authorization(), payload });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject(payload);
    expect([...db.prospect.create.mock.calls, ...tx.prospect.create.mock.calls]).toContainEqual([expect.objectContaining({ data: expect.objectContaining(payload) })]);
  });

  it('lista y obtiene por identificador', async () => {
    db.prospect.findMany.mockResolvedValue([prospect]);
    db.prospect.count.mockResolvedValue(1);
    const list = await app.inject({ method: 'GET', url: '/prospects', headers: authorization() });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).toContain(prospectId);
    const single = await app.inject({ method: 'GET', url: `/prospects/${prospectId}`, headers: authorization() });
    expect(single.statusCode).toBe(200);
    expect(single.json()).toMatchObject({ id: prospectId, businessName: prospect.businessName });
    db.prospect.findUnique.mockResolvedValue(null);
    db.prospect.findFirst.mockResolvedValue(null);
    const missing = await app.inject({ method: 'GET', url: `/prospects/${prospectId}`, headers: authorization() });
    expect(missing.statusCode).toBe(404);
  });

  it('actualiza el estado del prospecto', async () => {
    db.prospect.update.mockResolvedValue({ ...prospect, status: 'QUALIFIED' });
    tx.prospect.update.mockResolvedValue({ ...prospect, status: 'QUALIFIED' });
    const updated = await app.inject({ method: 'PATCH', url: `/prospects/${prospectId}`, headers: authorization(), payload: { status: 'QUALIFIED' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ status: 'QUALIFIED' });
    expect([...db.prospect.update.mock.calls, ...tx.prospect.update.mock.calls]).toContainEqual([expect.objectContaining({ where: { id: prospectId }, data: expect.objectContaining({ status: 'QUALIFIED' }) })]);
  });

  it('elimina el prospecto', async () => {
    db.prospect.delete.mockResolvedValue(prospect);
    tx.prospect.delete.mockResolvedValue(prospect);
    const deleted = await app.inject({ method: 'DELETE', url: `/prospects/${prospectId}`, headers: authorization() });
    expect(deleted.statusCode).toBe(204);
    expect([...db.prospect.delete.mock.calls, ...tx.prospect.delete.mock.calls]).toContainEqual([expect.objectContaining({ where: { id: prospectId } })]);
  });

  it('valida campos y filtra por estado, localidad y condición del sitio', async () => {
    db.prospect.findMany.mockResolvedValue([]);
    db.prospect.count.mockResolvedValue(0);
    const invalidUrl = await app.inject({ method: 'POST', url: '/prospects', headers: authorization(), payload: { businessName: 'Ejemplo', websiteUrl: 'no-es-url' } });
    expect(invalidUrl.statusCode).toBe(400);
    const invalidStatus = await app.inject({ method: 'PATCH', url: `/prospects/${prospectId}`, headers: authorization(), payload: { status: 'APPROVED' } });
    expect(invalidStatus.statusCode).toBe(400);
    const filtered = await app.inject({ method: 'GET', url: '/prospects?status=QUALIFIED&websiteStatus=SLOW&city=Madrid&page=2&limit=5', headers: authorization() });
    expect(filtered.statusCode).toBe(200);
    expect(db.prospect.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5, where: expect.objectContaining({ status: 'QUALIFIED', websiteStatus: 'SLOW', city: { equals: 'Madrid', mode: 'insensitive' } }) }));
  });
});

describe('aprobación de mensajes', () => {
  it('lista mensajes pendientes', async () => {
    db.message.findMany.mockResolvedValue([message]);
    db.message.count.mockResolvedValue(1);
    const response = await app.inject({ method: 'GET', url: '/approvals/pending', headers: authorization() });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).toContain(messageId);
    expect(db.message.findMany).toHaveBeenCalled();
  });

  it.each(['approve', 'reject'] as const)('registra %s y auditoría en una transacción', async (action) => {
    const decision = action === 'approve' ? 'APPROVED' : 'REJECTED';
    tx.message.update.mockResolvedValue({ ...message, status: decision });
    const response = await app.inject({ method: 'POST', url: `/approvals/${messageId}/${action}`, headers: authorization() });
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(300);
    expect(db.$transaction.mock.calls.some((args) => typeof args[0] === 'function')).toBe(true);
    const updates = [...tx.message.update.mock.calls, ...tx.message.updateMany.mock.calls];
    expect(updates.length).toBeGreaterThan(0);
    expect(JSON.stringify(updates)).toContain(decision);
    expect(JSON.stringify(updates)).toContain(messageId);
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).toContain(messageId);
    expect(db.message.update).not.toHaveBeenCalled();
    expect(db.message.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('impide aprobar un mensaje de un prospecto DO_NOT_CONTACT', async () => {
    const blockedProspect = { ...prospect, status: 'DO_NOT_CONTACT' };
    const blockedConversation = { ...conversation, prospect: blockedProspect };
    for (const prisma of [db, tx]) {
      prisma.prospect.findUnique.mockResolvedValue(blockedProspect);
      prisma.prospect.findFirst.mockResolvedValue(blockedProspect);
      prisma.conversation.findUnique.mockResolvedValue(blockedConversation);
      prisma.conversation.findFirst.mockResolvedValue(blockedConversation);
      prisma.message.findUnique.mockResolvedValue({ ...message, conversation: blockedConversation });
      prisma.message.findFirst.mockResolvedValue({ ...message, conversation: blockedConversation });
    }
    const response = await app.inject({ method: 'POST', url: `/approvals/${messageId}/approve`, headers: authorization() });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.statusCode).not.toBe(404);
    expect(db.message.findUnique.mock.calls.length + db.message.findFirst.mock.calls.length + tx.message.findUnique.mock.calls.length + tx.message.findFirst.mock.calls.length).toBeGreaterThan(0);
    expect(tx.message.update).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['email', 'phone'] as const)('impide aprobar si existe una supresión por %s', async (field) => {
    const suppressedProspect = { ...prospect, email: field === 'email' ? prospect.email : null, phone: field === 'phone' ? prospect.phone : null };
    const suppressedConversation = { ...conversation, prospect: suppressedProspect };
    for (const prisma of [db, tx]) {
      prisma.prospect.findUnique.mockResolvedValue(suppressedProspect);
      prisma.prospect.findFirst.mockResolvedValue(suppressedProspect);
      prisma.conversation.findUnique.mockResolvedValue(suppressedConversation);
      prisma.conversation.findFirst.mockResolvedValue(suppressedConversation);
      prisma.message.findUnique.mockResolvedValue({ ...message, conversation: suppressedConversation });
      prisma.message.findFirst.mockResolvedValue({ ...message, conversation: suppressedConversation });
      prisma.suppression.findFirst.mockResolvedValue({ id: randomUUID(), [field]: suppressedProspect[field] });
      prisma.suppression.findUnique.mockResolvedValue({ id: randomUUID(), [field]: suppressedProspect[field] });
    }
    const response = await app.inject({ method: 'POST', url: `/approvals/${messageId}/approve`, headers: authorization() });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.statusCode).not.toBe(404);
    expect(tx.message.update).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    const calls = [...db.suppression.findFirst.mock.calls, ...db.suppression.findUnique.mock.calls, ...tx.suppression.findFirst.mock.calls, ...tx.suppression.findUnique.mock.calls];
    expect(JSON.stringify(calls)).toContain(suppressedProspect[field]);
  });

  it('no decide mensajes inexistentes ni mensajes ya procesados', async () => {
    tx.message.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...message, status: 'SENT' });
    const missing = await app.inject({ method: 'POST', url: `/approvals/${messageId}/approve`, headers: authorization() });
    const processed = await app.inject({ method: 'POST', url: `/approvals/${messageId}/reject`, headers: authorization() });
    expect(missing.statusCode).toBe(404);
    expect(processed.statusCode).toBe(409);
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rechaza sin comprobar supresiones y solo modifica el estado', async () => {
    tx.message.findUnique.mockResolvedValue({ ...message, conversation: { ...conversation, prospect: { ...prospect, status: 'DO_NOT_CONTACT' } } });
    const result = await app.inject({ method: 'POST', url: `/approvals/${messageId}/reject`, headers: authorization() });
    expect(result.statusCode).toBe(200);
    expect(tx.message.updateMany).toHaveBeenCalledWith({ where: { id: messageId, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED' } });
    expect(tx.suppression.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('detecta decisiones concurrentes y reintenta los conflictos serializables', async () => {
    tx.message.updateMany.mockResolvedValue({ count: 0 });
    const conflict = await app.inject({ method: 'POST', url: `/approvals/${messageId}/approve`, headers: authorization() });
    expect(conflict.statusCode).toBe(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    db.$transaction.mockReset().mockRejectedValue({ code: 'P2034' });
    const retry = await app.inject({ method: 'POST', url: `/approvals/${messageId}/approve`, headers: authorization() });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('TRANSACTION_CONFLICT');
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('no expone las rutas antiguas de aprobación y supresión', async () => {
    const oldApproval = await app.inject({ method: 'POST', url: '/approvals', headers: authorization(), payload: {} });
    const oldSuppression = await app.inject({ method: 'POST', url: '/prospects/suppressions', headers: authorization(), payload: {} });
    expect(oldApproval.statusCode).toBe(404);
    expect(oldSuppression.statusCode).toBe(404);
  });
});
