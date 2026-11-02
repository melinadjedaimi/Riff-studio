import { Redis } from 'ioredis';
import type { Booking } from '../domain/booking';
import type { PlanningCache } from '../domain/ports';

/**
 * Cache du planning d'une salle (GET /rooms/:id/bookings), cache-aside dans Valkey.
 *
 * Clés :
 *   planning:{roomId}:version                       compteur entier, sans expiration
 *   planning:{roomId}:v{version}:{from}:{to}        réponse JSON, TTL 300 s
 *
 * Invalidation : INCR du compteur de la salle. Toutes les clés construites avec l'ancienne version
 * deviennent inatteignables d'un coup, sans SCAN ni KEYS ; elles expirent seules après le TTL.
 * La version est lue avant la lecture PostgreSQL : si une réservation est validée entre-temps,
 * le résultat périmé est rangé sous l'ancienne version, que plus personne ne lit.
 *
 * Valkey indisponible : l'INCR échoue et les entrées existantes restent valides aux yeux de Valkey, qui les
 * rendrait périmées à son retour. Un échec d'invalidation marque donc le cache « à purger » : la prochaine
 * lecture supprime toutes les entrées (jamais les compteurs) avant de s'en servir, et contourne le cache tant
 * que la purge échoue. Même marque au démarrage : l'API a pu être arrêtée pendant un échec.
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

/**
 * Client à échecs rapides : pas de file d'attente hors ligne, timeouts courts.
 * Valkey arrêté => erreur immédiate, que le cache attrape pour répondre depuis PostgreSQL.
 * La connexion se fait en arrière-plan : démarrer l'API ne dépend pas de Valkey.
 */
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

  /** Supprime les entrées de planning (planning:{salle}:v{n}:{from}:{to}), pas les compteurs de version. */
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
