import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingService } from '../../src/application/bookingService';
import { FixedClock } from '../../src/domain/clock';
import { MemberLimitReached } from '../../src/domain/errors';
import { createRepositories, PgUnitOfWork } from '../../src/infrastructure/pgRepositories';
import { createTestPool, resetToSeed } from '../helpers/db';

let pool: pg.Pool;
let service: BookingService;

const input = (memberId: string, roomId: string, start: string, end: string) => ({
  roomId,
  memberId,
  start: new Date(start),
  end: new Date(end),
});

beforeAll(() => {
  pool = createTestPool();
  service = new BookingService({
    uow: new PgUnitOfWork(pool),
    reads: createRepositories(pool),
    clock: new FixedClock(new Date('2026-11-02T09:00:00Z')),
    newId: randomUUID,
  });
});
afterAll(() => pool.end());
beforeEach(() => resetToSeed(pool));

describe('règle 3 : limite de 2 réservations à venir (cas d’usage + base)', () => {
  it('refuse member-1, qui a déjà 2 réservations à venir', async () => {
    await expect(
      service.createBooking(input('member-1', 'room-1', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z')),
    ).rejects.toThrow(MemberLimitReached);
  });

  it('accepte member-3, qui n’en a aucune', async () => {
    const booking = await service.createBooking(
      input('member-3', 'room-1', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'),
    );
    expect(booking.status).toBe('confirmed');
  });

  it('tient la limite quand un même membre envoie 6 créations simultanées', async () => {
    // 6 créneaux distincts (aucun chevauchement) : seul le verrou sur le membre peut limiter à 2.
    const starts = [10, 12, 14, 16, 18, 20];
    const results = await Promise.allSettled(
      starts.map((h) =>
        service.createBooking(
          input('member-3', 'room-1', `2026-11-05T${h}:00:00Z`, `2026-11-05T${h + 1}:00:00Z`),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(4);
    expect(rejected.every((r) => r.reason instanceof MemberLimitReached)).toBe(true);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM bookings WHERE member_id = 'member-3'");
    expect(rows[0].n).toBe(2);
  });
});
