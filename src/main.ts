import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { BookingService } from './application/bookingService';
import { SystemClock } from './domain/clock';
import { buildApp } from './http/app';
import { NoPlanningCache } from './infrastructure/noPlanningCache';
import { createRepositories, PgUnitOfWork } from './infrastructure/pgRepositories';
import { createValkeyClient, ValkeyPlanningCache } from './infrastructure/valkeyPlanningCache';

/** Point de composition : seul endroit qui connaît toutes les couches et lit l'heure réelle. */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL manquante (copiez .env.example vers .env)');

const pool = new pg.Pool({ connectionString: databaseUrl });

const warn = (message: string, err: unknown) => console.warn(`${message} : ${(err as Error).message || (err as Error).name}`);
const valkeyUrl = process.env.VALKEY_URL;
const valkey = valkeyUrl ? createValkeyClient(valkeyUrl, warn) : null;
if (!valkey) console.warn('VALKEY_URL absente : cache désactivé');

const service = new BookingService({
  uow: new PgUnitOfWork(pool),
  reads: createRepositories(pool),
  clock: new SystemClock(),
  cache: valkey ? new ValkeyPlanningCache(valkey, warn) : new NoPlanningCache(),
  newId: randomUUID,
});

const app = buildApp(service, { logger: true });

const shutdown = async () => {
  await app.close();
  valkey?.disconnect();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
