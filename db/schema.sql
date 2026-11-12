-- Wedding RSVP — Gem & Jenny
-- The app creates these tables automatically on the first request.
-- Run this in the Neon SQL Editor only if you prefer to create them yourself.

CREATE TABLE IF NOT EXISTS guests (                -- was the "GUEST LIST" sheet
  id          SERIAL PRIMARY KEY,
  main_guest  TEXT NOT NULL,                        -- Main Guest Full Name
  companions  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- Guest 2..Guest 20 (19 fixed slots)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS responses (             -- was the "Responses" sheet
  guest_id     INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  main_guest   TEXT NOT NULL,
  main_status  TEXT NOT NULL DEFAULT '',            -- 'Attending' | 'Declined'
  companions   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ "name": "...", "status": "Attending" }] per slot
  total_seat   INTEGER NOT NULL DEFAULT 0,          -- number attending
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (              -- was Script Properties / Admin Settings
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('rsvp_active', 'true') ON CONFLICT (key) DO NOTHING;
