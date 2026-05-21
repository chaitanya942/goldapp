-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline auto-attach for cal_quotas bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- When the operator commits more grams to a bidder than the currently
-- selected bills (e.g. 2500g committed, 1847.24g of bills selected), the
-- excess (652.76g) is attributed to "pipeline" — meaning we promise to
-- back-fill it from incoming purchases that haven't synced from the CRM
-- yet. This migration adds the bookkeeping columns + a Postgres function
-- the sync pipeline calls after every CRM pull.
--
-- Columns added to cal_quotas:
--   pipeline_remaining_g  — grams still owed from the pipeline (decremented
--                          as bills auto-attach; reaches 0 = fulfilled)
--   pipeline_region       — which region to draw bills from (Bangalore / etc.)
--   pipeline_arrival_date — bill's required arrival window (= cal_quotas.date)
--   pipeline_attached_at  — last time the auto-attacher touched this row
--   gain_realized_g       — accumulated overshoot credited back as gain when
--                          the last attached bill exceeds the remaining gap
--
-- Function: process_pipeline_attachments()
--   Walks open bookings (pipeline_remaining_g > 0 AND status='booked') in
--   creation order. For each, finds approved/unbooked Bangalore bills for
--   the arrival window in FIFO purchase order and attaches them via
--   purchases.booking_id until the gap closes. The last bill is attached
--   in full even if it overshoots; the overshoot lands in gain_realized_g.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pipeline_remaining_g  NUMERIC(12, 3) NOT NULL DEFAULT 0;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pipeline_region       TEXT;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pipeline_arrival_date DATE;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pipeline_attached_at  TIMESTAMPTZ;
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS gain_realized_g       NUMERIC(12, 3) NOT NULL DEFAULT 0;

-- Partial index — open pipeline bookings only. The auto-attacher scans
-- this index on every cron tick; small + fast.
CREATE INDEX IF NOT EXISTS idx_cal_quotas_pipeline_open
  ON cal_quotas (date, pipeline_region, created_at)
  WHERE pipeline_remaining_g > 0 AND status = 'booked';


-- ── Function: process_pipeline_attachments ──────────────────────────────────
-- Returns one row per booking that received attachments, with the count + the
-- weight attached. Designed to be called from the sync-purchases endpoint
-- after each CRM pull. Safe to call multiple times — each call only attaches
-- bills that are still unbooked at that moment.
--
-- PHASE 1: handles Bangalore pipeline only (purchase_date = arrival_date - 1
-- AND region = 'Bangalore' AND crm_status = 'approved'). Other regions can
-- be added later — the schema is region-agnostic.
CREATE OR REPLACE FUNCTION process_pipeline_attachments()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC,
  overshoot_g     NUMERIC
) AS $$
DECLARE
  booking         RECORD;
  bill            RECORD;
  remaining       NUMERIC;
  attached_count  INT;
  attached_weight NUMERIC;
  overshoot       NUMERIC;
  expected_pdate  DATE;
BEGIN
  FOR booking IN
    SELECT
      q.id,
      q.pipeline_remaining_g,
      q.pipeline_region,
      q.pipeline_arrival_date
    FROM cal_quotas q
    WHERE q.pipeline_remaining_g > 0
      AND q.status = 'booked'
      AND q.pipeline_arrival_date IS NOT NULL
      AND q.pipeline_region = 'Bangalore'        -- PHASE 1: Bangalore only
    ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC   -- FIFO booking-level
  LOOP
    remaining       := booking.pipeline_remaining_g;
    attached_count  := 0;
    attached_weight := 0;
    overshoot       := 0;
    -- Bangalore bills purchased the day before arrival back-fill the pipeline.
    expected_pdate  := booking.pipeline_arrival_date - INTERVAL '1 day';

    -- Walk eligible bills FIFO. FOR UPDATE locks rows so concurrent
    -- attacher runs don't double-claim the same bill.
    FOR bill IN
      SELECT p.id, p.net_weight, p.application_id
      FROM purchases p
      JOIN branches b ON b.name = p.branch_name
      WHERE p.booking_id IS NULL
        AND p.is_deleted = false
        AND p.crm_status = 'approved'
        AND b.region    = booking.pipeline_region
        AND p.purchase_date = expected_pdate
      ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC
      FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN remaining <= 0;

      UPDATE purchases
         SET booking_id = booking.id,
             booked_at  = now()
       WHERE id = bill.id;

      attached_count  := attached_count + 1;
      attached_weight := attached_weight + bill.net_weight;
      remaining       := remaining - bill.net_weight;
    END LOOP;

    -- If we overshot (remaining went negative), the last bill's excess
    -- becomes gain. Bidder still gets the committed weight; the surplus
    -- is logged on the booking row.
    IF remaining < 0 THEN
      overshoot := -remaining;
      remaining := 0;
    END IF;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = remaining,
             gain_realized_g      = gain_realized_g + overshoot,
             pipeline_attached_at = now()
       WHERE id = booking.id;

      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_weight;
      overshoot_g     := overshoot;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;

COMMIT;
