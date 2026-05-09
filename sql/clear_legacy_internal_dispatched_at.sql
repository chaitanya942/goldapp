-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: clear legacy purchases.dispatched_at stamped by pre-fix INTERNAL
-- approvals.
-- ─────────────────────────────────────────────────────────────────────────────
-- Background: until 2026-05-09 the approve_consignment action stamped
-- purchases.dispatched_at on INTERNAL (Branch → Hub) approvals as well as
-- EXTERNAL (Branch → HO / Hub → HO). That was wrong — INTERNAL bills stay at
-- stock_status='at_branch' (just at the hub), so they never enter in_consignment
-- and shouldn't carry a 'transitioned to in_consignment' timestamp.
--
-- The code is now fixed (INTERNAL approvals no longer stamp dispatched_at).
-- This script clears the legacy stamps so the Purchase Data column 'In
-- Consignment Since' renders '—' for hub-located bills, which is correct.
--
-- Safe scope: only touches stock_status='at_branch' rows. Cancellation paths
-- already null out dispatched_at, so the only at_branch rows with a stamped
-- value are these legacy hub bills.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Show the before-state count so the operator can sanity-check.
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM purchases
   WHERE stock_status = 'at_branch'
     AND dispatched_at IS NOT NULL;
  RAISE NOTICE 'Bills with stale dispatched_at to clear: %', v_count;
END $$;

UPDATE purchases
SET dispatched_at = NULL
WHERE stock_status = 'at_branch'
  AND dispatched_at IS NOT NULL;

COMMIT;

-- Verify — should print 0 after the cleanup.
SELECT COUNT(*) AS remaining_stale
  FROM purchases
 WHERE stock_status = 'at_branch'
   AND dispatched_at IS NOT NULL;
