// GET /api/health — setup check. Shows what's configured, never the values.
import { findDatabaseUrl, ensureSchema, q } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const db = findDatabaseUrl();
  const checks = {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? "set" : "not set — default password admin123 is in use until you change it",
    SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'not set (optional, recommended)',
    database_url: db ? 'found in ' + db.name : 'MISSING — connect the Neon database under Storage, then redeploy',
    database_connection: 'not tested',
    tables: 'not checked',
  };
  if (db) {
    try {
      await q('SELECT 1');
      checks.database_connection = 'ok';
      await ensureSchema();
      const [g] = await q('SELECT count(*)::int AS n FROM guests');
      const [r] = await q('SELECT count(*)::int AS n FROM responses');
      checks.tables = `ok — ${g.n} guest(s), ${r.n} response(s)`;
    } catch (err) {
      checks.database_connection = 'FAILED — ' + String(err.message || err).slice(0, 200);
    }
  }
  const ok = checks.database_connection === 'ok';
  res.status(ok ? 200 : 500).json({ ok, checks });
}
