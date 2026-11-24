import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, empty, installErrorHandler, pageResult, pagination, parse, serializable, uuid } from '../prospects/shared.js';

const messageParams = z.object({ messageId: uuid }).strict();
const listPending = z.object({ ...pagination }).strict();

export const approvalRoutes: FastifyPluginAsync = async (app) => {
  installErrorHandler(app);

  app.get('/pending', async (request) => {
    parse(empty, request.params); parse(empty, request.body ?? {});
    const { page, limit } = parse(listPending, request.query);
    const where = { status: 'PENDING_APPROVAL' as const };
    const [items, total] = await prisma.$transaction([
      prisma.message.findMany({
        where, include: { conversation: { include: { prospect: true } } },
        skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.message.count({ where }),
    ]);
    return pageResult(items, total, page, limit);
  });

  async function decide(messageId: string, decision: 'APPROVED' | 'REJECTED') {
    return serializable(async (tx) => {
      const message = await tx.message.findUnique({
        where: { id: messageId }, include: { conversation: { include: { prospect: true } } },
      });
      if (!message) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
      if (message.status !== 'PENDING_APPROVAL') throw new ApiError(409, 'INVALID_STATUS', 'Message must be pending approval');
      const prospect = message.conversation.prospect;
      if (decision === 'APPROVED') {
        if (prospect.status === 'DO_NOT_CONTACT') throw new ApiError(409, 'DO_NOT_CONTACT', 'Prospect must not be contacted');
        const contacts = [
          ...(prospect.email ? [{ email: { equals: prospect.email, mode: 'insensitive' as const } }] : []),
          ...(prospect.phone ? [{ phone: prospect.phone }] : []),
        ];
        if (contacts.length && await tx.suppression.findFirst({ where: { OR: contacts } })) {
          throw new ApiError(409, 'SUPPRESSED', 'Prospect matches a suppression');
        }
      }
      const updated = await tx.message.updateMany({ where: { id: messageId, status: 'PENDING_APPROVAL' }, data: { status: decision } });
      if (updated.count !== 1) throw new ApiError(409, 'INVALID_STATUS', 'Message must be pending approval');
      await tx.auditLog.create({ data: {
        action: decision, entity: 'Message', entityId: messageId,
        metadata: { prospectId: prospect.id, previousStatus: 'PENDING_APPROVAL', status: decision },
      } });
      return { ...message, status: decision };
    });
  }

  app.post('/:messageId/approve', async (request) => {
    const { messageId } = parse(messageParams, request.params);
    parse(empty, request.query); parse(empty, request.body ?? {});
    return decide(messageId, 'APPROVED');
  });

  app.post('/:messageId/reject', async (request) => {
    const { messageId } = parse(messageParams, request.params);
    parse(empty, request.query); parse(empty, request.body ?? {});
    return decide(messageId, 'REJECTED');
  });
};