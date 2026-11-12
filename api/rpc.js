// POST /api/rpc  { fn: "getGuestData", args: ["Juan dela Cruz"] }
// The Vercel stand-in for google.script.run, used by index.html and admin.html.
// Admin functions need the x-admin-token header returned by adminLogin.
import * as rsvp from '../lib/rsvp.js';
import { verifyToken } from '../lib/auth.js';

const PUBLIC_FNS = new Set(['getGuestData', 'submitForm', 'adminLogin']);
const ADMIN_FNS = new Set([
  'checkSession', 'isAdminPasswordDefault', 'setAdminPassword',
  'getSettings', 'setRSVPActive', 'getDashboardStats',
  'getAllGuests', 'getGuestById', 'addGuest', 'updateGuest',
  'deleteGuest', 'bulkDeleteGuests', 'importGuests',
]);

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Use POST.' });
  }
  const { fn, args } = parseBody(req);
  if (!PUBLIC_FNS.has(fn) && !ADMIN_FNS.has(fn)) {
    return res.status(400).json({ success: false, message: 'Unknown action.' });
  }
  try {
    if (ADMIN_FNS.has(fn) && !(await verifyToken(req.headers['x-admin-token']))) {
      return res.status(401).json({ success: false, authError: true, message: 'Your session has expired. Please sign in again.' });
    }
    const result = await rsvp[fn](...(Array.isArray(args) ? args : []));
    return res.status(200).json(result === undefined ? null : result);
  } catch (err) {
    console.error(fn, err);
    if (err && err.isConfig) return res.status(500).json({ success: false, setupError: true, message: err.message });
    return res.status(500).json({ success: false, message: 'Something went wrong on the server. Open /api/health for details.' });
  }
}
