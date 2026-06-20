-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: undo the Augmont 22 May 2026 booking
-- ─────────────────────────────────────────────────────────────────────────────
-- Releases every bill currently tagged with the Augmont booking, then deletes
-- the cal_quotas row so the operator can recreate the booking fresh with all
-- breakdown columns (gain, pending, pipeline, additional_gain) populated.
--
-- Paste into the Supabase SQL editor and Run.
-- Idempotent — re-running after the row is gone is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Verify what we're about to undo. The DO block raises NOTICE lines you
--    can read in the SQL editor's Messages tab before/after the cleanup.
DO $$
DECLARE
  bk_id        UUID;
  bills_linked INT;
  bills_weight NUMERIC;
BEGIN
  SELECT id INTO bk_id
    FROM cal_quotas
   WHERE date = '2026-05-22'
     AND party ILIKE 'Augmont'
     AND status = 'booked'
   LIMIT 1;

  IF bk_id IS NULL THEN
    RAISE NOTICE 'No Augmont/22-May/booked row to undo. Nothing to do.';
    RETURN;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(net_weight), 0)
    INTO bills_linked, bills_weight
    FROM purchases
   WHERE booking_id = bk_id;

  RAISE NOTICE 'Found booking % with % attached bills (% g). Releasing…', bk_id, bills_linked, bills_weight;

  -- 2) Release the bills back to the bidding pool.
  UPDATE purchases
     SET booking_id = NULL,
         booked_at  = NULL
   WHERE booking_id = bk_id;

  -- 3) Delete the booking row.
  DELETE FROM cal_quotas WHERE id = bk_id;

  RAISE NOTICE 'Done. Booking deleted, % bills released.', bills_linked;
END $$;

COMMIT;
