import { neon } from '@neondatabase/serverless';

// One HTTP-based Neon client per function instance.
let sqlClient = null;
export function db() {
  if (!sqlClient) {
    const found = findDatabaseUrl();
    if (!found) throw configError('The database is not connected. In Vercel, open Storage, connect the Neon database to this project, then redeploy.');
    sqlClient = neon(found.value);
  }
  return sqlClient;
}

export function configError(msg) {
  const e = new Error(msg);
  e.isConfig = true;
  return e;
}

// Vercel's Neon integration may add a custom prefix (e.g. LOVEANNE1_URL)
export function findDatabaseUrl() {
  const names = ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL'];
  for (const n of names) if (process.env[n]) return { name: n, value: process.env[n] };
  const cands = Object.entries(process.env)
    .filter(([k, v]) => v && /_URL$/.test(k) && /^postgres(ql)?:\/\//.test(v))
    .sort(([a], [b]) => /UNPOOLED|NON_POOLING/.test(a) - /UNPOOLED|NON_POOLING/.test(b));
  return cands.length ? { name: cands[0][0], value: cands[0][1] } : null;
}

// Lets local tests swap in another client with the same .query(text, params) shape.
export function setDb(client) {
  sqlClient = client;
  schemaReady = null;
}

export async function q(text, params = []) {
  return db().query(text, params);
}

// Auto-creates the tables on first use (the Vercel equivalent of setupSheets).
// Every statement is idempotent.
const SCHEMA = [
  // was the "GUEST LIST" sheet — Main Guest + Guest 2..20 (fixed companions)
  `CREATE TABLE IF NOT EXISTS guests (
     id          SERIAL PRIMARY KEY,
     main_guest  TEXT NOT NULL,
     companions  JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // was the "Responses" sheet — one row per invitation, deleted with the guest
  `CREATE TABLE IF NOT EXISTS responses (
     guest_id     INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
     main_guest   TEXT NOT NULL,
     main_status  TEXT NOT NULL DEFAULT '',
     companions   JSONB NOT NULL DEFAULT '[]'::jsonb,
     total_seat   INTEGER NOT NULL DEFAULT 0,
     submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // was Script Properties
  `CREATE TABLE IF NOT EXISTS settings (
     key    TEXT PRIMARY KEY,
     value  TEXT NOT NULL
   )`,
  `INSERT INTO settings (key, value) VALUES ('rsvp_active', 'true') ON CONFLICT (key) DO NOTHING`,
  `INSERT INTO settings (key, value) VALUES ('sample_seeded', 'pending') ON CONFLICT (key) DO NOTHING`,
];

// Same 5 sample guests the Apps Script version wrote on first run.
const SAMPLES = [
  ['Juan dela Cruz', ['Maria dela Cruz']],
  ['Maria Santos', ['Pedro Santos', 'Ana Santos']],
  ['Pedro Reyes', []],
  ['Ana Gonzalez', ['Carlos Gonzalez', 'Luz Gonzalez', 'Rico Gonzalez']],
  ['Carlos Mendoza', ['Rosa Mendoza']],
];

let schemaReady = null;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA) await q(stmt);
      // Seed the samples once, only into a brand-new empty guest list.
      const claimed = await q(`UPDATE settings SET value = 'done' WHERE key = 'sample_seeded' AND value = 'pending' RETURNING key`);
      if (claimed.length) {
        const [{ n }] = await q('SELECT count(*)::int AS n FROM guests');
        if (n === 0) {
          const rows = SAMPLES.map(([m, c]) => ({ m, c: padCompanions(c) }));
          await q(
            `INSERT INTO guests (main_guest, companions)
             SELECT x.m, x.c FROM jsonb_to_recordset($1::jsonb) AS x(m text, c jsonb)`,
            [JSON.stringify(rows)]
          );
        }
      }
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

export const MAX_COMPANIONS = 19; // Guest 2 .. Guest 20

export function padCompanions(list) {
  const out = [];
  for (let i = 0; i < MAX_COMPANIONS; i++) out.push(String((list && list[i]) || '').trim());
  return out;
}
