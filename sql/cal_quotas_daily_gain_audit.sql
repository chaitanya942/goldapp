-- ─────────────────────────────────────────────────────────────────────────────
-- Daily gain audit — redistribute realized gain across non-Kerala bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- Fires from the 60 s sync cron. For each non-Kerala booking whose
-- arrival_date is today-or-earlier AND whose pipeline is settled
-- (pipeline_remaining_g = 0, i.e. all attached bills + EOD closure done):
--
--   total_committed = SUM(cal_quotas.weight)             (what we promised)
--   total_attached  = SUM(purchases.net_weight)          (what physically arrived)
--   actual_gain     = total_committed − total_attached
--
-- The estimated 3.5 % gain on each booking was just that — an estimate.
-- The real gain only materializes once bills physically land. So at end of
-- the bidding day we redistribute actual_gain proportionally by each
-- booking's attached weight, replacing gain_applied_g with the audited
-- value and zeroing gain_realized_g (its contribution is now folded in).
--
-- Booked weight and net weight stay UNCHANGED — only gain shifts.
-- Kerala (is_kl=true) bookings are excluded — their gain stays 0 by default
-- (the leaf→hub consolidation already absorbs refining loss upstream).
--
-- Trigger details (corrected):
--   · date <= today_ist  — arrival day is today or in the past. The first
--                          midnight tick at 00:00 of arrival_date catches
--                          same-day bookings whose pipeline already settled.
--   · pipeline_remaining_g = 0 — only audit bookings that are no longer
--                                  waiting for more bills. Pipeline-active
--                                  bookings are skipped until close_stale_
--                                  pipelines() zeros them (next EOD).
--   · gain_audited_at IS NULL — never double-audit.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Sentinel: when was this row's gain finalized via the daily audit.
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS gain_audited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cal_quotas_unaudited_past
  ON cal_quotas (date)
  WHERE gain_audited_at IS NULL
    AND is_kl = false
    AND status <> 'cancelled'
    AND pipeline_remaining_g = 0;


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

  -- Iterate distinct dates with un-audited settled non-Kerala bookings.
  -- date <= today_ist so the audit fires the moment arrival day begins
  -- (00:00 IST) for any booking whose pipeline already cleared. The
  -- pipeline_remaining_g = 0 gate ensures we don't audit a row that's
  -- still expecting bills — that one waits for close_stale_pipelines()
  -- to zero its pipeline first.
  FOR d IN
    SELECT DISTINCT q.date
      FROM cal_quotas q
     WHERE q.date <= today_ist
       AND q.is_kl = false
       AND q.status <> 'cancelled'
       AND q.gain_audited_at IS NULL
       AND q.pipeline_remaining_g = 0
     ORDER BY q.date ASC
  LOOP
    SELECT COUNT(*)::INT, COALESCE(SUM(q.weight), 0)
      INTO nbookings, ncommitted
      FROM cal_quotas q
     WHERE q.date = d
       AND q.is_kl = false
       AND q.status <> 'cancelled'
       AND q.gain_audited_at IS NULL
       AND q.pipeline_remaining_g = 0;

    SELECT COALESCE(SUM(p.net_weight), 0)
      INTO nattached
      FROM purchases p
      JOIN cal_quotas q ON q.id = p.booking_id
     WHERE q.date = d
       AND q.is_kl = false
       AND q.status <> 'cancelled'
       AND q.gain_audited_at IS NULL
       AND q.pipeline_remaining_g = 0;

    -- Edge case: no bills attached (all pipeline never filled). Mark
    -- audited with the existing gain values intact — there's no
    -- proportional base to redistribute against.
    IF nattached <= 0 THEN
      UPDATE cal_quotas
         SET gain_audited_at = now()
       WHERE date = d
         AND is_kl = false
         AND status <> 'cancelled'
         AND gain_audited_at IS NULL
         AND pipeline_remaining_g = 0;
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
         AND q.gain_audited_at IS NULL
         AND q.pipeline_remaining_g = 0
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
