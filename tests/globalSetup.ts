import pg from 'pg';
import { migrate } from '../src/infrastructure/migrate';
import { createTestPool, testDatabaseUrl } from './helpers/db';

/** Crée la base de test si besoin et applique les migrations. */
export default async function setup(): Promise<void> {
  const testName = new URL(testDatabaseUrl()).pathname.slice(1);
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${testName}"`);
  } finally {
    await admin.end();
  }
  const pool = createTestPool();
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
