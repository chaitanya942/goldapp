-- ─────────────────────────────────────────────────────────────────────────────
-- EOD pipeline attacher — overshoot allowed, debits gain (23:30 reconciliation)
-- ─────────────────────────────────────────────────────────────────────────────
-- The DAYTIME attacher (process_pipeline_attachments, phase 6) is no-overshoot:
-- it skips a bill whose gain-adjusted weight exceeds the pipeline still owed, so
-- a real purchased bill can end up unbooked and then swept to standalone gain at
-- 23:30 (the WGKA-56644 / Sunkadakatte case: 53.53 g bill, only 10.35 g pipeline
-- left on the Augmont booking → skipped → consumed as gain, never attached).
--
-- This function is the EOD-ONLY variant (run by /api/bidding/section1-audit
-- before the gain sweep). Per the 18-Jun decision:
--   • Pipeline still owed  → fill it from leftover unbooked bills, FIFO.
--   • Autobooked           → the bill that tips the gap IS attached (overshoot
--                            allowed) so it SHOWS in the booking instead of
--                            landing in standalone-gain limbo.
--   • Excess attached      → the overshoot DEBITS the booking's realized gain
--                            (gain_realized_g − overshoot): the company
--                            over-delivered gold, so it realizes LESS gain.
--   • No pipeline owed      → nothing is force-attached; those leftover bills
--                            stay for the gain sweep (Pass 2 of the audit).
--
-- Bangalore + Kerala (KL pipelines draw from hub-stock bills). Keeps phase 6's
-- Sunday-skip purchase-day match and the stale-arrival guard. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP FUNCTION IF EXISTS process_pipeline_attachments_eod();

CREATE OR REPLACE FUNCTION process_pipeline_attachments_eod()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC,
  overshoot_g     NUMERIC,
  gain_debited_g  NUMERIC
) AS $$
DECLARE
  booking          RECORD;
  bill             RECORD;
  remaining        NUMERIC;   -- gross pipeline still owed
  remaining_before NUMERIC;
  attached_count   INT;
  attached_weight  NUMERIC;
  overshoot        NUMERIC;
  expected_pdate   DATE;
  kerala_hubs      TEXT[];
  today_ist        DATE;
  rate             NUMERIC;
  eff              NUMERIC;
  eps              CONSTANT NUMERIC := 0.001;
BEGIN
  today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT array_agg(name) INTO kerala_hubs
    FROM branches WHERE region = 'Kerala' AND is_hub = true;

  FOR booking IN
    SELECT q.id, q.pipeline_remaining_g, q.pipeline_region, q.pipeline_arrival_date, q.gain_rate
      FROM cal_quotas q
     WHERE q.pipeline_remaining_g > 0
       AND q.status = 'booked'
       AND q.pipeline_arrival_date IS NOT NULL
       AND q.pipeline_arrival_date >= today_ist      -- never fill a stale (past-arrival) booking
       AND q.pipeline_region IN ('Bangalore', 'Kerala')
     ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    remaining       := booking.pipeline_remaining_g;
    attached_count  := 0;
    attached_weight := 0;
    overshoot       := 0;
    rate            := COALESCE(booking.gain_rate, 0);

    expected_pdate := booking.pipeline_arrival_date - INTERVAL '1 day';
    IF EXTRACT(DOW FROM expected_pdate) = 0 THEN          -- Sunday → step back one more
      expected_pdate := expected_pdate - INTERVAL '1 day';
    END IF;

    FOR bill IN
      SELECT p.id, p.net_weight
        FROM purchases p
        JOIN branches b ON b.name = p.branch_name
       WHERE p.booking_id IS NULL
         AND p.is_deleted = false
         AND p.crm_status = 'approved'
         AND COALESCE(p.audit_hold, false) = false          -- ops parked it out of the audit
         AND (
              -- Bangalore: today's purchase-day feeding this arrival
              (booking.pipeline_region = 'Bangalore'
               AND b.region = 'Bangalore'
               AND p.purchase_date = expected_pdate)
              OR
              -- Kerala: bills sitting at a KL hub, ready for hub→HO
              (booking.pipeline_region = 'Kerala'
               AND kerala_hubs IS NOT NULL
               AND b.region = 'Kerala'
               AND p.current_branch = ANY(kerala_hubs)
               AND p.stock_status = 'at_branch')
             )
       ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC
       FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN remaining <= eps;
      eff := COALESCE(bill.net_weight, 0) * (1 + rate);
      remaining_before := remaining;

      -- Attach the bill EVEN IF it overshoots — the EOD rule is "don't orphan a
      -- real bill when a pipeline is owed". The tipping bill closes the gap.
      UPDATE purchases
         SET booking_id = booking.id, booked_at = now()
       WHERE id = bill.id;
      attached_count  := attached_count + 1;
      attached_weight := attached_weight + bill.net_weight;

      IF eff > remaining + eps THEN
        -- Overshoot: this bill fills the gap and spills over. Pipeline → 0;
        -- the spill is debited from gain below.
        overshoot := eff - remaining;
        remaining := 0;
        INSERT INTO cal_quota_pipeline_attachments
          (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
        VALUES (booking.id, bill.id, bill.net_weight, remaining_before, 0, overshoot, 'eod_overshoot_debit');
        EXIT;   -- gap closed
      ELSE
        remaining := remaining - eff;
        INSERT INTO cal_quota_pipeline_attachments
          (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
        VALUES (booking.id, bill.id, bill.net_weight, remaining_before, GREATEST(0, remaining), 0, 'eod_attach');
      END IF;
    END LOOP;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = GREATEST(0, remaining),
             gain_realized_g      = gain_realized_g - overshoot,   -- DEBIT: over-delivered gold = less realized gain
             pipeline_attached_at = now()
       WHERE id = booking.id;

      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_weight;
      overshoot_g     := overshoot;
      gain_debited_g  := overshoot;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments_eod() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments_eod() TO service_role;

COMMIT;
