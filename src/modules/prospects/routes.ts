import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, email, empty, idParams, installErrorHandler, pageResult, pagination, parse, phone, serializable, text } from './shared.js';

const status = z.enum(['NEW', 'QUALIFIED', 'DRAFTED', 'PENDING_APPROVAL', 'CONTACTED', 'REPLIED', 'CALL_SCHEDULED', 'PROPOSAL_SENT', 'WON', 'LOST', 'DO_NOT_CONTACT']);
const websiteStatus = z.enum(['NONE', 'SLOW', 'NOT_MOBILE_FRIENDLY', 'OUTDATED', 'OK', 'UNKNOWN']);
const url = z.string().trim().max(2048).refine((value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Use an HTTP(S) URL');
const fields = {
  businessName: text(200), category: text(200).nullable().optional(), address: text(500).nullable().optional(),
  city: text(200).nullable().optional(), state: text(200).nullable().optional(),
  phone: phone.nullable().optional(), email: email.nullable().optional(),
  websiteUrl: url.nullable().optional(), googleMapsUrl: url.nullable().optional(), googlePlaceId: text(500).nullable().optional(),
  rating: z.number().finite().min(0).max(5).nullable().optional(), reviewsCount: z.number().int().min(0).max(2147483647).nullable().optional(),
  websiteStatus: websiteStatus.optional(), score: z.number().int().min(-2147483648).max(2147483647).optional(),
  status: status.optional(), source: text(500).nullable().optional(), notes: text(10000).nullable().optional(),
};
const createProspect = z.object(fields).strict();
const updateProspect = createProspect.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const listProspects = z.object({
  ...pagination, status: status.optional(), websiteStatus: websiteStatus.optional(),
  q: text(200).optional(), category: text(200).optional(), city: text(200).optional(), state: text(200).optional(),
  email: email.optional(), phone: phone.optional(),
}).strict();

export const prospectRoutes: FastifyPluginAsync = async (app) => {
  installErrorHandler(app);
  app.addHook('preHandler', async (request) => {
    if (request.method === 'GET' || request.method === 'DELETE') parse(empty, request.body ?? {});
  });

  app.post('/', async (request, reply) => {
    parse(empty, request.params); parse(empty, request.query);
    const data = parse(createProspect, request.body);
    const prospect = await prisma.prospect.create({ data });
    return reply.status(201).send(prospect);
  });

  app.get('/', async (request) => {
    parse(empty, request.params);
    const { page, limit, status, websiteStatus, q, category, city, state, email, phone } = parse(listProspects, request.query);
    const where = {
      ...(status && { status }), ...(websiteStatus && { websiteStatus }),
      ...(category && { category: { equals: category, mode: 'insensitive' as const } }),
      ...(city && { city: { equals: city, mode: 'insensitive' as const } }),
      ...(state && { state: { equals: state, mode: 'insensitive' as const } }),
      ...(email && { email: { equals: email, mode: 'insensitive' as const } }), ...(phone && { phone }),
      ...(q && { OR: [
        { businessName: { contains: q, mode: 'insensitive' as const } },
        { category: { contains: q, mode: 'insensitive' as const } },
        { city: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } },
      ] }),
    };
    const [items, total] = await prisma.$transaction([
      prisma.prospect.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      prisma.prospect.count({ where }),
    ]);
    return pageResult(items, total, page, limit);
  });

  app.get('/:id', async (request) => {
    const { id } = parse(idParams, request.params); parse(empty, request.query);
    const prospect = await prisma.prospect.findUnique({ where: { id } });
    if (!prospect) throw new ApiError(404, 'NOT_FOUND', 'Prospect not found');
    return prospect;
  });

  app.patch('/:id', async (request) => {
    const { id } = parse(idParams, request.params); parse(empty, request.query);
    const data = parse(updateProspect, request.body);
    return serializable((tx) => tx.prospect.update({ where: { id }, data }));
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params); parse(empty, request.query);
    await serializable((tx) => tx.prospect.delete({ where: { id } }));
    return reply.status(204).send();
  });
};