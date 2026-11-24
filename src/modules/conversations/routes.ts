import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  ApiError,
  empty,
  installErrorHandler,
  pageResult,
  pagination,
  parse,
  serializable,
  text,
  uuid,
} from '../prospects/shared.js';

const channel = z.enum(['EMAIL', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM']);
const messageDirection = z.enum(['IN', 'OUT']);
const messageStatus = z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'FAILED']);

const createConversation = z.object({
  prospectId: uuid,
  channel,
  status: text(100).optional(),
}).strict();

const updateConversation = z.object({
  channel: channel.optional(),
  status: text(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const listConversations = z.object({
  ...pagination,
  prospectId: uuid.optional(),
  channel: channel.optional(),
  status: text(100).optional(),
  q: text(200).optional(),
}).strict();

const createMessage = z.object({
  direction: messageDirection,
  subject: text(500).nullable().optional(),
  body: text(20000),
  aiGenerated: z.boolean().optional(),
}).strict();

const updateMessage = z.object({
  direction: messageDirection.optional(),
  subject: text(500).nullable().optional(),
  body: text(20000).optional(),
  aiGenerated: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const listMessages = z.object({
  ...pagination,
  status: messageStatus.optional(),
  direction: messageDirection.optional(),
  q: text(200).optional(),
}).strict();

const conversationParams = z.object({ conversationId: uuid }).strict();
const messageParams = z.object({ messageId: uuid }).strict();

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  installErrorHandler(app);

  app.post('/', async (request, reply) => {
    parse(empty, request.params);
    parse(empty, request.query);
    const data = parse(createConversation, request.body);

    const conversation = await serializable(async (tx) => {
      const prospect = await tx.prospect.findUnique({ where: { id: data.prospectId } });
      if (!prospect) throw new ApiError(404, 'NOT_FOUND', 'Prospect not found');

      const created = await tx.conversation.create({
        data: { prospectId: data.prospectId, channel: data.channel, status: data.status ?? 'OPEN' },
        include: { prospect: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'CREATED',
          entity: 'Conversation',
          entityId: created.id,
          metadata: { prospectId: data.prospectId, channel: data.channel, status: created.status },
        },
      });
      return created;
    });

    return reply.status(201).send(conversation);
  });

  app.get('/', async (request) => {
    parse(empty, request.params);
    const { page, limit, prospectId, channel, status, q } = parse(listConversations, request.query);
    const where = {
      ...(prospectId && { prospectId }),
      ...(channel && { channel }),
      ...(status && { status: { equals: status, mode: 'insensitive' as const } }),
      ...(q && { prospect: {
        OR: [
          { businessName: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
          { phone: { contains: q } },
        ],
      } }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where,
        include: { prospect: true, _count: { select: { messages: true } } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.conversation.count({ where }),
    ]);
    return pageResult(items, total, page, limit);
  });

  app.get('/:conversationId', async (request) => {
    const { conversationId } = parse(conversationParams, request.params);
    parse(empty, request.query);
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { prospect: true, messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
    return conversation;
  });

  app.patch('/:conversationId', async (request) => {
    const { conversationId } = parse(conversationParams, request.params);
    parse(empty, request.query);
    const data = parse(updateConversation, request.body);

    return serializable(async (tx) => {
      const conversation = await tx.conversation.update({
        where: { id: conversationId },
        data,
        include: { prospect: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'UPDATED',
          entity: 'Conversation',
          entityId: conversationId,
          metadata: data,
        },
      });
      return conversation;
    });
  });

  app.delete('/:conversationId', async (request, reply) => {
    const { conversationId } = parse(conversationParams, request.params);
    parse(empty, request.query);

    await serializable(async (tx) => {
      const conversation = await tx.conversation.delete({ where: { id: conversationId } });
      await tx.auditLog.create({
        data: {
          action: 'DELETED',
          entity: 'Conversation',
          entityId: conversationId,
          metadata: { prospectId: conversation.prospectId, channel: conversation.channel },
        },
      });
    });
    return reply.status(204).send();
  });

  app.get('/:conversationId/messages', async (request) => {
    const { conversationId } = parse(conversationParams, request.params);
    const { page, limit, status, direction, q } = parse(listMessages, request.query);

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');

    const where = {
      conversationId,
      ...(status && { status }),
      ...(direction && { direction }),
      ...(q && { OR: [
        { subject: { contains: q, mode: 'insensitive' as const } },
        { body: { contains: q, mode: 'insensitive' as const } },
      ] }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.message.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      prisma.message.count({ where }),
    ]);
    return pageResult(items, total, page, limit);
  });

  app.post('/:conversationId/messages', async (request, reply) => {
    const { conversationId } = parse(conversationParams, request.params);
    parse(empty, request.query);
    const data = parse(createMessage, request.body);

    const message = await serializable(async (tx) => {
      const conversation = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');

      const created = await tx.message.create({
        data: {
          conversationId,
          direction: data.direction,
          subject: data.subject ?? null,
          body: data.body,
          status: 'DRAFT',
          aiGenerated: data.aiGenerated ?? false,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'CREATED',
          entity: 'Message',
          entityId: created.id,
          metadata: { conversationId, direction: created.direction, status: created.status },
        },
      });
      return created;
    });

    return reply.status(201).send(message);
  });

  app.patch('/:conversationId/messages/:messageId', async (request) => {
    const params = z.object({ conversationId: uuid, messageId: uuid }).strict();
    const { conversationId, messageId } = parse(params, request.params);
    parse(empty, request.query);
    const data = parse(updateMessage, request.body);

    return serializable(async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId, conversationId },
      });
      if (!message) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
      if (message.status !== 'DRAFT') {
        throw new ApiError(409, 'INVALID_STATUS', 'Only draft messages can be updated');
      }

      const updated = await tx.message.update({ where: { id: messageId }, data });
      await tx.auditLog.create({
        data: {
          action: 'UPDATED',
          entity: 'Message',
          entityId: messageId,
          metadata: data,
        },
      });
      return updated;
    });
  });

  app.post('/:conversationId/messages/:messageId/request-approval', async (request) => {
    const params = z.object({ conversationId: uuid, messageId: uuid }).strict();
    const { conversationId, messageId } = parse(params, request.params);
    parse(empty, request.query);

    return serializable(async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId, conversationId },
        include: { conversation: { include: { prospect: true } } },
      });
      if (!message) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
      if (message.status !== 'DRAFT') {
        throw new ApiError(409, 'INVALID_STATUS', 'Only draft messages can request approval');
      }

      const updated = await tx.message.update({
        where: { id: messageId },
        data: { status: 'PENDING_APPROVAL' },
      });
      await tx.auditLog.create({
        data: {
          action: 'REQUEST_APPROVAL',
          entity: 'Message',
          entityId: messageId,
          metadata: { conversationId, prospectId: message.conversation.prospectId, previousStatus: 'DRAFT', status: 'PENDING_APPROVAL' },
        },
      });
      return updated;
    });
  });

  app.post('/messages/:messageId/request-approval', async (request) => {
    const { messageId } = parse(messageParams, request.params);
    parse(empty, request.query);
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
    if (message.status !== 'DRAFT') throw new ApiError(409, 'INVALID_STATUS', 'Only draft messages can request approval');

    const updated = await serializable(async (tx) => {
      const current = await tx.message.updateMany({
        where: { id: messageId, status: 'DRAFT' },
        data: { status: 'PENDING_APPROVAL' },
      });
      if (current.count !== 1) throw new ApiError(409, 'INVALID_STATUS', 'Only draft messages can request approval');

      await tx.auditLog.create({
        data: {
          action: 'REQUEST_APPROVAL', entity: 'Message', entityId: messageId,
          metadata: { conversationId: message.conversationId, previousStatus: 'DRAFT', status: 'PENDING_APPROVAL' },
        },
      });
      return tx.message.findUnique({ where: { id: messageId } });
    });
    return updated;
  });
};
