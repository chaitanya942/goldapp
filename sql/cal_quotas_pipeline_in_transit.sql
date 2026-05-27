-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline back-fill: extend to include outstation 24h in-transit bills
-- ─────────────────────────────────────────────────────────────────────────────
-- The original rule was strict: a pipeline (excess weight committed on a
-- booking, in grams) could only be back-filled by Bangalore purchases made
-- on (arrival_date - 1). Bills already in transit from outstation branches
-- arriving on the booking's arrival_date were not eligible — even though
-- physically they're the same incoming gold.
--
-- Per accounts, operators want a per-booking opt-in to also pull from those
-- outstation 24h-transit bills. The booking-time decision is captured in a
-- new boolean column, and the auto-attacher honours it when picking
-- eligible bills.
--
-- The original Bangalore behaviour is unchanged (default = false). Kerala
-- pipeline flow is untouched — its hub flow rules already differ.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- New flag — default OFF so existing bookings keep their original behaviour.
ALTER TABLE cal_quotas
  ADD COLUMN IF NOT EXISTS pipeline_include_in_transit BOOLEAN DEFAULT false;

-- Replace the attacher to honour the flag. Only the bill-selection WHERE
-- changes; everything else (FIFO ordering, overshoot-to-gain, audit row
-- write) is identical to sql/cal_quotas_pipeline_attach.sql.
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
    overshoot       := 0;
    expected_pdate  := booking.pipeline_arrival_date - INTERVAL '1 day';

    -- Eligible bills:
    --   (a) Bangalore purchased one day before arrival (default behaviour)
    --   (b) Outstation 24h-transit arriving on the booking's arrival_date
    --       (only when pipeline_include_in_transit = true; never Kerala)
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

    IF remaining < 0 THEN
      overshoot := -remaining;
      remaining := 0;
    END IF;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = remaining,
             gain_realized_g      = COALESCE(gain_realized_g, 0) + overshoot,
             pipeline_attached_at = now()
       WHERE id = booking.id;
    END IF;

    booking_id      := booking.id;
    bills_attached  := attached_count;
    weight_attached := attached_weight;
    overshoot_g     := overshoot;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated, service_role;

COMMIT;
