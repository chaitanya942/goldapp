-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — undo the K R PURAM hub-dispatch TEST consignment
-- ─────────────────────────────────────────────────────────────────────────────
-- Cancels consignment WGKA/KA-KRP/MAY/2026/002245 (the test dispatch the
-- operator ran on 30-May-2026 from Branch Stock → Bangalore tab) and
-- returns its bills to at_branch so they can be re-dispatched once the
-- hub-member-discovery bug is fixed.
--
-- What this does:
--   1. Cancels the consignment row (status=cancelled, cancellation_reason
--      set so it shows clearly in audit).
--   2. Returns every linked bill to at_branch + clears dispatched_at.
--   3. Resets leaf bills' current_branch back to their source branch_name
--      (they were stamped to 'K R PURAM' by create_hub_consignment as part
--      of the virtual transfer; we reset since the leaf consignment never
--      actually happened).
--
-- Idempotent — re-running on an already-cancelled consignment is a no-op
-- because the UPDATE matches by status.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — confirm we have the right row before changing state ──────
SELECT id, consignment_no, branch_name, status, total_bills,
       ROUND(total_gross_wt::numeric, 3) AS gross_wt,
       created_at
  FROM consignments
 WHERE consignment_no = 'WGKA/KA-KRP/MAY/2026/002245';

-- Linked bills (should be 6 leaves: LINGARAJPURAM, THANISANDRA, WHITE FIELD,
-- MARATHAHALLI×2, INDIRANAGAR).
SELECT p.id, p.application_id, p.branch_name AS source_branch, p.current_branch,
       p.stock_status, p.gross_weight, p.dispatched_at
  FROM consignment_items ci
  JOIN purchases p ON p.id = ci.purchase_id
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE c.consignment_no = 'WGKA/KA-KRP/MAY/2026/002245'
 ORDER BY p.branch_name, p.application_id;

-- ── 2) Cancel the consignment ─────────────────────────────────────────────
UPDATE consignments
   SET status              = 'cancelled',
       cancelled_at        = NOW(),
       cancellation_reason = 'Test hub dispatch — undone; member-discovery bug excluded the hub itself'
 WHERE consignment_no = 'WGKA/KA-KRP/MAY/2026/002245'
   AND status <> 'cancelled';

-- ── 3) Return bills to at_branch + reset current_branch ──────────────────
UPDATE purchases p
   SET stock_status   = 'at_branch',
       dispatched_at  = NULL,
       current_branch = p.branch_name        -- snap back to source leaf
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE ci.purchase_id = p.id
   AND c.consignment_no = 'WGKA/KA-KRP/MAY/2026/002245';

-- ── 4) Verify — every bill should be back at_branch ──────────────────────
SELECT p.branch_name, COUNT(*) AS bills, p.stock_status,
       BOOL_AND(p.current_branch = p.branch_name) AS current_branch_reset
  FROM consignment_items ci
  JOIN purchases p ON p.id = ci.purchase_id
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE c.consignment_no = 'WGKA/KA-KRP/MAY/2026/002245'
 GROUP BY p.branch_name, p.stock_status;
-- Expected: every row stock_status='at_branch', current_branch_reset=true

COMMIT;
