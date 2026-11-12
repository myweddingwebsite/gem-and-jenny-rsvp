# Jem & Jenny — Wedding RSVP (Vercel + Neon)

Dusty Blue Garden (ivory, dusty blue, slate blue, sage, muted olive, champagne, soft gold) · **February 16, 2027** · RSVP deadline **January 16, 2027**
Made by Love, Anne (@loveanne.ph) & Nexcellent Solutions.

| Page | URL |
|---|---|
| Guest RSVP | `/` |
| Admin dashboard | `/admin` (also `/?page=admin`) |
| Setup check | `/api/health` |

## Setup (one time)
1. **Database:** Vercel → this project → **Storage → Create Database → Neon**. Connect it to this project with the prefix **`DATABASE`** and tick Production and Preview. Leave "Create Database Branch For Deployment" unchecked.
2. **Environment variables (recommended):** `ADMIN_PASSWORD` (starting admin password) and `SESSION_SECRET` (any long random string).
3. **Redeploy:** Deployments → ⋯ → Redeploy.
4. Open `/api/health`. It should start with `"ok":true`. Tables are created automatically, with 5 sample guests on the very first run (delete them from the dashboard).

## Admin password
- Starts as the `ADMIN_PASSWORD` environment variable (or `admin123` if it's not set).
- Change it any time in the dashboard → **Settings**. The new one is stored hashed in the database. Changing it signs out other devices.
- **Forgot it?** In the Neon SQL Editor run `DELETE FROM settings WHERE key = 'admin_password_hash';` — sign-in goes back to `ADMIN_PASSWORD`.

## How it works
- Guest list: Main Guest + Guest 2–20 (fixed companions). Each guest toggles **Attending / Declined** per name.
- One response per invitation. Deleting a guest also deletes their response.
- Fuzzy search ignores case, accents, punctuation, titles (Mr./Mrs./Dr./Engr./Atty.…), word order and small typos. Close-but-unsure → "Did you mean…?"; a first name alone only suggests. Tune `FUZZY_ACCEPT` (0.84) in `lib/fuzzy.js`.
- Admin: dashboard stats, guest list add/edit/delete, bulk delete, CSV/XLSX import & export, individual responses, RSVP on/off.

## Files
- `public/index.html` — guest RSVP page · `public/admin.html` — admin dashboard
- `api/rpc.js` — single endpoint replacing `google.script.run` · `api/health.js` — setup check
- `lib/rsvp.js` — server logic ported from `Code.gs` · `lib/fuzzy.js` — name matcher · `lib/auth.js` — admin sessions · `lib/db.js` — Neon client + auto schema
- `db/schema.sql` — table definitions (reference)
