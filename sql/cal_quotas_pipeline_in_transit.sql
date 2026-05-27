-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline back-fill: no overshoot + opt-in 24h in-transit eligibility
-- ─────────────────────────────────────────────────────────────────────────────
-- Two rules, both per accounts feedback:
--
--   1. NO OVERSHOOT — never attach a bill whose net weight is bigger than the
--      remaining pipeline. The bill stays unbooked and is available for the
--      next booking that fits it. Previously a too-big bill got attached in
--      full and the leftover went into gain_realized_g, which broke the
--      booking math (bills + gain != booked weight). Pack tightly by
--      sorting bills smallest-first.
--
--   2. OPT-IN 24h IN-TRANSIT — by default only Bangalore purchases on
--      (arrival - 1) back-fill. When the booking is created with
--      pipeline_include_in_transit = true, the attacher also pulls
--      outstation (not Bangalore, not Kerala) in_consignment bills whose
--      arrival (dispatched_at + delivery_tat_hours) lands on the booking's
--      pipeline_arrival_date.
--
-- Kerala pipeline flow is unchanged — its hub-led rules are different.
--
-- Idempotent. Safe to re-run. Drops the function first to allow signature
-- changes from older builds (early phases used a different RETURNS TABLE).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- New flag (opt-in 24h in-transit) — default OFF so existing rows keep
-- the original Bangalore-only behaviour.
ALTER TABLE cal_quotas
  ADD COLUMN IF NOT EXISTS pipeline_include_in_transit BOOLEAN DEFAULT false;

DROP FUNCTION IF EXISTS process_pipeline_attachments();

CREATE FUNCTION process_pipeline_attachments()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC
) AS $$
DECLARE
  booking         RECORD;
  bill            RECORD;
  remaining       NUMERIC;
  attached_count  INT;
  attached_weight NUMERIC;
  expected_pdate  DATE;
BEGIN
  FOR booking IN
    SELECT
      q.id,
      q.pipeline_remaining_g,
      q.pipeline_region,
      q.pipeline_arrival_date,
      COALESCE(q.pipeline_include_in_transit, false) AS include_in_transit
    FROM cal_quotas q
    WHERE q.pipeline_remaining_g > 0
      AND q.status = 'booked'
      AND q.pipeline_arrival_date IS NOT NULL
      AND q.pipeline_region = 'Bangalore'        -- Bangalore-led bookings only
    ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    remaining       := booking.pipeline_remaining_g;
    attached_count  := 0;
    attached_weight := 0;
    expected_pdate  := booking.pipeline_arrival_date - INTERVAL '1 day';

    -- Eligible bills:
    --   (a) Bangalore purchased one day before arrival, OR
    --   (b) Outstation 24h-transit arriving on the booking's date (opt-in)
    -- Order smallest-first so we pack tightly without overshoot.
    FOR bill IN
      SELECT p.id, p.net_weight, p.application_id
      FROM purchases p
      JOIN branches  b ON b.name = p.branch_name
      WHERE p.booking_id IS NULL
        AND p.is_deleted = false
        AND p.crm_status = 'approved'
        AND (
          (
            b.region = booking.pipeline_region
            AND p.purchase_date = expected_pdate
          )
          OR (
            booking.include_in_transit = true
            AND p.stock_status = 'in_consignment'
            AND p.dispatched_at IS NOT NULL
            AND b.region NOT IN ('Bangalore', 'Kerala')
            AND b.delivery_tat_hours IS NOT NULL
            AND ((p.dispatched_at + (b.delivery_tat_hours || ' hours')::interval) AT TIME ZONE 'Asia/Kolkata')::date
                = booking.pipeline_arrival_date
          )
        )
      ORDER BY p.net_weight ASC, p.purchase_date ASC, p.created_at ASC, p.id ASC
      FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN remaining <= 0;
      -- No-overshoot rule: skip bills bigger than the residual. They stay
      -- unbooked and become available for the next booking that fits them.
      CONTINUE WHEN bill.net_weight > remaining;

      UPDATE purchases
         SET booking_id = booking.id,
             booked_at  = now()
       WHERE id = bill.id;

      attached_count  := attached_count + 1;
      attached_weight := attached_weight + bill.net_weight;
      remaining       := remaining - bill.net_weight;
    END LOOP;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = remaining,
             pipeline_attached_at = now()
       WHERE id = booking.id;
    END IF;

    booking_id      := booking.id;
    bills_attached  := attached_count;
    weight_attached := attached_weight;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated, service_role;

COMMIT;
