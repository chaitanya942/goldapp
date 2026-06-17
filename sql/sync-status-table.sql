-- Heartbeat table for sync health monitoring.
-- Each sync worker upserts its row on every successful run (even 0-record runs —
-- a successful no-op still proves the worker is alive). The /api/sync-health
-- endpoint reads last_success_at; if it's older than the threshold, the
-- super-admin in-app alert fires. Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS sync_status (
  sync_name        TEXT PRIMARY KEY,          -- 'new_crm' | 'old_crm'
  last_success_at  TIMESTAMPTZ,               -- last time the sync completed without throwing
  last_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,                       -- last error message (null on success)
  last_count       INT,                        -- rows synced on the last successful run
  updated_at       TIMESTAMPTZ DEFAULT now()
);
