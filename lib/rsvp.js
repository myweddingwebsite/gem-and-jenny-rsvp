// ============================================================
//  WEDDING RSVP — Jem & Jenny — server logic
//  28 April 2027 · RSVP on or before 28 February 2027
//  Ported from the Apps Script Code.gs (Enzo & Bianca build):
//  • Guest list: Main Guest + Guest 2–20 (FIXED companions)
//  • Responses: per-guest attendance (Attending / Declined)
//  • Admin: dashboard, guest list CRUD, bulk delete, import, RSVP on/off
//  Storage: Neon Postgres (tables are created automatically).
// ============================================================
import { q, ensureSchema, padCompanions, MAX_COMPANIONS } from './db.js';
import { fuzzyFind, nameTokens_ } from './fuzzy.js';
import { checkPassword, issueToken, setPassword, isDefaultPassword } from './auth.js';

const CLOSED_MSG = 'RSVP submissions are currently closed.';
const THANK_YOU_MSG = "We can't wait to celebrate with you!";

const clean = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
const key = (s) => clean(s).toLowerCase();
// accent / punctuation / title-insensitive key, for spotting duplicate guests
const dupKey = (s) => nameTokens_(s).join(' ');

function parseCompanions(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
}

// ── Settings (RSVP on/off) ───────────────────────────────────
export async function getSettings() {
  await ensureSchema();
  const rows = await q(`SELECT value FROM settings WHERE key = 'rsvp_active'`);
  return { success: true, rsvpActive: !rows.length || rows[0].value !== 'false' };
}

export async function setRSVPActive(isActive) {
  await ensureSchema();
  const v = isActive ? 'true' : 'false';
  await q(
    `INSERT INTO settings (key, value) VALUES ('rsvp_active', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [v]
  );
  return { success: true, message: isActive ? 'RSVP is now open.' : 'RSVP is now closed.' };
}

// ============================================================
//  getGuestData — fuzzy lookup for the guest page
//  Returns: { found, alreadySubmitted, name, seat, guests: [] }
//        or { found:false, suggestions:[…] } ("Did you mean…?")
// ============================================================
export async function getGuestData(name) {
  if (!name || !clean(name)) return { found: false };

  const settings = await getSettings();
  if (!settings.rsvpActive) return { found: false, closed: true, message: CLOSED_MSG };

  const rows = await q(
    `SELECT g.id, g.main_guest, g.companions, (r.guest_id IS NOT NULL) AS submitted
       FROM guests g LEFT JOIN responses r ON r.guest_id = g.id
      ORDER BY g.id`
  );
  const res = fuzzyFind(name, rows.map((r) => ({ id: r.id, name: r.main_guest })));
  if (!res.match) return res.suggestions.length ? { found: false, suggestions: res.suggestions } : { found: false };

  const row = rows.find((r) => r.id === res.match.id);
  const mainGuest = clean(row.main_guest);
  if (row.submitted) return { found: true, alreadySubmitted: true, name: mainGuest };

  const guestNames = parseCompanions(row.companions).map(clean).filter(Boolean);
  return {
    found: true,
    alreadySubmitted: false,
    name: mainGuest,
    seat: 1 + guestNames.length,
    guests: guestNames,
  };
}

// ============================================================
//  submitForm
//  payload: { name, totalSeat, mainStatus, guest2, status2, … guest20, status20 }
//  The invitation is re-checked on the server: only names on the guest
//  list are saved, and the attending count is recomputed here.
// ============================================================
const normStatus = (s) => (String(s || '').trim().toLowerCase() === 'attending' ? 'Attending' : 'Declined');

export async function submitForm(data) {
  if (!data || !clean(data.name)) return { success: false, message: 'Invalid submission data.' };

  const settings = await getSettings();
  if (!settings.rsvpActive) return { success: false, closed: true, message: CLOSED_MSG };

  const found = await q(`SELECT id, main_guest, companions FROM guests WHERE lower(main_guest) = $1 ORDER BY id LIMIT 1`, [key(data.name)]);
  if (!found.length) return { success: false, message: 'Name not found in our guest registry. Please search again.' };
  const guest = found[0];

  const listed = padCompanions(parseCompanions(guest.companions));
  const mainStatus = normStatus(data.mainStatus);
  let total = mainStatus === 'Attending' ? 1 : 0;
  const slots = [];
  for (let i = 0; i < MAX_COMPANIONS; i++) {
    const n = i + 2;
    const sent = clean(data['guest' + n]);
    const onList = listed[i];
    // keep the slot only if the guest page sent that listed companion
    if (onList && sent && key(sent) === key(onList)) {
      const st = normStatus(data['status' + n]);
      if (st === 'Attending') total++;
      slots.push({ name: onList, status: st });
    } else {
      slots.push({ name: '', status: '' });
    }
  }

  const inserted = await q(
    `INSERT INTO responses (guest_id, main_guest, main_status, companions, total_seat)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (guest_id) DO NOTHING
     RETURNING guest_id`,
    [guest.id, clean(guest.main_guest), mainStatus, JSON.stringify(slots), total]
  );
  if (!inserted.length) return { success: false, message: 'Your RSVP has already been submitted.' };

  return { success: true, message: THANK_YOU_MSG };
}

// ============================================================================
//  ADMIN — auth, dashboard, guest list CRUD & import
// ============================================================================
export async function adminLogin(password) {
  if (!(await checkPassword(password))) return { success: false, message: 'Incorrect password.' };
  return { success: true, token: await issueToken() };
}

// rpc.js only lets this through with a valid token
export async function checkSession() {
  return { success: true };
}

export async function isAdminPasswordDefault() {
  return { success: true, isDefault: await isDefaultPassword() };
}

export async function setAdminPassword(currentPassword, newPassword) {
  if (!(await checkPassword(currentPassword))) return { success: false, message: 'The current password is incorrect.' };
  const pw = String(newPassword || '');
  if (pw.length < 6) return { success: false, message: 'The new password must be at least 6 characters.' };
  await setPassword(pw);
  return { success: true, message: 'Password updated.', token: await issueToken() };
}

// ── Guest List + Responses, merged for the admin table ──────
export async function getAllGuests() {
  await ensureSchema();
  const rows = await q(
    `SELECT g.id, g.main_guest, g.companions,
            r.guest_id AS responded, r.main_status, r.companions AS resp_companions,
            r.total_seat, r.submitted_at
       FROM guests g LEFT JOIN responses r ON r.guest_id = g.id
      ORDER BY g.id`
  );
  const guests = rows.map((row, i) => {
    const mainGuest = clean(row.main_guest);
    const companions = padCompanions(parseCompanions(row.companions));
    const companionCount = companions.filter((n) => n !== '').length;
    const record = {
      id: row.id,
      rowNum: i + 1,
      mainGuest,
      companions,
      invited: (mainGuest ? 1 : 0) + companionCount,
      responded: false,
      timestamp: null,
      totalSeat: 0,
      mainStatus: 'Pending',
      companionStatuses: companions.map(() => ''),
    };
    if (row.responded != null) {
      const slots = parseCompanions(row.resp_companions);
      record.responded = true;
      record.timestamp = row.submitted_at ? new Date(row.submitted_at).toISOString() : null;
      record.totalSeat = Number(row.total_seat) || 0;
      record.mainStatus = row.main_status || 'Pending';
      record.companionStatuses = companions.map((_, s) => String((slots[s] && slots[s].status) || ''));
    }
    return record;
  });
  return { success: true, guests };
}

export async function getGuestById(id) {
  const res = await getAllGuests();
  const match = res.guests.find((g) => g.id === Number(id));
  if (!match) return { success: false, message: 'Guest not found.' };
  return { success: true, guest: match };
}

async function nameTaken(name, exceptId) {
  const rows = await q(`SELECT id, main_guest FROM guests WHERE id <> $1`, [Number(exceptId) || 0]);
  const k = dupKey(name);
  return rows.some((r) => dupKey(r.main_guest) === k);
}

export async function addGuest(payload) {
  await ensureSchema();
  const mainGuest = clean(payload && payload.mainGuest);
  if (!mainGuest) return { success: false, message: 'Main guest name is required.' };
  if (await nameTaken(mainGuest)) return { success: false, message: '"' + mainGuest + '" is already on the guest list.' };
  await q(`INSERT INTO guests (main_guest, companions) VALUES ($1, $2::jsonb)`, [
    mainGuest, JSON.stringify(padCompanions((payload.companions || []).map(clean))),
  ]);
  return { success: true, message: 'Guest added successfully.' };
}

export async function updateGuest(id, payload) {
  await ensureSchema();
  id = Number(id);
  if (!id) return { success: false, message: 'Invalid guest id.' };
  const mainGuest = clean(payload && payload.mainGuest);
  if (!mainGuest) return { success: false, message: 'Main guest name is required.' };
  if (await nameTaken(mainGuest, id)) return { success: false, message: '"' + mainGuest + '" is already on the guest list.' };
  const rows = await q(`UPDATE guests SET main_guest = $2, companions = $3::jsonb WHERE id = $1 RETURNING id`, [
    id, mainGuest, JSON.stringify(padCompanions((payload.companions || []).map(clean))),
  ]);
  if (!rows.length) return { success: false, message: 'Guest not found.' };
  await q(`UPDATE responses SET main_guest = $2 WHERE guest_id = $1`, [id, mainGuest]);
  return { success: true, message: 'Guest updated successfully.' };
}

// Deleting a guest also deletes their response (ON DELETE CASCADE).
export async function deleteGuest(id) {
  await ensureSchema();
  const rows = await q(`DELETE FROM guests WHERE id = $1 RETURNING id`, [Number(id) || 0]);
  if (!rows.length) return { success: false, message: 'Guest not found.' };
  return { success: true, message: 'Guest deleted.' };
}

export async function bulkDeleteGuests(ids) {
  await ensureSchema();
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0);
  if (!list.length) return { success: false, message: 'No guests selected.' };
  const rows = await q(`DELETE FROM guests WHERE id = ANY($1::int[]) RETURNING id`, [list]);
  return { success: true, message: rows.length + ' guest(s) deleted.' };
}

// rows = [{ mainGuest, companions: [c2..c20] }, ...]
export async function importGuests(rows) {
  await ensureSchema();
  if (!Array.isArray(rows) || !rows.length) return { success: false, message: 'No data to import.' };

  const existing = await q(`SELECT main_guest FROM guests`);
  const seen = new Set(existing.map((r) => dupKey(r.main_guest)));
  const toInsert = [];
  let skipped = 0;
  for (const rw of rows) {
    const m = clean(rw && rw.mainGuest);
    if (!m) continue;
    if (seen.has(dupKey(m))) { skipped++; continue; }
    seen.add(dupKey(m));
    toInsert.push({ m, c: padCompanions(((rw && rw.companions) || []).map(clean)) });
  }
  if (toInsert.length) {
    await q(
      `INSERT INTO guests (main_guest, companions)
       SELECT x.m, x.c FROM jsonb_to_recordset($1::jsonb) AS x(m text, c jsonb)`,
      [JSON.stringify(toInsert)]
    );
  }
  let message = toInsert.length + ' guest(s) imported.';
  if (skipped) message += ' ' + skipped + ' already on the list were skipped.';
  return { success: true, added: toInsert.length, skipped, message };
}

// ── Status normalizer (handles "Attending"/"Declined" and older wording) ──
function normalizeStatus_(st) {
  const s = String(st || '').trim().toLowerCase();
  if (s === 'attending' || s === 'accepted' || s === 'joyfully accepts') return 'accepted';
  if (s === 'declined' || s === 'regretfully declines') return 'declined';
  return 'pending';
}

// ── Dashboard stats ──────────────────────────────────────────
export async function getDashboardStats() {
  const { guests } = await getAllGuests();
  const s = {
    totalMainGuests: guests.length, totalInvited: 0, totalResponded: 0, totalPending: 0,
    totalAccepted: 0, totalDeclined: 0, totalAttending: 0, totalNotAttending: 0,
  };
  for (const g of guests) {
    s.totalInvited += g.invited;
    if (!g.responded) continue;
    s.totalResponded++;
    const st = normalizeStatus_(g.mainStatus);
    if (st === 'accepted') s.totalAccepted++;
    else if (st === 'declined') s.totalDeclined++;
    s.totalAttending += g.totalSeat;
    s.totalNotAttending += Math.max(g.invited - g.totalSeat, 0);
  }
  s.totalPending = s.totalMainGuests - s.totalResponded;
  return { success: true, stats: s };
}
