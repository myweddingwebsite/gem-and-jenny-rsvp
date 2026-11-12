import crypto from 'node:crypto';
import { q, ensureSchema } from './db.js';

const SESSION_HOURS = 12;
export const DEFAULT_ADMIN_PASSWORD = 'admin123';

// Password order: (1) one changed from the dashboard — stored as a salted
// scrypt hash in the settings table, (2) the ADMIN_PASSWORD environment
// variable, (3) "admin123" if neither exists (the dashboard then shows a
// "change your password" note, same as the Apps Script version).
async function storedHash() {
  await ensureSchema();
  const rows = await q(`SELECT value FROM settings WHERE key = 'admin_password_hash'`);
  return rows.length ? rows[0].value : '';
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyHash(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Sessions are signed with the secret plus the current password hash, so
// changing the password signs out every other device.
function signingKey(hash) {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'loveanne-jnj-rsvp-' + (process.env.VERCEL_PROJECT_ID || 'local');
  return s + '|' + (hash || '');
}

function sign(data, hash) {
  return crypto.createHmac('sha256', signingKey(hash)).update(data).digest('base64url');
}

export async function isDefaultPassword() {
  return !(await storedHash()) && !process.env.ADMIN_PASSWORD;
}

export async function checkPassword(password) {
  const hash = await storedHash();
  if (hash) return verifyHash(password || '', hash);
  return safeEqual(password || '', process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD);
}

export async function issueToken() {
  const hash = await storedHash();
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return body + '.' + sign(body, hash);
}

export async function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  if (!safeEqual(sig, sign(body, await storedHash()))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export async function setPassword(newPassword) {
  await ensureSchema();
  await q(
    `INSERT INTO settings (key, value) VALUES ('admin_password_hash', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [hashPassword(newPassword)]
  );
}
