import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingService } from '../../src/application/bookingService';
import { FixedClock } from '../../src/domain/clock';
import { buildApp } from '../../src/http/app';
import { NoPlanningCache } from '../../src/infrastructure/noPlanningCache';
import { createRepositories, PgUnitOfWork } from '../../src/infrastructure/pgRepositories';
import { createTestPool, resetToSeed } from '../helpers/db';

let pool: pg.Pool;
let app: FastifyInstance;

const post = (roomId: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/rooms/${roomId}/bookings`, payload: payload as object });
const slot = (memberId: string, start: string, end: string) => ({ memberId, start, end });

beforeAll(async () => {
  pool = createTestPool();
  app = buildApp(
    new BookingService({
      uow: new PgUnitOfWork(pool),
      reads: createRepositories(pool),
      cache: new NoPlanningCache(),
      // Horloge de l'énoncé : lundi 2 novembre 2026, 9 h UTC.
      clock: new FixedClock(new Date('2026-11-02T09:00:00Z')),
      newId: randomUUID,
    }),
  );
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
// Chaque test repart des données de départ.
beforeEach(() => resetToSeed(pool));

describe('GET /rooms', () => {
  it('renvoie les 4 salles', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms' });
    expect(res.statusCode).toBe(200);
    const rooms = res.json();
    expect(rooms.map((r: { id: string }) => r.id)).toEqual(['room-1', 'room-2', 'room-3', 'room-4']);
    expect(rooms[0]).toEqual({ id: 'room-1', name: 'Salle Hendrix', capacity: 5, maintenance: null });
    expect(rooms[3].maintenance).toEqual({ start: '2026-11-05T00:00:00Z', end: '2026-11-08T00:00:00Z' });
  });
});

describe('POST /rooms/:id/bookings', () => {
  it('crée une réservation : 201, Location et forme du contrat', async () => {
    const res = await post('room-1', slot('member-3', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({
      id: expect.any(String),
      roomId: 'room-1',
      memberId: 'member-3',
      start: '2026-11-04T14:00:00Z',
      end: '2026-11-04T16:00:00Z',
      status: 'confirmed',
    });
    expect(res.headers.location).toBe(`/bookings/${body.id}`);

    const fetched = await app.inject({ method: 'GET', url: res.headers.location as string });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(body);
  });

  it('409 : member-1 a déjà 2 réservations à venir', async () => {
    const res = await post('room-1', slot('member-1', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('member_limit_reached');
  });

  it('409 : chevauche booking-1', async () => {
    const res = await post('room-1', slot('member-3', '2026-11-03T19:00:00Z', '2026-11-03T21:00:00Z'));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('slot_overlap');
  });

  it('201 : room-1 à 20 h le 3 novembre, bout à bout avec booking-1', async () => {
    const res = await post('room-1', slot('member-3', '2026-11-03T20:00:00Z', '2026-11-03T22:00:00Z'));
    expect(res.statusCode).toBe(201);
  });

  it('409 : room-4 en maintenance entre le 5 et le 8 novembre', async () => {
    const res = await post('room-4', slot('member-3', '2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z'));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('room_under_maintenance');
  });

  it.each([
    ['durée de 5 h', slot('member-3', '2026-11-04T14:00:00Z', '2026-11-04T19:00:00Z')],
    ['début à 9 h', slot('member-3', '2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z')],
    ['minutes non nulles', slot('member-3', '2026-11-04T14:30:00Z', '2026-11-04T16:30:00Z')],
    ['date invalide', slot('member-3', 'demain', '2026-11-04T16:00:00Z')],
    ['memberId manquant', { start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' }],
    ['corps vide', {}],
  ])('400 : %s', async (_label, payload) => {
    const res = await post('room-1', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String), message: expect.any(String) });
  });

  it('400 : JSON malformé', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/bookings',
      headers: { 'content-type': 'application/json' },
      payload: '{pas du json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 : salle inconnue', async () => {
    const res = await post('room-9', slot('member-3', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'));
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('room_not_found');
  });

  it('404 : membre inconnu', async () => {
    const res = await post('room-1', slot('member-9', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'));
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('member_not_found');
  });

  it('deux requêtes simultanées sur le même créneau : un 201 et un 409', async () => {
    const [a, b] = await Promise.all([
      post('room-1', slot('member-3', '2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z')),
      post('room-1', slot('member-2', '2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z')),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM bookings WHERE room_id = 'room-1' AND start_at = '2026-11-06T14:00:00Z'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('trois créations simultanées du même membre sur des créneaux distincts : deux 201, un 409', async () => {
    const results = await Promise.all(
      [10, 12, 14].map((h) => post('room-1', slot('member-3', `2026-11-06T${h}:00:00Z`, `2026-11-06T${h + 1}:00:00Z`))),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 201, 409]);
  });
});

describe('DELETE /bookings/:id', () => {
  const statusOf = async (id: string) => (await app.inject({ method: 'GET', url: `/bookings/${id}` })).json().status;

  it('204 puis late_cancelled pour booking-3 (début dans moins de 24 h)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-3' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await statusOf('booking-3')).toBe('late_cancelled');
  });

  it('204 puis cancelled pour booking-2', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/bookings/booking-2' })).statusCode).toBe(204);
    expect(await statusOf('booking-2')).toBe('cancelled');
  });

  it('409 à la seconde annulation', async () => {
    await app.inject({ method: 'DELETE', url: '/bookings/booking-2' });
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-2' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_cancelled');
  });

  it('404 pour une réservation inconnue', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/bookings/nope' })).statusCode).toBe(404);
  });

  it('libère le créneau et le quota du membre', async () => {
    await app.inject({ method: 'DELETE', url: '/bookings/booking-1' });
    const res = await post('room-2', slot('member-1', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'));
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /bookings/:id', () => {
  it('200 pour booking-1', async () => {
    const res = await app.inject({ method: 'GET', url: '/bookings/booking-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'booking-1',
      roomId: 'room-1',
      memberId: 'member-1',
      start: '2026-11-03T18:00:00Z',
      end: '2026-11-03T20:00:00Z',
      status: 'confirmed',
    });
  });

  it('404 pour un id inconnu', async () => {
    const res = await app.inject({ method: 'GET', url: '/bookings/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('booking_not_found');
  });
});

describe('GET /members/:id/bookings', () => {
  it('200 avec les réservations de member-1', async () => {
    const res = await app.inject({ method: 'GET', url: '/members/member-1/bookings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((b: { id: string }) => b.id)).toEqual(['booking-1', 'booking-2']);
  });

  it('200 avec une liste vide pour member-3', async () => {
    const res = await app.inject({ method: 'GET', url: '/members/member-3/bookings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('404 pour un membre inconnu', async () => {
    expect((await app.inject({ method: 'GET', url: '/members/member-9/bookings' })).statusCode).toBe(404);
  });
});

describe('GET /rooms/:id/bookings?from=&to=', () => {
  const planning = (roomId: string, query: string) =>
    app.inject({ method: 'GET', url: `/rooms/${roomId}/bookings${query}` });

  it('200 : planning de la semaine de room-1', async () => {
    const res = await planning('room-1', '?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((b: { id: string }) => b.id)).toEqual(['booking-1']);
  });

  it('200 : exclut ce qui est hors fenêtre et trie par début', async () => {
    await post('room-3', slot('member-3', '2026-11-10T10:00:00Z', '2026-11-10T12:00:00Z'));
    const res = await planning('room-3', '?from=2026-11-10T00:00:00Z&to=2026-11-11T00:00:00Z');
    expect(res.json().map((b: { start: string }) => b.start)).toEqual(['2026-11-10T10:00:00Z', '2026-11-10T14:00:00Z']);
    const empty = await planning('room-3', '?from=2026-11-11T00:00:00Z&to=2026-11-12T00:00:00Z');
    expect(empty.json()).toEqual([]);
  });

  it('n’affiche pas les réservations annulées', async () => {
    await app.inject({ method: 'DELETE', url: '/bookings/booking-1' });
    const res = await planning('room-1', '?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z');
    expect(res.json()).toEqual([]);
  });

  it('404 : salle inconnue', async () => {
    expect((await planning('room-9', '?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z')).statusCode).toBe(404);
  });

  it.each([
    ['from manquant', '?to=2026-11-09T00:00:00Z'],
    ['to manquant', '?from=2026-11-02T00:00:00Z'],
    ['aucun paramètre', ''],
    ['date invalide', '?from=hier&to=2026-11-09T00:00:00Z'],
    ['from après to', '?from=2026-11-09T00:00:00Z&to=2026-11-02T00:00:00Z'],
  ])('400 : %s', async (_label, query) => {
    expect((await planning('room-1', query)).statusCode).toBe(400);
  });
});

describe('route inconnue', () => {
  it('404 avec le corps d’erreur homogène', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: expect.any(String) });
  });
});
