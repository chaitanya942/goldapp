-- ─────────────────────────────────────────────────────────────────────────────
-- process_pipeline_attachments v3 — live-recompute + NO OVERSHOOT
-- ─────────────────────────────────────────────────────────────────────────────
-- RULE 1 (16-Jun-2026): the auto-attacher must NEVER attach Bangalore weight
-- beyond what the pipeline needs. The live function (v2) attaches the bill that
-- tips the gap over and credits the surplus to gain_realized_g — that is the
-- "big Bangalore branch attached, 90 g excess" behaviour. Proof: attach-log
-- rows with overshoot_g > 0 (e.g. a 72.21 g bill on a ~48 g gap).
--
-- v3 keeps everything good about v2:
--   • LIVE gap recompute per booking from real attached_net (so manual
--     release/move between runs is reflected immediately)
--   • pipeline_remaining_g > 0 outer filter = the admin "lock" (set it to 0
--     to make the attacher permanently skip a booking)
--   • FIFO ordering, FOR UPDATE SKIP LOCKED, Bangalore-only (PHASE 1)
--
-- v3 removes overshoot:
--   • a bill is attached ONLY if its effective weight fits the remaining gap
--     (net × gain_factor <= remaining_eff). A bill too big is SKIPPED and left
--     unbooked — it stays available for Section 1 / another booking.
--   • gain_realized_g is never incremented (overshoot is structurally dead);
--     overshoot_g in the return is always 0, kept for caller compatibility.
--
-- Pairs with the JS fix (reconcileBookingOverAttachment now detaches only
-- Bangalore section-1 local bills) so neither over-attach NOR its cleanup can
-- ever touch in-transit gold again.
--
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
  attached_net     NUMERIC;
  remaining_eff    NUMERIC;
  attached_count   INT;
  attached_weight  NUMERIC;
  expected_pdate   DATE;
  gain_factor      NUMERIC;
BEGIN
  FOR booking IN
    SELECT q.id, q.weight, COALESCE(q.gain_rate, 0) AS gain_rate,
           q.pipeline_region, q.pipeline_arrival_date
    FROM cal_quotas q
    WHERE q.pipeline_remaining_g > 0
      AND q.status = 'booked'
      AND q.pipeline_arrival_date IS NOT NULL
      AND q.pipeline_region = 'Bangalore'
    ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    gain_factor := 1 + booking.gain_rate;

    -- Live gap recompute from real attached weight.
    SELECT COALESCE(SUM(p.net_weight), 0) INTO attached_net
      FROM purchases p
     WHERE p.booking_id = booking.id
       AND p.is_deleted = false;

    remaining_eff := GREATEST(0, booking.weight - attached_net * gain_factor);

    -- Already fully sourced (or over-sourced via a manual attach): sync the
    -- counter and skip — never attach more.
    IF remaining_eff <= 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = 0, pipeline_attached_at = now()
       WHERE id = booking.id;
      CONTINUE;
    END IF;

    attached_count  := 0;
    attached_weight := 0;
    expected_pdate  := booking.pipeline_arrival_date - INTERVAL '1 day';

    FOR bill IN
      SELECT p.id, p.net_weight
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
      EXIT WHEN remaining_eff <= 0.0001;
      -- NO OVERSHOOT: skip any bill whose effective weight exceeds the gap.
      CONTINUE WHEN bill.net_weight * gain_factor > remaining_eff + 0.0001;

      UPDATE purchases
         SET booking_id = booking.id, booked_at = now()
       WHERE id = bill.id;

      attached_count  := attached_count + 1;
      attached_weight := attached_weight + bill.net_weight;
      remaining_eff   := remaining_eff - bill.net_weight * gain_factor;

      INSERT INTO cal_quota_pipeline_attachments
        (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
      VALUES (booking.id, bill.id, bill.net_weight,
              remaining_eff + bill.net_weight * gain_factor, GREATEST(0, remaining_eff), 0, 'auto_attach');
    END LOOP;

    -- Always sync the cached counter; gain_realized_g is left untouched.
    UPDATE cal_quotas
       SET pipeline_remaining_g = GREATEST(0, remaining_eff), pipeline_attached_at = now()
     WHERE id = booking.id;

    IF attached_count > 0 THEN
      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_weight;
      overshoot_g     := 0;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;

COMMIT;
