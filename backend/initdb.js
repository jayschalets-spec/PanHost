// Runs schema.sql against DATABASE_URL. Usage: npm run initdb
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[initdb] Applying schema.sql ...');
  await pool.query(sql);
  console.log('[initdb] Done. Tables are ready.');
  await pool.end();
}

main().catch((err) => {
  console.error('[initdb] Failed:', err.message);
  process.exit(1);
});
