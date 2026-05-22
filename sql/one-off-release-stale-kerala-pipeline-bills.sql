-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: release bills the buggy attacher wrongly grabbed for stale
--          Kerala pipeline bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- Before sql/cal_quotas_pipeline_phase4.sql, process_pipeline_attachments()
-- had no past-arrival guard — so a Kerala booking whose arrival_date had
-- already passed kept getting back-filled by bills that moved to the hub on
-- LATER days. Those bills are now stuck with booking_id set (marked booked)
-- when they should be free for the current day's Section 4 bid.
--
-- This script:
--   1. Releases every bill that was attached to a stale Kerala booking
--      AFTER that booking's arrival_date (booked_at IST date > arrival_date).
--      Legit bills (attached on/before arrival day) are left alone.
--      Released bills get booking_id = NULL → they reappear in Section 4.
--   2. Re-settles each affected stale Kerala booking so its breakdown still
--      adds up: pipeline_remaining_g = 0, and the unfilled gap becomes
--      realized gain (gain_realized_g = weight − bills still attached).
--      Booked weight is never touched.
--
-- Paste into the Supabase SQL editor and Run. The NOTICE lines (Messages
-- tab) report what moved. Idempotent — re-running after the cleanup is a
-- no-op (nothing left matching the "attached after arrival" condition).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  today_ist  DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  rel_count  INT;
  rel_weight NUMERIC;
  bk         RECORD;
  bk_count   INT := 0;
BEGIN
  -- ── 1. Release wrongly-attached bills ──────────────────────────────────────
  WITH released AS (
    UPDATE purchases p
       SET booking_id = NULL,
           booked_at  = NULL
      FROM cal_quotas q
     WHERE p.booking_id = q.id
       AND q.is_kl = true
       AND q.status = 'booked'
       AND q.pipeline_arrival_date IS NOT NULL
       AND q.pipeline_arrival_date < today_ist                               -- booking is stale
       AND p.booked_at IS NOT NULL
       AND (p.booked_at AT TIME ZONE 'Asia/Kolkata')::date > q.pipeline_arrival_date  -- attached AFTER arrival
     RETURNING p.id, p.net_weight
  )
  SELECT COUNT(*), COALESCE(SUM(net_weight), 0)
    INTO rel_count, rel_weight
    FROM released;

  RAISE NOTICE 'Released % bill(s), % g — back to the pool (now unbooked, will show in Section 4).',
    rel_count, ROUND(rel_weight, 2);

  -- ── 2. Re-settle each stale Kerala booking ─────────────────────────────────
  FOR bk IN
    SELECT q.id, q.party, q.weight
      FROM cal_quotas q
     WHERE q.is_kl = true
       AND q.status = 'booked'
       AND q.pipeline_arrival_date IS NOT NULL
       AND q.pipeline_arrival_date < today_ist
  LOOP
    UPDATE cal_quotas
       SET pipeline_remaining_g = 0,
           gain_realized_g = GREATEST(0, bk.weight - COALESCE(
             (SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = bk.id), 0)),
           pipeline_attached_at = now()
     WHERE id = bk.id;
    bk_count := bk_count + 1;
  END LOOP;

  RAISE NOTICE 'Re-settled % stale Kerala booking(s): pipeline zeroed, leftover gap booked as realized gain.', bk_count;
END $$;

COMMIT;
