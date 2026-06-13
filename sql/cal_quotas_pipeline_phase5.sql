-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline Phase 5 — auto-attacher matches Bangalore purchase day with a
-- Sunday skip (mirrors the bidding pool's subWorkingDaySkipSunday).
-- ─────────────────────────────────────────────────────────────────────────────
-- Bug fixed here: Phase 4 computed the eligible Bangalore purchase day as a
-- plain calendar  (pipeline_arrival_date - 1 day).  But Bangalore purchases
-- that feed an arrival skip Sunday — there are no Sunday pickups — so a
-- Monday arrival is fed by SATURDAY's purchases, not Sunday's. The bidding
-- pool already does this (lib subWorkingDaySkipSunday), but the attacher used
-- a naive  -1 day, so for a Monday arrival it looked for Sunday-dated bills,
-- found none, and the pipeline never back-filled (Booked Net stayed 0).
--
-- Fix: after stepping back one day, if that lands on a Sunday, step back one
-- more to Saturday — identical to the bidding pool. Everything else (the
-- Phase-4 stale-booking guard, Kerala hub path, audit insert) is unchanged.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

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
  remaining        NUMERIC;
  remaining_before NUMERIC;
  attached_count   INT;
  attached_weight  NUMERIC;
  overshoot        NUMERIC;
  expected_pdate   DATE;
  kerala_hubs      TEXT[];
  today_ist        DATE;
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
      q.pipeline_arrival_date
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
        EXIT WHEN remaining <= 0;
        remaining_before := remaining;
        UPDATE purchases
           SET booking_id = booking.id, booked_at = now()
         WHERE id = bill.id;
        attached_count  := attached_count + 1;
        attached_weight := attached_weight + bill.net_weight;
        remaining       := remaining - bill.net_weight;
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
          EXIT WHEN remaining <= 0;
          remaining_before := remaining;
          UPDATE purchases
             SET booking_id = booking.id, booked_at = now()
           WHERE id = bill.id;
          attached_count  := attached_count + 1;
          attached_weight := attached_weight + bill.net_weight;
          remaining       := remaining - bill.net_weight;
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
