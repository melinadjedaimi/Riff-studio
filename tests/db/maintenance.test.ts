import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingService } from '../../src/application/bookingService';
import { FixedClock } from '../../src/domain/clock';
import { RoomUnderMaintenance } from '../../src/domain/errors';
import { NoPlanningCache } from '../../src/infrastructure/noPlanningCache';
import { createRepositories, PgUnitOfWork } from '../../src/infrastructure/pgRepositories';
import { createTestPool, resetToSeed } from '../helpers/db';

let pool: pg.Pool;
let service: BookingService;

const book = (roomId: string, start: string, end: string) =>
  service.createBooking({ roomId, memberId: 'member-3', start: new Date(start), end: new Date(end) });

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

describe('règle 5 : maintenance (cas d’usage + données de départ)', () => {
  it('refuse room-4 entre le 5 et le 8 novembre', async () => {
    await expect(book('room-4', '2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z')).rejects.toThrow(RoomUnderMaintenance);
  });

  it('accepte room-4 la veille et le jour de la reprise', async () => {
    await expect(book('room-4', '2026-11-04T22:00:00Z', '2026-11-04T23:00:00Z')).resolves.toBeDefined();
    await expect(book('room-4', '2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z')).resolves.toBeDefined();
  });

  it('accepte room-1 aux mêmes dates', async () => {
    await expect(book('room-1', '2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z')).resolves.toBeDefined();
  });
});
