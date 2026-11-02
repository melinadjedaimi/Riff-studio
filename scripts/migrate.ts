import pg from 'pg';
import { migrate } from '../src/infrastructure/migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquante (copiez .env.example vers .env)');

const pool = new pg.Pool({ connectionString: url });
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
} finally {
  await pool.end();
}
