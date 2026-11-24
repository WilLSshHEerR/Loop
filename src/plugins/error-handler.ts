import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '../modules/prospects/shared.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ZodError) {
    void reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Datos de entrada inválidos.' } });
    return;
  }
  if (error instanceof ApiError) {
    void reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error.code === 'P2002') {
    void reply.code(409).send({ error: { code: 'CONFLICT', message: 'Ya existe un registro con ese valor.' } });
    return;
  }
  if (error.code === 'P2025') {
    void reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Registro no encontrado.' } });
    return;
  }
  if (error.statusCode === 429) {
    void reply.code(429).send({ error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas solicitudes. Inténtalo más tarde.' } });
    return;
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    void reply.code(error.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'Solicitud inválida.' } });
    return;
  }
  request.log.error('Error interno al procesar la solicitud');
  void reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } });
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(errorHandler);
  // Existing modules install scoped handlers that log raw errors. Route-level
  // handlers take precedence and keep error handling consistent and safe.
  app.addHook('onRoute', (route) => { route.errorHandler = errorHandler; });
  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
  });
}