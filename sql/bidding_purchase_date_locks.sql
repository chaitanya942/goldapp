-- ─────────────────────────────────────────────────────────────────────────────
-- bidding_purchase_date_locks — ops-managed locks on PURCHASE-DATE ranges.
-- A bill whose purchase_date falls inside any active lock range cannot be
-- selected or booked on the Bidding Volume screen until the range is unlocked.
-- Persisted server-side so locks survive refresh / re-open. Global (applies to
-- every region) — locking a date locks those bills wherever they appear.
-- Read by /api/consignments?action=date_locks; written by lock_dates /
-- unlock_dates; enforced inside create_booking + attach_selected_to_pipeline.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bidding_purchase_date_locks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_date  date        NOT NULL,
  to_date    date        NOT NULL,                 -- inclusive; single day → from_date = to_date
  note       text,
  locked_by  text,
  locked_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bpdl_range_ok CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_bpdl_range ON bidding_purchase_date_locks (from_date, to_date);

-- Service-role only (the server reads/writes with the service key; no anon access).
ALTER TABLE bidding_purchase_date_locks ENABLE ROW LEVEL SECURITY;
