-- sql/consignment_reset_e2e.sql
--
-- DESTRUCTIVE — wipes ALL consignment data so E2E testing starts from a clean slate.
--
-- What this script does, in order:
--   1. Counts everything that's about to be deleted / reset (you can see the
--      numbers before committing).
--   2. Resets every purchase that's currently in a consignment-related state
--      (in_consignment / in_transit) back to 'at_branch' at its original
--      branch_name — so the Branch Stock view and reports go back to the
--      pre-consignment state.
--   3. Deletes consignment_items, consignment_activity_log, and consignments
--      themselves. Seed rows (status='seed') are PRESERVED — they are template
--      records used by Phase C onboarding and shouldn't be wiped.
--   4. Re-counts everything so you can verify the cleanup landed.
--
-- HOW TO RUN:
--   1. Open Supabase SQL Editor.
--   2. Paste this whole file, RUN.
--   3. Look at the row counts in the "BEFORE" / "AFTER" notices in the output.
--      AFTER counts should be 0 for consignments / consignment_items, and
--      0 for purchases with stock_status NOT IN ('at_branch', 'sold').
--   4. If anything looks wrong, the BEGIN/COMMIT wrapping means you can
--      hit ROLLBACK in the editor (replace COMMIT at the bottom with ROLLBACK).
--
-- IDEMPOTENT — safe to run again on an already-clean DB (does nothing).

BEGIN;

DO $$
DECLARE
  v_consignments_total       INT;
  v_consignments_seed        INT;
  v_consignments_to_delete   INT;
  v_items_total              INT;
  v_log_total                INT;
  v_purchases_in_motion      INT;
BEGIN
  -- ── BEFORE counts ──────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_consignments_total FROM consignments;
  SELECT COUNT(*) INTO v_consignments_seed  FROM consignments WHERE status = 'seed';
  v_consignments_to_delete := v_consignments_total - v_consignments_seed;
  SELECT COUNT(*) INTO v_items_total FROM consignment_items;
  SELECT COUNT(*) INTO v_log_total   FROM consignment_activity_log;
  SELECT COUNT(*) INTO v_purchases_in_motion
    FROM purchases
    WHERE stock_status IS NOT NULL
      AND stock_status NOT IN ('at_branch', 'sold');

  RAISE NOTICE '── BEFORE ─────────────────────────────────────────';
  RAISE NOTICE 'consignments total .................... %', v_consignments_total;
  RAISE NOTICE 'consignments seed (preserved) ......... %', v_consignments_seed;
  RAISE NOTICE 'consignments to be deleted ............ %', v_consignments_to_delete;
  RAISE NOTICE 'consignment_items to be deleted ....... %', v_items_total;
  RAISE NOTICE 'consignment_activity_log to be deleted  %', v_log_total;
  RAISE NOTICE 'purchases stuck in_consignment/transit  %', v_purchases_in_motion;
END $$;

-- ── 1. Reset every purchase that's currently in a consignment-related state.
--    Send each bill back to its original branch in 'at_branch' state.
--    'sold' bills are NOT touched. 'at_branch' rows are NOT touched.
UPDATE purchases
SET stock_status   = 'at_branch',
    current_branch = branch_name,
    dispatched_at  = NULL
WHERE stock_status IS NOT NULL
  AND stock_status NOT IN ('at_branch', 'sold');

-- ── 2. Delete consignment items (explicit — don't rely on cascade).
DELETE FROM consignment_items
 WHERE consignment_id IN (SELECT id FROM consignments WHERE status <> 'seed');

-- ── 3. Delete activity-log rows (cascades from consignments anyway, but being
--    explicit keeps the script readable and works even if FK was reconfigured).
DELETE FROM consignment_activity_log
 WHERE consignment_id IN (SELECT id FROM consignments WHERE status <> 'seed');

-- ── 4. Delete the consignments themselves. Seed rows preserved.
DELETE FROM consignments WHERE status <> 'seed';

-- ── 5. E2E SETUP: park everything older than today at HO ───────────────
--    Today's (purchase_date = CURRENT_DATE in IST) bills stay at_branch so
--    operations has fresh in-branch stock to run a clean E2E flow on.
--    Everything else is moved to 'at_ho' to mirror the steady-state pre-test
--    inventory (most stock has long since been consolidated to head office).
--    'sold' bills are not touched.
--    IST = UTC+05:30 — using (now() at time zone 'Asia/Kolkata')::date so the
--    cutover lines up with the operations team's calendar day, not UTC.
UPDATE purchases
SET stock_status = 'at_ho'
WHERE stock_status = 'at_branch'
  AND purchase_date < (now() AT TIME ZONE 'Asia/Kolkata')::date;

-- ── AFTER counts ───────────────────────────────────────────────────────
DO $$
DECLARE
  v_consignments_total  INT;
  v_consignments_seed   INT;
  v_items_total         INT;
  v_log_total           INT;
  v_purchases_in_motion INT;
  v_purchases_at_branch INT;
  v_purchases_at_ho     INT;
  v_purchases_today     INT;
  v_today_ist           DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT COUNT(*) INTO v_consignments_total FROM consignments;
  SELECT COUNT(*) INTO v_consignments_seed  FROM consignments WHERE status = 'seed';
  SELECT COUNT(*) INTO v_items_total        FROM consignment_items;
  SELECT COUNT(*) INTO v_log_total          FROM consignment_activity_log;
  SELECT COUNT(*) INTO v_purchases_in_motion
    FROM purchases
    WHERE stock_status IS NOT NULL
      AND stock_status NOT IN ('at_branch', 'at_ho', 'sold');
  SELECT COUNT(*) INTO v_purchases_at_branch
    FROM purchases WHERE stock_status = 'at_branch';
  SELECT COUNT(*) INTO v_purchases_at_ho
    FROM purchases WHERE stock_status = 'at_ho';
  SELECT COUNT(*) INTO v_purchases_today
    FROM purchases
    WHERE stock_status = 'at_branch'
      AND purchase_date = v_today_ist;

  RAISE NOTICE '── AFTER ──────────────────────────────────────────';
  RAISE NOTICE 'consignments total .................... %', v_consignments_total;
  RAISE NOTICE 'consignments seed (preserved) ......... %', v_consignments_seed;
  RAISE NOTICE 'consignment_items remaining ........... %', v_items_total;
  RAISE NOTICE 'consignment_activity_log remaining .... %', v_log_total;
  RAISE NOTICE 'purchases stuck in_consignment/transit  %  (should be 0)', v_purchases_in_motion;
  RAISE NOTICE 'purchases at_branch ................... %  (should equal today-only count below)', v_purchases_at_branch;
  RAISE NOTICE 'purchases at_branch with date = % ..  %  (today IST)', v_today_ist, v_purchases_today;
  RAISE NOTICE 'purchases at_ho ....................... %  (everything else)', v_purchases_at_ho;
END $$;

-- If counts above look wrong, replace COMMIT with ROLLBACK and re-run.
COMMIT;
