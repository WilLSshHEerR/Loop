import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const username = 'propietario-discovery';
const password = randomBytes(24).toString('hex');
const prospectId = '00000000-0000-4000-8000-000000000301';

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
    JWT_SECRET: randomBytes(64).toString('hex'), GOOGLE_PLACES_API_KEY: 'test-key',
  });
  vi.doMock('../src/lib/prisma.js', () => ({ prisma: db }));
  vi.stubGlobal('fetch', vi.fn());
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
  tx.prospect.findUnique.mockResolvedValue(null);
  tx.prospect.create.mockResolvedValue({ id: prospectId, businessName: 'Dentista ficticio', googlePlaceId: 'place-test' });
  tx.auditLog.create.mockResolvedValue({ id: randomUUID() });
});

afterAll(async () => {
  if (app) await app.close();
  vi.unstubAllGlobals();
  vi.doUnmock('../src/lib/prisma.js');
});

function authorization() {
  return { authorization: `Bearer ${app.jwt.sign({ sub: username, type: 'access', jti: randomUUID() }, { expiresIn: '30m' })}` };
}

describe('descubrimiento Google Places', () => {
  it('rechaza entrada inválida sin llamar a Google', async () => {
    const response = await app.inject({
      method: 'POST', url: '/discovery/search', headers: authorization(),
      payload: { text: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('busca y guarda resultados sin recurrir a scraping', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ places: [{
      id: 'place-test', displayName: { text: 'Dentista ficticio' }, formattedAddress: 'Calle ejemplo',
      primaryTypeDisplayName: { text: 'Dentista' }, nationalPhoneNumber: '+52 55 0000 0000',
      websiteUri: 'https://example.invalid', googleMapsUri: 'https://maps.example.invalid', rating: 4.8,
      userRatingCount: 42,
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const response = await app.inject({
      method: 'POST', url: '/discovery/search', headers: authorization(),
      payload: { text: 'consultorio dental', city: 'CDMX', limit: 5 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe('GOOGLE_PLACES');
    expect(tx.prospect.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      googlePlaceId: 'place-test', source: 'GOOGLE_PLACES', contactChannelHint: 'EMAIL',
    }) }));
  });

  it('actualiza un place existente y registra auditoría', async () => {
    const existing = { id: prospectId, businessName: 'Nombre anterior', googlePlaceId: 'place-test', category: null, address: null, city: null, state: null, phone: null, websiteUrl: null, googleMapsUrl: null, rating: null, reviewsCount: null };
    tx.prospect.findUnique.mockResolvedValue(existing);
    tx.prospect.update.mockResolvedValue({ ...existing, businessName: 'Dentista ficticio' });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ places: [{
      id: 'place-test', displayName: { text: 'Dentista ficticio' }, rating: 4.5, userRatingCount: 20,
    }] }), { status: 200 }));

    const response = await app.inject({
      method: 'POST', url: '/discovery/search', headers: authorization(),
      payload: { text: 'dentista', city: 'CDMX' },
    });

    expect(response.statusCode).toBe(200);
    expect(tx.prospect.update).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'REFRESHED', entity: 'Prospect' }) }));
  });
});
