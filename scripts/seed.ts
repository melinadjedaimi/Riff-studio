import pg from 'pg';
import { seed } from '../src/infrastructure/seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquante (copiez .env.example vers .env)');

const pool = new pg.Pool({ connectionString: url });
try {
  await seed(pool);
  console.log('Données de départ insérées.');
} finally {
  await pool.end();
}
