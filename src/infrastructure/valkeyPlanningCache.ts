import { Redis } from 'ioredis';
import type { Booking } from '../domain/booking';
import type { PlanningCache } from '../domain/ports';

/**
 * Cache du planning. Clés : planning:{salle}:version (compteur) et planning:{salle}:v{n}:{from}:{to} (TTL 300 s).
 * Invalider = INCR du compteur. Si l'INCR échoue (Valkey arrêté), on purge les entrées à la prochaine lecture.
 */
export const PLANNING_TTL_SECONDS = 300;

type Warn = (message: string, err: unknown) => void;

interface CachedBooking {
  id: string;
  roomId: string;
  memberId: string;
  start: string;
  end: string;
  status: Booking['status'];
}

const versionKey = (roomId: string) => `planning:${roomId}:version`;

const serialize = (bookings: Booking[]): string =>
  JSON.stringify(
    bookings.map(
      (b): CachedBooking => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() }),
    ),
  );

const parse = (raw: string): Booking[] =>
  (JSON.parse(raw) as CachedBooking[]).map((b) => ({ ...b, start: new Date(b.start), end: new Date(b.end) }));

/** Client qui échoue vite : pas de file d'attente hors ligne, timeouts courts. */
export function createValkeyClient(url: string, warn: Warn): Redis {
  const client = new Redis(url, {
    connectTimeout: 500,
    commandTimeout: 250,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
  let lastLogged = 0;
  client.on('error', (err) => {
    const now = Date.now();
    if (now - lastLogged > 10_000) {
      lastLogged = now;
      warn('Valkey indisponible, repli sur PostgreSQL', err);
    }
  });
  return client;
}

export class ValkeyPlanningCache implements PlanningCache {
  private needsPurge = true;
  private purging: Promise<void> | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly warn: Warn,
    private readonly ttlSeconds = PLANNING_TTL_SECONDS,
  ) {}

  async remember(roomId: string, from: Date, to: Date, load: () => Promise<Booking[]>): Promise<Booking[]> {
    let key: string | null = null;
    try {
      await this.purgeIfNeeded();
      const version = (await this.redis.get(versionKey(roomId))) ?? '0';
      key = `planning:${roomId}:v${version}:${from.toISOString()}:${to.toISOString()}`;
      const cached = await this.redis.get(key);
      if (cached !== null) return parse(cached);
    } catch (err) {
      this.warn('Lecture du cache impossible', err);
      key = null;
    }

    const bookings = await load();

    if (key) {
      try {
        await this.redis.set(key, serialize(bookings), 'EX', this.ttlSeconds);
      } catch (err) {
        this.warn('Écriture du cache impossible', err);
      }
    }
    return bookings;
  }

  async invalidateRoom(roomId: string): Promise<void> {
    try {
      await this.redis.incr(versionKey(roomId));
    } catch (err) {
      this.needsPurge = true;
      this.warn('Invalidation du cache impossible', err);
    }
  }

  private purgeIfNeeded(): Promise<void> {
    if (!this.needsPurge) return Promise.resolve();
    this.purging ??= this.deleteEntries()
      .catch((err: unknown) => {
        this.needsPurge = true;
        throw err;
      })
      .finally(() => {
        this.purging = null;
      });
    return this.purging;
  }

  /** Supprime les entrées, pas les compteurs de version. */
  private async deleteEntries(): Promise<void> {
    this.needsPurge = false;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'planning:*:v*:*', 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.redis.del(...keys);
    } while (cursor !== '0');
  }
}
