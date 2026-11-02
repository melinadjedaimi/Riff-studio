import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BookingService } from '../application/bookingService';
import type { Booking } from '../domain/booking';
import type { Room } from '../domain/room';
import { errorHandler, type ErrorBody } from './errorMapping';

const isoDate = z.iso.datetime({ offset: true });

const createBookingBody = z.object({
  memberId: z.string().min(1),
  start: isoDate,
  end: isoDate,
});

const planningQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => new Date(q.from) < new Date(q.to), { message: 'from doit précéder to' });

/** 2026-11-04T14:00:00.000Z → 2026-11-04T14:00:00Z, comme dans le contrat. */
const toIso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

function bookingDto(b: Booking) {
  return {
    id: b.id,
    roomId: b.roomId,
    memberId: b.memberId,
    start: toIso(b.start),
    end: toIso(b.end),
    status: b.status,
  };
}

function roomDto(r: Room) {
  return {
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    maintenance: r.maintenance ? { start: toIso(r.maintenance.start), end: toIso(r.maintenance.end) } : null,
  };
}

/** Les handlers valident l'entrée, appellent un cas d'usage et formatent la réponse. Rien d'autre. */
export function buildApp(service: BookingService, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not_found', message: 'Route inconnue' } satisfies ErrorBody);
  });

  app.get('/rooms', async () => (await service.listRooms()).map(roomDto));

  app.get<{ Params: { id: string } }>('/rooms/:id/bookings', async (req) => {
    const { from, to } = planningQuery.parse(req.query);
    const planning = await service.getRoomPlanning(req.params.id, new Date(from), new Date(to));
    return planning.map(bookingDto);
  });

  app.post<{ Params: { id: string } }>('/rooms/:id/bookings', async (req, reply) => {
    const body = createBookingBody.parse(req.body);
    const booking = await service.createBooking({
      roomId: req.params.id,
      memberId: body.memberId,
      start: new Date(body.start),
      end: new Date(body.end),
    });
    return reply.code(201).header('Location', `/bookings/${booking.id}`).send(bookingDto(booking));
  });

  app.get<{ Params: { id: string } }>('/bookings/:id', async (req) =>
    bookingDto(await service.getBooking(req.params.id)),
  );

  app.delete<{ Params: { id: string } }>('/bookings/:id', async (req, reply) => {
    await service.cancelBooking(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/members/:id/bookings', async (req) =>
    (await service.listMemberBookings(req.params.id)).map(bookingDto),
  );

  return app;
}
