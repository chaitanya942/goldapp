-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline Phase 6 — attacher is gain-aware and never over-attaches
-- ─────────────────────────────────────────────────────────────────────────────
-- Two bugs fixed here:
--
-- 1) UNIT MISMATCH (caused the over-attach). pipeline_remaining_g is a GROSS
--    figure: committed − sourced × (1 + gain_rate). Attaching N net grams
--    closes N × (1 + gain_rate) of that gross pipeline. The old attacher
--    decremented `remaining` by the raw net_weight, so it under-counted each
--    bill's effect, believed there was still room, and grabbed extra bills —
--    over-attaching (e.g. filling a 31 g pipeline with 69 g of bills, leaving
--    the booking "over-attached 40 g").
--
-- 2) WHOLE-BILL OVERSHOOT. Even with correct units, the old loop attached a
--    bill as long as remaining > 0 — so a 50 g bill could be slammed onto a
--    12 g pipeline. Now a bill is SKIPPED if its gain-adjusted weight exceeds
--    the owed pipeline; the residual is left owed and close_stale_pipelines()
--    converts it to realised gain at midnight ("whatever is left in the
--    pipeline at midnight is gain").
--
-- Keeps Phase 5's Sunday-skip purchase-day match and the Phase 4 stale guard.
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP FUNCTION IF EXISTS process_pipeline_attachments();

CREATE OR REPLACE FUNCTION process_pipeline_attachments()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC,
  overshoot_g     NUMERIC
) AS $$
DECLARE
  booking          RECORD;
  bill             RECORD;
  remaining        NUMERIC;   -- gross pipeline still owed
  remaining_before NUMERIC;
  attached_count   INT;
  attached_weight  NUMERIC;   -- net grams attached (for the return row)
  overshoot        NUMERIC;
  expected_pdate   DATE;
  kerala_hubs      TEXT[];
  today_ist        DATE;
  rate             NUMERIC;
  eff              NUMERIC;   -- gain-adjusted (gross) weight of one bill
  eps              CONSTANT NUMERIC := 0.001;
BEGIN
  today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT array_agg(name) INTO kerala_hubs
    FROM branches
   WHERE region = 'Kerala' AND is_hub = true;

  FOR booking IN
    SELECT
      q.id,
      q.pipeline_remaining_g,
      q.pipeline_region,
      q.pipeline_arrival_date,
      q.gain_rate
    FROM cal_quotas q
    WHERE q.pipeline_remaining_g > 0
      AND q.status = 'booked'
      AND q.pipeline_arrival_date IS NOT NULL
      AND q.pipeline_arrival_date >= today_ist          -- never fill a stale (past-arrival) booking
      AND q.pipeline_region IN ('Bangalore', 'Kerala')
    ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    remaining       := booking.pipeline_remaining_g;
    attached_count  := 0;
    attached_weight := 0;
    overshoot       := 0;
    rate            := COALESCE(booking.gain_rate, 0);

    -- The purchase day that feeds this arrival = arrival - 1 day, but skip
    -- Sunday (no Sunday pickups) so a Monday arrival pulls Saturday's bills.
    -- DOW: Sunday = 0 in Postgres.
    expected_pdate := booking.pipeline_arrival_date - INTERVAL '1 day';
    IF EXTRACT(DOW FROM expected_pdate) = 0 THEN
      expected_pdate := expected_pdate - INTERVAL '1 day';
    END IF;

    IF booking.pipeline_region = 'Bangalore' THEN
      FOR bill IN
        SELECT p.id, p.net_weight
          FROM purchases p
          JOIN branches b ON b.name = p.branch_name
         WHERE p.booking_id IS NULL
           AND p.is_deleted = false
           AND p.crm_status = 'approved'
           AND b.region    = 'Bangalore'
           AND p.purchase_date = expected_pdate
         ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC
         FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN remaining <= eps;
        eff := COALESCE(bill.net_weight, 0) * (1 + rate);
        -- Don't overshoot: skip a bill whose gain-adjusted weight is larger
        -- than the pipeline still owed. A smaller later bill may still fit.
        CONTINUE WHEN eff > remaining + eps;
        remaining_before := remaining;
        UPDATE purchases
           SET booking_id = booking.id, booked_at = now()
         WHERE id = bill.id;
        attached_count  := attached_count + 1;
        attached_weight := attached_weight + bill.net_weight;
        remaining       := remaining - eff;
        INSERT INTO cal_quota_pipeline_attachments
          (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
        VALUES
          (booking.id, bill.id, bill.net_weight, remaining_before, GREATEST(0, remaining), GREATEST(0, -remaining), 'auto_attach');
      END LOOP;

    ELSIF booking.pipeline_region = 'Kerala' THEN
      IF kerala_hubs IS NOT NULL AND array_length(kerala_hubs, 1) > 0 THEN
        FOR bill IN
          SELECT p.id, p.net_weight
            FROM purchases p
            JOIN branches b ON b.name = p.branch_name
           WHERE p.booking_id IS NULL
             AND p.is_deleted = false
             AND p.crm_status = 'approved'
             AND b.region = 'Kerala'
             AND p.current_branch = ANY(kerala_hubs)
             AND p.stock_status = 'at_branch'
           ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC
           FOR UPDATE SKIP LOCKED
        LOOP
          EXIT WHEN remaining <= eps;
          eff := COALESCE(bill.net_weight, 0) * (1 + rate);
          CONTINUE WHEN eff > remaining + eps;
          remaining_before := remaining;
          UPDATE purchases
             SET booking_id = booking.id, booked_at = now()
           WHERE id = bill.id;
          attached_count  := attached_count + 1;
          attached_weight := attached_weight + bill.net_weight;
          remaining       := remaining - eff;
          INSERT INTO cal_quota_pipeline_attachments
            (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
          VALUES
            (booking.id, bill.id, bill.net_weight, remaining_before, GREATEST(0, remaining), GREATEST(0, -remaining), 'auto_attach');
        END LOOP;
      END IF;
    END IF;

    IF remaining < 0 THEN
      overshoot := -remaining;
      remaining := 0;
    END IF;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = GREATEST(0, remaining),
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
