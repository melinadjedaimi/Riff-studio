import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../domain/errors';

/** Erreurs du domaine → codes HTTP. */
const STATUS_BY_CODE: Record<string, number> = {
  invalid_slot: 400,
  room_not_found: 404,
  member_not_found: 404,
  booking_not_found: 404,
  slot_overlap: 409,
  member_limit_reached: 409,
  room_under_maintenance: 409,
  already_cancelled: 409,
};

export interface ErrorBody {
  error: string;
  message: string;
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof DomainError) {
    const status = STATUS_BY_CODE[err.code] ?? 500;
    reply.code(status).send({ error: err.code, message: err.message } satisfies ErrorBody);
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'corps'} : ${i.message}`).join(' ; ');
    reply.code(400).send({ error: 'invalid_request', message } satisfies ErrorBody);
    return;
  }
  // Erreurs 4xx de Fastify (JSON malformé, etc.).
  const statusCode = (err as FastifyError).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    reply.code(statusCode).send({ error: 'bad_request', message: err.message } satisfies ErrorBody);
    return;
  }
  req.log.error(err);
  reply.code(500).send({ error: 'internal_error', message: 'Erreur interne' } satisfies ErrorBody);
}
