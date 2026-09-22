import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;

// Zero-setup mode: when no DATABASE_URL is configured (or USE_MEMORY_DB=true),
// run a real PostgreSQL compiled to WASM (PGlite) in-process. Data is persisted
// to backend/.localdb so it survives restarts. Set DATABASE_URL to use a normal
// Postgres/Supabase server instead.
const useMemory = !connectionString || process.env.USE_MEMORY_DB === 'true';

let queryImpl;
let endImpl;
let ready = Promise.resolve();

if (useMemory) {
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = path.join(__dirname, '.localdb');
  const db = new PGlite(dataDir);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  ready = db
    .exec(schema)
    .then(() => {
      console.log(`[db] Zero-setup mode: in-process PostgreSQL (PGlite) at ${dataDir}`);
      console.log('[db] Set DATABASE_URL in backend/.env to use a hosted Postgres instead.');
    })
    .catch((err) => {
      console.error('[db] Failed to initialize local database:', err.message);
      throw err;
    });

  queryImpl = async (text, params) => {
    await ready;
    const res = await db.query(text, params);
    // Normalize PGlite's result to match node-postgres (rows + rowCount).
    return {
      rows: res.rows || [],
      rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0),
    };
  };
  endImpl = () => db.close();
} else {
  const isHosted =
    !/localhost|127\.0\.0\.1/.test(connectionString) && process.env.PGSSL !== 'disable';

  const pool = new Pool({
    connectionString,
    ssl: isHosted ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    console.error('[db] Unexpected idle client error:', err.message);
  });

  // Auto-apply the schema on boot (idempotent: all CREATE/ALTER ... IF NOT EXISTS),
  // so a fresh hosted Postgres is provisioned with no manual step.
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  ready = pool
    .query(schema)
    .then(() => console.log('[db] Connected to hosted Postgres; schema applied.'))
    .catch((err) => {
      console.error('[db] Schema apply failed:', err.message);
      // Don't crash — tables may already exist from a prior boot.
    });

  queryImpl = async (text, params) => {
    await ready;
    return pool.query(text, params);
  };
  endImpl = () => pool.end();
}

export const dbReady = ready;
export const query = (text, params) => queryImpl(text, params);

// A minimal pool-like object so callers can `pool.query(...)` / `pool.end()`
// regardless of which backend is active.
export const pool = {
  query: (text, params) => queryImpl(text, params),
  end: () => endImpl(),
};
