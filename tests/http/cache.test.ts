import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingService } from '../../src/application/bookingService';
import { FixedClock } from '../../src/domain/clock';
import { buildApp } from '../../src/http/app';
import { createRepositories, PgUnitOfWork } from '../../src/infrastructure/pgRepositories';
import { createValkeyClient, PLANNING_TTL_SECONDS, ValkeyPlanningCache } from '../../src/infrastructure/valkeyPlanningCache';
import { createTestPool, resetToSeed } from '../helpers/db';

const WEEK = '?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z';
const noWarn = () => {};

let pool: pg.Pool;
let valkey: Redis;
const apps: FastifyInstance[] = [];

function appWith(client: Redis): FastifyInstance {
  const app = buildApp(
    new BookingService({
      uow: new PgUnitOfWork(pool),
      reads: createRepositories(pool),
      cache: new ValkeyPlanningCache(client, noWarn),
      clock: new FixedClock(new Date('2026-11-02T09:00:00Z')),
      newId: randomUUID,
    }),
  );
  apps.push(app);
  return app;
}

async function clearPlanningKeys() {
  const keys = await valkey.keys('planning:*');
  if (keys.length) await valkey.del(...keys);
}

const planningIds = async (app: FastifyInstance, room = 'room-1') =>
  (await app.inject({ method: 'GET', url: `/rooms/${room}/bookings${WEEK}` })).json().map((b: { id: string }) => b.id);

beforeAll(() => {
  pool = createTestPool();
  valkey = new Redis(process.env.VALKEY_URL ?? 'redis://localhost:6379');
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await pool.end();
  valkey.disconnect();
});
beforeEach(async () => {
  await resetToSeed(pool);
  await clearPlanningKeys();
});

describe('cache du planning (Valkey)', () => {
  it('range la réponse sous une clé versionnée avec un TTL', async () => {
    const app = appWith(valkey);
    await planningIds(app);
    const keys = await valkey.keys('planning:room-1:v*');
    expect(keys).toEqual([`planning:room-1:v0:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z`]);
    const ttl = await valkey.ttl(keys[0]!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PLANNING_TTL_SECONDS);
  });

  it('sert la seconde lecture depuis le cache (PostgreSQL modifié en douce : réponse inchangée)', async () => {
    const app = appWith(valkey);
    expect(await planningIds(app)).toEqual(['booking-1']);
    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = 'booking-1'");
    expect(await planningIds(app)).toEqual(['booking-1']);
  });

  it('affiche immédiatement une nouvelle réservation', async () => {
    const app = appWith(valkey);
    expect(await planningIds(app)).toEqual(['booking-1']);
    const created = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/bookings',
      payload: { memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' },
    });
    expect(created.statusCode).toBe(201);
    expect(await planningIds(app)).toEqual(['booking-1', created.json().id]);
  });

  it('retire immédiatement une réservation annulée', async () => {
    const app = appWith(valkey);
    expect(await planningIds(app)).toEqual(['booking-1']);
    expect((await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })).statusCode).toBe(204);
    expect(await planningIds(app)).toEqual([]);
  });

  it('n’invalide que la salle concernée', async () => {
    const app = appWith(valkey);
    await planningIds(app, 'room-3');
    await app.inject({ method: 'DELETE', url: '/bookings/booking-1' });
    expect(await valkey.get('planning:room-3:version')).toBeNull();
    expect(await valkey.get('planning:room-1:version')).toBe('1');
  });

  it('une invalidation ratée (Valkey coupé puis revenu) ne ressuscite pas une entrée périmée', async () => {
    const app = appWith(valkey);
    expect(await planningIds(app)).toEqual(['booking-1']);

    // L'INCR échoue comme si Valkey était arrêté pendant l'annulation ; les entrées restent dans Valkey.
    vi.spyOn(valkey, 'incr').mockRejectedValueOnce(new Error('Valkey arrêté'));
    expect((await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })).statusCode).toBe(204);

    expect(await planningIds(app)).toEqual([]);
  });

  it('un nouveau démarrage de l\x27API purge les entrées laissées par une instance précédente', async () => {
    expect(await planningIds(appWith(valkey))).toEqual(['booking-1']);
    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = 'booking-1'");
    expect(await planningIds(appWith(valkey))).toEqual([]);
  });

  it('ne met pas en cache les erreurs (salle inconnue : 404)', async () => {
    const app = appWith(valkey);
    expect((await app.inject({ method: 'GET', url: `/rooms/room-9/bookings${WEEK}` })).statusCode).toBe(404);
    expect(await valkey.keys('planning:room-9:v*')).toEqual([]);
  });
});

describe('Valkey indisponible', () => {
  // Port fermé : même effet qu'un `docker compose stop valkey`.
  const dead = () => createValkeyClient('redis://127.0.0.1:1', noWarn);

  it('l’API répond depuis PostgreSQL : lecture, création et annulation', async () => {
    const client = dead();
    const app = appWith(client);

    const started = Date.now();
    const read = await app.inject({ method: 'GET', url: `/rooms/room-1/bookings${WEEK}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().map((b: { id: string }) => b.id)).toEqual(['booking-1']);

    const created = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/bookings',
      payload: { memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' },
    });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/rooms/room-1/bookings${WEEK}` })).json()).toHaveLength(2);

    expect((await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/rooms/room-1/bookings${WEEK}` })).json()).toHaveLength(1);

    expect(Date.now() - started).toBeLessThan(3000);
    client.disconnect();
  });
});
