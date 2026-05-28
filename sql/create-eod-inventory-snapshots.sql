-- ─────────────────────────────────────────────────────────────────────────────
-- EOD Physical Stock Report — daily inventory snapshot
-- ─────────────────────────────────────────────────────────────────────────────
-- Every day at 23:30 IST the system freezes the current stock position
-- (bills at_branch + bills in_consignment), aggregated by region and by
-- branch, into eod_inventory_snapshots. The report page reads these rows;
-- they're never recomputed from purchases on the fly because EOD numbers
-- need to be stable historical artifacts that don't change when bills
-- transition through subsequent days.
--
-- Two report-region groupings (matching the WGB Inventory Report format):
--   Karnataka                    = region IN ('Bangalore', 'Rest of Karnataka')
--   Kerala                       = region = 'Kerala'
--   Andhra Pradesh and Telangana = region IN ('Andhra Pradesh', 'Telangana')
--
-- Idempotent: snapshot_date is UNIQUE, so re-running the generator for the
-- same date upserts rather than inserting a duplicate.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS eod_inventory_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL UNIQUE,                  -- YYYY-MM-DD in IST
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by  TEXT,                                  -- 'cron' or actor email

  -- Org-wide totals
  not_moved_total   JSONB NOT NULL DEFAULT '{}'::jsonb, -- { gross_wt, net_wt, gross_amt, bills }
  in_transit_total  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Per report-region (Karnataka / Kerala / AP+TS)
  not_moved_by_region  JSONB NOT NULL DEFAULT '{}'::jsonb,
  in_transit_by_region JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Per branch (array of objects: { branch_name, region, report_region, gross_wt, net_wt, gross_amt, bills })
  not_moved_by_branch  JSONB NOT NULL DEFAULT '[]'::jsonb,
  in_transit_by_branch JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS eod_inventory_snapshots_date_idx
  ON eod_inventory_snapshots (snapshot_date DESC);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron job (optional — enable if your Supabase project has pg_cron)
-- ─────────────────────────────────────────────────────────────────────────────
-- The application also exposes POST /api/eod-inventory-snapshot/generate
-- which the Railway `goldapp-cron` worker can hit at 23:30 IST instead.
-- Use whichever scheduling path your infra is set up for.
--
-- Uncomment to install the pg_cron schedule (runs at 18:00 UTC = 23:30 IST):
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--     'eod-inventory-snapshot',
--     '0 18 * * *',                            -- 18:00 UTC = 23:30 IST
--     $$ SELECT net.http_post(
--          'https://goldapp-production.up.railway.app/api/eod-inventory-snapshot/generate',
--          jsonb_build_object('source', 'pg_cron')::text,
--          'application/json',
--          ARRAY[net.http_header('Authorization', 'Bearer ' || current_setting('app.cron_secret'))]
--        ) $$
--   );
