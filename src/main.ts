import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { BookingService } from './application/bookingService';
import { SystemClock } from './domain/clock';
import { buildApp } from './http/app';
import { createRepositories, PgUnitOfWork } from './infrastructure/pgRepositories';

/** Point de composition : seul endroit qui connaît toutes les couches et lit l'heure réelle. */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL manquante (copiez .env.example vers .env)');

const pool = new pg.Pool({ connectionString: databaseUrl });
const service = new BookingService({
  uow: new PgUnitOfWork(pool),
  reads: createRepositories(pool),
  clock: new SystemClock(),
  newId: randomUUID,
});

const app = buildApp(service, { logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
