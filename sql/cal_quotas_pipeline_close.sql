-- ─────────────────────────────────────────────────────────────────────────────
-- Manual residual-pipeline close
-- ─────────────────────────────────────────────────────────────────────────────
-- A live booking can sit with a tiny residual pipeline (a few grams) that
-- the no-overshoot attacher can't fill — no incoming bill is small enough.
-- Rather than wait for the arrival day to pass, ops can close a sub-10 g
-- residual on the spot: it folds straight into gain, exactly like the EOD
-- settle does.
--
-- pipeline_closed_at — when set, the booking is treated as SETTLED even
-- though its arrival day hasn't passed:
--   gain     = bid_weight − sourced_net   (residual folded in)
--   pipeline = 0
--
-- The attacher skips closed bookings (pipeline_closed_at IS NOT NULL) so a
-- closed residual never gets re-opened by a later bill.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pipeline_closed_at TIMESTAMPTZ;

-- Rewrite the attacher to also skip manually-closed bookings. Same body as
-- sql/cal_quotas_gain_model.sql, plus the pipeline_closed_at IS NULL guard.
CREATE OR REPLACE FUNCTION process_pipeline_attachments()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC
) AS $$
DECLARE
  booking        RECORD;
  bill           RECORD;
  gap            NUMERIC;
  rate           NUMERIC;
  target_net     NUMERIC;
  sourced_net    NUMERIC;
  attached_count INT;
  attached_wt    NUMERIC;
  expected_pdate DATE;
  kerala_hubs    TEXT[];
  today_ist      DATE;
BEGIN
  today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT array_agg(name) INTO kerala_hubs
    FROM branches
   WHERE region = 'Kerala' AND is_hub = true;

  FOR booking IN
    SELECT q.id, q.weight, q.pending_g, q.gain_rate,
           q.pipeline_region, q.pipeline_arrival_date
      FROM cal_quotas q
     WHERE q.status = 'booked'
       AND q.pipeline_arrival_date IS NOT NULL
       AND q.pipeline_arrival_date >= today_ist
       AND q.pipeline_closed_at IS NULL                  -- skip manually-closed residuals
       AND q.pipeline_region IN ('Bangalore', 'Kerala')
     ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    rate        := COALESCE(booking.gain_rate, 0.035);
    target_net  := booking.weight / (1 + rate);
    SELECT COALESCE(SUM(p.net_weight), 0) INTO sourced_net
      FROM purchases p WHERE p.booking_id = booking.id;
    sourced_net := sourced_net + COALESCE(booking.pending_g, 0);
    gap         := target_net - sourced_net;

    IF gap <= 0 THEN
      CONTINUE;
    END IF;

    attached_count := 0;
    attached_wt    := 0;
    expected_pdate := booking.pipeline_arrival_date - INTERVAL '1 day';

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
        EXIT WHEN gap <= 0;
        CONTINUE WHEN bill.net_weight > gap;
        UPDATE purchases SET booking_id = booking.id, booked_at = now() WHERE id = bill.id;
        attached_count := attached_count + 1;
        attached_wt    := attached_wt + bill.net_weight;
        gap            := gap - bill.net_weight;
        INSERT INTO cal_quota_pipeline_attachments
          (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
        VALUES (booking.id, bill.id, bill.net_weight, gap + bill.net_weight, GREATEST(0, gap), 0, 'auto_attach');
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
          EXIT WHEN gap <= 0;
          CONTINUE WHEN bill.net_weight > gap;
          UPDATE purchases SET booking_id = booking.id, booked_at = now() WHERE id = bill.id;
          attached_count := attached_count + 1;
          attached_wt    := attached_wt + bill.net_weight;
          gap            := gap - bill.net_weight;
          INSERT INTO cal_quota_pipeline_attachments
            (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
          VALUES (booking.id, bill.id, bill.net_weight, gap + bill.net_weight, GREATEST(0, gap), 0, 'auto_attach');
        END LOOP;
      END IF;
    END IF;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = GREATEST(0, gap),
             pipeline_attached_at = now()
       WHERE id = booking.id;
      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_wt;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;

COMMIT;
