import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingService } from '../../src/application/bookingService';
import { FixedClock } from '../../src/domain/clock';
import { AlreadyCancelled, BookingNotFound } from '../../src/domain/errors';
import { NoPlanningCache } from '../../src/infrastructure/noPlanningCache';
import { createRepositories, PgUnitOfWork } from '../../src/infrastructure/pgRepositories';
import { createTestPool, resetToSeed } from '../helpers/db';

let pool: pg.Pool;
let service: BookingService;

beforeAll(() => {
  pool = createTestPool();
  service = new BookingService({
    uow: new PgUnitOfWork(pool),
    reads: createRepositories(pool),
    cache: new NoPlanningCache(),
    clock: new FixedClock(new Date('2026-11-02T09:00:00Z')),
    newId: randomUUID,
  });
});
afterAll(() => pool.end());
beforeEach(() => resetToSeed(pool));

const statusOf = async (id: string) =>
  (await pool.query('SELECT status, cancelled_at FROM bookings WHERE id = $1', [id])).rows[0];

describe('règle 4 : annulation (cas d’usage + base)', () => {
  it('annule booking-3 (dans moins de 24 h) en late_cancelled et garde la ligne', async () => {
    const result = await service.cancelBooking('booking-3');
    expect(result.status).toBe('late_cancelled');
    const row = await statusOf('booking-3');
    expect(row.status).toBe('late_cancelled');
    expect(row.cancelled_at).toBeInstanceOf(Date);
  });

  it('annule booking-2 (dans 8 jours) en cancelled', async () => {
    expect((await service.cancelBooking('booking-2')).status).toBe('cancelled');
    expect((await statusOf('booking-2')).status).toBe('cancelled');
  });

  it('refuse la seconde annulation', async () => {
    await service.cancelBooking('booking-2');
    await expect(service.cancelBooking('booking-2')).rejects.toThrow(AlreadyCancelled);
  });

  it('signale une réservation inconnue', async () => {
    await expect(service.cancelBooking('nope')).rejects.toThrow(BookingNotFound);
  });

  it('une seule de deux annulations simultanées réussit', async () => {
    const results = await Promise.allSettled([service.cancelBooking('booking-2'), service.cancelBooking('booking-2')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected[0]?.reason).toBeInstanceOf(AlreadyCancelled);
  });

  it('libère le créneau pour une nouvelle réservation', async () => {
    await service.cancelBooking('booking-1');
    const created = await service.createBooking({
      roomId: 'room-1',
      memberId: 'member-3',
      start: new Date('2026-11-03T18:00:00Z'),
      end: new Date('2026-11-03T20:00:00Z'),
    });
    expect(created.status).toBe('confirmed');
  });
});
