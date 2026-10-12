-- Jarvis (Staqu) store footfall — one row per camera store per IST day.
-- Jarvis only serves the last 15 days, so /api/sync-jarvis copies each day
-- here to keep history. Re-fetched while Jarvis still marks a day as partial
-- or its staff-reduction pass as pending (counts get revised).
-- Idempotent: safe to re-run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS jarvis_footfall (
  store_code             TEXT        NOT NULL,   -- Jarvis store_code_id, e.g. 'WG-2049'
  store_name             TEXT        NOT NULL,   -- Jarvis store name; matches branches.name
  footfall_date          DATE        NOT NULL,
  entry_count            INTEGER     NOT NULL DEFAULT 0,
  male_count             INTEGER,
  female_count           INTEGER,
  age_data               JSONB,                  -- {"Teenagers (0-20)": n, ...} when Jarvis provides it
  data_status            TEXT,                   -- Jarvis data_status, e.g. 'FULL'
  staff_reduction_status TEXT,                   -- 'SUCCESS' | 'PENDING' | ...
  message                TEXT,
  fetched_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_code, footfall_date)
);

CREATE INDEX IF NOT EXISTS idx_jarvis_footfall_date ON jarvis_footfall (footfall_date);

-- Server-only table: read/written by API routes with the service-role key.
-- RLS on with no policies = no direct access for anon/authenticated clients.
ALTER TABLE jarvis_footfall ENABLE ROW LEVEL SECURITY;
