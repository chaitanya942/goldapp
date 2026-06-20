-- ─────────────────────────────────────────────────────────────────────────────
-- One-off v2 — receive ALL stuck KL leaf→hub Issue Vouchers + flip bills
-- to hub stock so hub → HO can be created.
-- ─────────────────────────────────────────────────────────────────────────────
-- v1 had a `created_at >= today` filter which missed yesterday's vouchers
-- (the broken-model rows were created 30 May; today is 31 May). Removed
-- the date filter. The precise tell-tale of the broken state is:
--     movement_type = 'INTERNAL'
--   + source branch region = 'Kerala'
--   + status = 'dispatched'
--   + received_at IS NULL
-- No legitimate INTERNAL voucher should stay in that combination — the
-- documented model auto-receives at creation time. So the filter is
-- self-protecting; we can't accidentally over-flip anything.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — which KL leaf→hub vouchers are stuck? (no date filter) ─
SELECT c.id, c.tmp_prf_no, c.consignment_no AS challan_no,
       c.branch_name        AS source_leaf,
       c.dest_branch        AS dest_hub,
       c.status, c.created_at, c.received_at,
       c.total_bills
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'dispatched'
   AND c.received_at IS NULL
 ORDER BY c.created_at;

-- ── 2) Headline — how many bills are about to move to hub stock? ────────
SELECT COUNT(DISTINCT c.id)  AS vouchers_to_receive,
       COUNT(ci.purchase_id) AS bills_to_flip_to_hub,
       SUM(c.total_bills)    AS expected_bills_total
  FROM consignments c
  JOIN branches           b ON b.name = c.branch_name
  JOIN consignment_items ci ON ci.consignment_id = c.id
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'dispatched'
   AND c.received_at IS NULL;

-- ── 3) Receive the vouchers ─────────────────────────────────────────────
UPDATE consignments c
   SET status      = 'received',
       received_at = NOW(),
       received_by = 'system-auto-receive-fix-v2'
  FROM branches b
 WHERE b.name = c.branch_name
   AND c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'dispatched'
   AND c.received_at IS NULL;

-- ── 4) Flip bills' current_branch to the destination hub ────────────────
UPDATE purchases p
   SET current_branch = c.dest_branch,
       stock_status   = 'at_branch'   -- assert; should already be at_branch
  FROM consignment_items ci
  JOIN consignments      c ON c.id = ci.consignment_id
  JOIN branches          b ON b.name = c.branch_name
 WHERE ci.purchase_id  = p.id
   AND c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.received_by   = 'system-auto-receive-fix-v2';

-- ── 5) Stamp consignment_items.received_at to match the voucher ─────────
UPDATE consignment_items ci
   SET received_at       = c.received_at,
       received_by_email = c.received_by
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE ci.consignment_id = c.id
   AND c.movement_type   = 'INTERNAL'
   AND b.region          = 'Kerala'
   AND c.received_by     = 'system-auto-receive-fix-v2'
   AND ci.received_at IS NULL;

-- ── 6) Audit log entry per voucher ──────────────────────────────────────
INSERT INTO consignment_activity_log (consignment_id, event_type, actor_email, details, created_at)
SELECT c.id,
       'received_at_hub_backfill',
       'chaitanya@whitegold.money',
       jsonb_build_object(
         'source_leaf',  c.branch_name,
         'dest_hub',     c.dest_branch,
         'voucher',      c.consignment_no,
         'reason',       'Auto-receive backfill v2 — vouchers from yesterday were marooned by a transient model regression. Bills flipped to hub current_branch so hub→HO can be built.',
         'triggered_by', 'manual_sql_one_off'
       ),
       NOW()
  FROM consignments c
  JOIN branches b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.received_by   = 'system-auto-receive-fix-v2';

-- ── 7) Verify — vouchers should now read received ───────────────────────
SELECT c.tmp_prf_no, c.consignment_no AS challan_no,
       c.branch_name AS source_leaf,
       c.dest_branch AS dest_hub,
       c.status, c.received_at, c.received_by
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.received_by   = 'system-auto-receive-fix-v2'
 ORDER BY c.received_at;

-- ── 8) Verify — every flipped bill should have current_branch = dest_hub ─
--      Should return 0 rows. Anything non-zero is a bug.
SELECT p.application_id, p.branch_name AS origin_leaf,
       p.current_branch, c.dest_branch AS expected_hub,
       p.stock_status
  FROM consignment_items ci
  JOIN consignments      c ON c.id = ci.consignment_id
  JOIN purchases         p ON p.id = ci.purchase_id
  JOIN branches          b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.received_by   = 'system-auto-receive-fix-v2'
   AND p.current_branch <> c.dest_branch
 LIMIT 20;

-- ── 9) Verify — pick a bill from the original error and confirm it's
--      no longer in any in-flight consignment.
SELECT p.application_id, p.current_branch, p.stock_status,
       c.consignment_no, c.status, c.received_at
  FROM purchases p
  JOIN consignment_items ci ON ci.purchase_id = p.id
  JOIN consignments      c  ON c.id = ci.consignment_id
 WHERE p.application_id IN ('WGKA100979', 'WGKA100878', 'WGKA100932')
 ORDER BY p.application_id, c.created_at;

COMMIT;
