import { existsSync } from 'node:fs';
import pg from 'pg';
import { seed } from '../../src/infrastructure/seed';

if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

/** Les tests utilisent leur propre base (<base>_test) pour ne pas toucher aux données de développement. */
export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl() });
}

/** Repart des données de départ de l'énoncé. */
export async function resetToSeed(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE bookings, members, rooms RESTART IDENTITY CASCADE');
  await seed(pool);
}
