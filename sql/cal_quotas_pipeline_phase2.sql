-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline Phase 2 — EOD closure, audit log, attach logging
-- ─────────────────────────────────────────────────────────────────────────────
-- Builds on sql/cal_quotas_pipeline_attach.sql. Adds:
--
--   · cal_quota_pipeline_attachments       audit table — one row per
--                                           auto-attach event (which booking
--                                           pulled which bill, when, and
--                                           whether it overshot).
--
--   · close_stale_pipelines()              EOD closure function. Finds
--                                           bookings whose pipeline_arrival_date
--                                           is already past AND pipeline_remaining_g
--                                           > 0, then converts the unfilled
--                                           grams into gain_realized_g and
--                                           zeros the pipeline. Returns one
--                                           row per booking closed.
--
--   · process_pipeline_attachments()        rewritten to insert into the audit
--                                           log on every attach.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Audit log table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cal_quota_pipeline_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL,
  purchase_id   UUID NOT NULL,
  attached_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  bill_net_wt_g NUMERIC(12, 3) NOT NULL,
  pipeline_remaining_before NUMERIC(12, 3) NOT NULL,
  pipeline_remaining_after  NUMERIC(12, 3) NOT NULL,
  overshoot_g   NUMERIC(12, 3) NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL DEFAULT 'auto_attach'           -- auto_attach | eod_close
);

CREATE INDEX IF NOT EXISTS idx_cqpa_booking ON cal_quota_pipeline_attachments (booking_id);
CREATE INDEX IF NOT EXISTS idx_cqpa_purchase ON cal_quota_pipeline_attachments (purchase_id);


-- ── Updated attach function (logs every attachment) ─────────────────────────
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
  remaining_before NUMERIC;
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
    expected_pdate  := booking.pipeline_arrival_date - INTERVAL '1 day';

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

      remaining_before := remaining;

      UPDATE purchases
         SET booking_id = booking.id,
             booked_at  = now()
       WHERE id = bill.id;

      attached_count  := attached_count + 1;
      attached_weight := attached_weight + bill.net_weight;
      remaining       := remaining - bill.net_weight;

      -- Audit row — captures the before/after pipeline state for this attach.
      INSERT INTO cal_quota_pipeline_attachments
        (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
      VALUES
        (booking.id, bill.id, bill.net_weight, remaining_before, GREATEST(0, remaining), GREATEST(0, -remaining), 'auto_attach');
    END LOOP;

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


-- ── EOD closure function ────────────────────────────────────────────────────
-- For each booking whose arrival_date has already passed AND still has
-- pipeline_remaining_g > 0, move the unfilled grams into gain_realized_g
-- and zero the pipeline. Logs a synthetic audit row with reason='eod_close'
-- so the audit trail captures "the pipeline gave up and converted to gain".
--
-- Safe to call every sync tick — the WHERE clause makes it a no-op until
-- a booking's arrival date passes.
CREATE OR REPLACE FUNCTION close_stale_pipelines()
RETURNS TABLE (
  booking_id    UUID,
  closed_at     TIMESTAMPTZ,
  remaining_g   NUMERIC
) AS $$
DECLARE
  booking   RECORD;
  today_ist DATE;
BEGIN
  -- Today in IST. Bookings with arrival_date < today are eligible to close.
  today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::DATE;

  FOR booking IN
    SELECT q.id, q.pipeline_remaining_g
      FROM cal_quotas q
     WHERE q.status = 'booked'
       AND q.pipeline_remaining_g > 0
       AND q.pipeline_arrival_date IS NOT NULL
       AND q.pipeline_arrival_date < today_ist
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE cal_quotas
       SET pipeline_remaining_g = 0,
           gain_realized_g      = gain_realized_g + booking.pipeline_remaining_g,
           pipeline_attached_at = now()
     WHERE id = booking.id;

    -- Audit row — no actual purchase attached; reason marks it as the
    -- close-out conversion.
    INSERT INTO cal_quota_pipeline_attachments
      (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
    VALUES
      (booking.id,
       '00000000-0000-0000-0000-000000000000'::uuid,    -- sentinel; no real purchase
       0, booking.pipeline_remaining_g, 0, booking.pipeline_remaining_g,
       'eod_close');

    booking_id  := booking.id;
    closed_at   := now();
    remaining_g := booking.pipeline_remaining_g;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;
GRANT EXECUTE ON FUNCTION close_stale_pipelines()        TO authenticated;
GRANT EXECUTE ON FUNCTION close_stale_pipelines()        TO service_role;

COMMIT;
