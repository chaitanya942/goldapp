-- ─────────────────────────────────────────────────────────────────────────────
-- Daily gain audit — redistribute realized gain across non-Kerala bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- At midnight IST, for each PAST arrival_date that still has non-Kerala
-- bookings without a gain_audited_at timestamp:
--
--   total_committed = SUM(cal_quotas.weight)             (what we promised)
--   total_attached  = SUM(purchases.net_weight)          (what physically arrived)
--   actual_gain     = total_committed − total_attached
--
-- The estimated 3.5 % gain on each booking was just that — an estimate.
-- The real gain only materializes once bills physically land. So at end of
-- day we redistribute actual_gain proportionally by each booking's attached
-- weight, replacing gain_applied_g with the audited value and zeroing
-- gain_realized_g (its contribution is now folded in).
--
-- Booked weight and net weight stay UNCHANGED — only gain shifts.
-- Kerala (is_kl=true) bookings are excluded — their gain stays 0 by default
-- (the leaf→hub consolidation already absorbs refining loss upstream).
--
-- Idempotent. The gain_audited_at sentinel prevents double-auditing the
-- same booking on subsequent sync ticks.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Sentinel: when was this row's gain finalized via the daily audit.
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS gain_audited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cal_quotas_unaudited_past
  ON cal_quotas (date)
  WHERE gain_audited_at IS NULL
    AND is_kl = false
    AND status <> 'cancelled';


CREATE OR REPLACE FUNCTION audit_daily_gain()
RETURNS TABLE (
  audit_date    DATE,
  bookings      INT,
  committed_g   NUMERIC,
  attached_g    NUMERIC,
  total_gain_g  NUMERIC
) AS $$
DECLARE
  today_ist        DATE;
  d                DATE;
  ncommitted       NUMERIC;
  nattached        NUMERIC;
  nbookings        INT;
  ngain            NUMERIC;
  booking          RECORD;
  booking_attached NUMERIC;
  new_gain         NUMERIC;
BEGIN
  today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- Iterate distinct un-audited PAST dates. The partial index above keeps
  -- this O(n) in the unaudited set, no full-table scan.
  FOR d IN
    SELECT DISTINCT q.date
      FROM cal_quotas q
     WHERE q.date < today_ist
       AND q.is_kl = false
       AND q.status <> 'cancelled'
       AND q.gain_audited_at IS NULL
     ORDER BY q.date ASC
  LOOP
    SELECT COUNT(*)::INT, COALESCE(SUM(q.weight), 0)
      INTO nbookings, ncommitted
      FROM cal_quotas q
     WHERE q.date = d
       AND q.is_kl = false
       AND q.status <> 'cancelled';

    SELECT COALESCE(SUM(p.net_weight), 0)
      INTO nattached
      FROM purchases p
      JOIN cal_quotas q ON q.id = p.booking_id
     WHERE q.date = d
       AND q.is_kl = false
       AND q.status <> 'cancelled';

    -- Edge case: no bills attached (all pipeline never filled). Mark
    -- audited with the existing gain values intact — there's no
    -- proportional base to redistribute against.
    IF nattached <= 0 THEN
      UPDATE cal_quotas
         SET gain_audited_at = now()
       WHERE date = d
         AND is_kl = false
         AND status <> 'cancelled';
      audit_date   := d;
      bookings     := nbookings;
      committed_g  := ncommitted;
      attached_g   := 0;
      total_gain_g := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    ngain := ncommitted - nattached;

    -- Per-booking: redistribute and finalize.
    FOR booking IN
      SELECT q.id
        FROM cal_quotas q
       WHERE q.date = d
         AND q.is_kl = false
         AND q.status <> 'cancelled'
    LOOP
      SELECT COALESCE(SUM(p.net_weight), 0)
        INTO booking_attached
        FROM purchases p
       WHERE p.booking_id = booking.id;

      new_gain := CASE
        WHEN nattached > 0 THEN (booking_attached / nattached) * ngain
        ELSE 0
      END;

      UPDATE cal_quotas
         SET gain_applied_g  = new_gain,
             gain_realized_g = 0,           -- folded into the audited gain_applied_g
             gain_audited_at = now()
       WHERE id = booking.id;
    END LOOP;

    audit_date   := d;
    bookings     := nbookings;
    committed_g  := ncommitted;
    attached_g   := nattached;
    total_gain_g := ngain;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION audit_daily_gain() TO authenticated;
GRANT EXECUTE ON FUNCTION audit_daily_gain() TO service_role;

COMMIT;
