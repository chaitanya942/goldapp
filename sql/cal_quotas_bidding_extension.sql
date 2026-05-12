-- ─────────────────────────────────────────────────────────────────────────────
-- Extend cal_quotas to be the bookings ledger for Bidding Volume
-- ─────────────────────────────────────────────────────────────────────────────
-- The Bidding Volume module (consignments → Bidding Volume) lets ops commit
-- incoming gold to buyers ahead of arrival. Those commitments are the same
-- data the Sales → Cal Table → Quotas tab needs for allocation, so we keep
-- one row per booking in cal_quotas and add the status flow + audit columns
-- the new workflow needs.
--
-- Schema before:  id, date, party, weight, rate, is_kl, created_at
-- Schema after:   + status, buyer_phone, purity, notes, created_by,
--                 + confirmed_at/by, fulfilled_at/by, cancelled_at/by,
--                 + cancellation_reason
--
-- Status flow:
--   booked      ← created from Bidding Volume (or CalTable Quotas tab, default)
--   confirmed   ← accounts approves the commitment
--   fulfilled   ← gold handed over to the buyer after arrival
--   cancelled   ← deal voided; releases the quantity back to AVAILABLE
--
-- CalTable's allocation logic in components/sales/CalTable.js continues to
-- work unchanged — it reads (party, weight, rate, is_kl), all preserved.
-- It will see ALL rows regardless of status; if you want to exclude
-- cancelled bookings from allocation, filter in the JS (cheaper than a
-- view).
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Defensive: create the table if it doesn't already exist. Production already
-- has it; dev / staging may not.
CREATE TABLE IF NOT EXISTS cal_quotas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE NOT NULL,
  party        TEXT NOT NULL,
  weight       NUMERIC(12, 3) NOT NULL,
  rate         NUMERIC(12, 2) NOT NULL,
  is_kl        BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4-state status flow. Default 'booked' so existing rows + new CalTable rows
-- both behave like an active commitment.
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'booked';
-- Add the CHECK separately so re-running doesn't error if it already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cal_quotas_status_check'
  ) THEN
    ALTER TABLE cal_quotas
      ADD CONSTRAINT cal_quotas_status_check
      CHECK (status IN ('booked', 'confirmed', 'fulfilled', 'cancelled'));
  END IF;
END $$;

-- Buyer + commercial metadata.
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS buyer_phone TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS purity      TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS notes       TEXT;

-- Audit trail — who acted on this booking and when. created_by is a soft
-- audit (no FK to users) so it stays sane even if a user is deactivated.
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS created_by          TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS confirmed_by        TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS fulfilled_at        TIMESTAMPTZ;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS fulfilled_by        TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS cancelled_by        TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Index for the Bidding Volume reads (filter by date + status).
CREATE INDEX IF NOT EXISTS idx_cal_quotas_date_status ON cal_quotas (date, status);

COMMIT;

-- Verification: row counts by status (will all be 'booked' before any ops action).
SELECT
  COUNT(*)                                            AS total_rows,
  COUNT(*) FILTER (WHERE status = 'booked')           AS booked,
  COUNT(*) FILTER (WHERE status = 'confirmed')        AS confirmed,
  COUNT(*) FILTER (WHERE status = 'fulfilled')        AS fulfilled,
  COUNT(*) FILTER (WHERE status = 'cancelled')        AS cancelled
FROM cal_quotas;
