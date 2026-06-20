-- ─────────────────────────────────────────────────────────────────────────────
-- process_pipeline_attachments v2 — recompute pipeline_remaining_g live
-- ─────────────────────────────────────────────────────────────────────────────
-- v1 behaviour (cal_quotas_pipeline_attach.sql):
--   - Walks cal_quotas rows WHERE pipeline_remaining_g > 0.
--   - Trusts the stored counter as the target; only DECREMENTS it when a
--     bill attaches. Never re-reads the live attached_net.
--
-- Symptom that motivated this rewrite:
--   When ops manually releases bills (set booking_id = NULL) or moves
--   bills between bookings, the stored pipeline_remaining_g on the
--   affected bookings stays stale. The next CRM sync calls the attacher,
--   it sees pipeline_remaining_g > 0 on a booking that actually has NO
--   real gap (or has a different gap than the counter says), and
--   re-attaches bills — sometimes over-filling. The bidding UI then
--   shows NET > BOOKED on a row whose pipeline appears closed, and ops
--   has to release the excess again. Loop.
--
-- v2 fix — RECOMPUTE the gap at the start of each booking iteration from
-- the LIVE attached_net:
--     live_remaining_effective = MAX(0, weight − attached_net × (1 + gain_rate))
--
--   - If live remaining is 0 (or negative), sync the counter to 0 and
--     SKIP. No bills attached.
--   - Else, use live remaining as the target and walk eligible bills FIFO
--     just like v1. Decrement remaining by net × (1 + gain_rate) per
--     attach so the accounting stays in effective terms.
--   - At the end of each booking, always update pipeline_remaining_g to
--     the new live value (whether or not any bill was actually attached).
--
-- Behavioural preservations:
--   - WHERE pipeline_remaining_g > 0 stays as the outer filter. This keeps
--     the partial index useful AND preserves the "lock" semantic — an
--     admin can set pipeline_remaining_g = 0 on any booking to make the
--     attacher permanently skip it (until they explicitly reopen it by
--     setting the column back to > 0).
--   - FIFO ordering, gain_realized_g credit on overshoot, FOR UPDATE
--     SKIP LOCKED for concurrent-safe bill claims — all unchanged.
--   - Same return shape (booking_id, bills_attached, weight_attached,
--     overshoot_g) so the sync endpoint that consumes the return value
--     doesn't need to change.
--   - Bangalore-only filter retained (PHASE 1). Other regions still
--     pending separate work; this rewrite doesn't extend coverage.
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
  attached_net     NUMERIC;
  remaining_eff    NUMERIC;
  attached_count   INT;
  attached_weight  NUMERIC;
  overshoot_eff    NUMERIC;
  expected_pdate   DATE;
  gain_factor      NUMERIC;
BEGIN
  FOR booking IN
    SELECT
      q.id,
      q.weight,
      COALESCE(q.gain_rate, 0) AS gain_rate,
      q.pipeline_region,
      q.pipeline_arrival_date
    FROM cal_quotas q
    WHERE q.pipeline_remaining_g > 0
      AND q.status = 'booked'
      AND q.pipeline_arrival_date IS NOT NULL
      AND q.pipeline_region = 'Bangalore'
    ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    gain_factor := 1 + booking.gain_rate;

    -- ── Live recomputation of the gap ───────────────────────────────────
    -- Read attached_net fresh from purchases so manual releases / attaches
    -- between attacher runs are reflected immediately.
    SELECT COALESCE(SUM(p.net_weight), 0) INTO attached_net
      FROM purchases p
     WHERE p.booking_id = booking.id
       AND p.is_deleted = false;

    remaining_eff := GREATEST(0, booking.weight - attached_net * gain_factor);

    -- If the booking is already fully sourced (or over-sourced from a
    -- manual attach), sync the stored counter and move on without
    -- touching any new bills.
    IF remaining_eff <= 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = 0,
             pipeline_attached_at = now()
       WHERE id = booking.id;
      CONTINUE;
    END IF;

    -- ── Walk eligible incoming bills FIFO, attach until gap closes ──────
    attached_count  := 0;
    attached_weight := 0;
    overshoot_eff   := 0;
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
      EXIT WHEN remaining_eff <= 0;

      UPDATE purchases
         SET booking_id = booking.id,
             booked_at  = now()
       WHERE id = bill.id;

      attached_count  := attached_count + 1;
      attached_weight := attached_weight + bill.net_weight;
      remaining_eff   := remaining_eff - bill.net_weight * gain_factor;
    END LOOP;

    -- ── Overshoot accounting ────────────────────────────────────────────
    -- If the last bill made effective remaining go negative, the surplus
    -- is credited to gain_realized_g. Original semantics: overshoot is
    -- recorded as NET surplus weight (effective overshoot ÷ gain_factor).
    IF remaining_eff < 0 THEN
      overshoot_eff := -remaining_eff;
    END IF;

    UPDATE cal_quotas
       SET pipeline_remaining_g = GREATEST(0, remaining_eff),
           gain_realized_g      = gain_realized_g + COALESCE(overshoot_eff / gain_factor, 0),
           pipeline_attached_at = now()
     WHERE id = booking.id;

    IF attached_count > 0 THEN
      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_weight;
      overshoot_g     := overshoot_eff;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;

COMMIT;
