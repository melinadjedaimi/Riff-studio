import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Booking } from '../../src/domain/booking';
import { SlotOverlap } from '../../src/domain/errors';
import { PgBookingRepository } from '../../src/infrastructure/pgBookingRepository';
import { createTestPool, resetToSeed } from '../helpers/db';

let pool: pg.Pool;
let repo: PgBookingRepository;

const booking = (id: string, start: string, end: string, overrides: Partial<Booking> = {}): Booking => ({
  id,
  roomId: 'room-1',
  memberId: 'member-3',
  start: new Date(start),
  end: new Date(end),
  status: 'confirmed',
  ...overrides,
});

beforeAll(() => {
  pool = createTestPool();
  repo = new PgBookingRepository(pool);
});
afterAll(() => pool.end());
beforeEach(() => resetToSeed(pool));

describe('règle 2 : contrainte d’exclusion en base', () => {
  it('refuse un chevauchement (code 23P01 traduit en SlotOverlap)', async () => {
    // booking-1 : room-1, 3 nov. 18 h → 20 h
    await expect(repo.insert(booking('x', '2026-11-03T19:00:00Z', '2026-11-03T21:00:00Z'))).rejects.toThrow(SlotOverlap);
  });

  it('accepte un créneau bout à bout (début = fin du précédent)', async () => {
    await expect(repo.insert(booking('x', '2026-11-03T20:00:00Z', '2026-11-03T22:00:00Z'))).resolves.toBeUndefined();
  });

  it('autorise le même créneau dans une autre salle', async () => {
    await expect(
      repo.insert(booking('x', '2026-11-03T18:00:00Z', '2026-11-03T20:00:00Z', { roomId: 'room-2' })),
    ).resolves.toBeUndefined();
  });

  it('ne tient pas compte des réservations annulées', async () => {
    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = 'booking-1'");
    await expect(repo.insert(booking('x', '2026-11-03T18:00:00Z', '2026-11-03T20:00:00Z'))).resolves.toBeUndefined();
  });

  it('garantit un seul gagnant entre deux insertions simultanées, sans passer par le domaine', async () => {
    const attempts = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      repo.insert(booking(id, '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z')).then(
        () => 'ok',
        (err: unknown) => (err instanceof SlotOverlap ? 'overlap' : 'error'),
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'overlap')).toHaveLength(4);
  });
});
