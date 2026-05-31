-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — receive today's stuck KL leaf→hub Issue Vouchers + flip bills
-- to hub stock so hub → HO can be created.
-- ─────────────────────────────────────────────────────────────────────────────
-- Background:
--   Operational model (documented at top of /api/consignments
--   create_consignment): INTERNAL (Branch → Hub) is an instantaneous
--   transfer. The voucher is auto-received at creation, bills' current_branch
--   flips to the destination hub, and stock stays at_branch but is now
--   visible in hub stock. The hub → HO consignment is then built on those
--   bills.
--
--   Earlier today I broke that model for Kerala specifically (commit 79f2ae4)
--   to make Section 2 of KL Bidding Volume show "in motion" leaf → hub
--   bills. The side effect: ~30 KL leaf → hub vouchers created today
--   ended up status='dispatched' with received_at=null AND bills'
--   current_branch never updated to the hub. Bills got marooned —
--   couldn't be redispatched (in-flight check), couldn't be aggregated
--   at hub for the hub → HO run.
--
--   This sweep finishes the documented model on those rows:
--     1. Vouchers: status → 'received', received_at → NOW()
--     2. Bills:    current_branch → dest_branch (the hub)
--     3. Bills:    stock_status confirmed at_branch (already correct, but
--                  asserted for safety)
--     4. consignment_items: received_at stamped (mirrors manual receive)
--     5. Audit log entry per voucher
--
--   The route fix committed alongside this one prevents new vouchers from
--   landing in the broken state.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — which KL leaf→hub vouchers are stuck? ──────────────────
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
   AND c.created_at  >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
 ORDER BY c.created_at;

-- ── 2) Headline — how many bills are about to move to hub stock? ────────
SELECT COUNT(DISTINCT c.id) AS vouchers_to_receive,
       COUNT(ci.purchase_id) AS bills_to_flip_to_hub,
       SUM(c.total_bills)   AS expected_bills_total
  FROM consignments c
  JOIN branches      b  ON b.name = c.branch_name
  JOIN consignment_items ci ON ci.consignment_id = c.id
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'dispatched'
   AND c.received_at IS NULL
   AND c.created_at  >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

-- ── 3) Receive the vouchers ─────────────────────────────────────────────
UPDATE consignments c
   SET status      = 'received',
       received_at = NOW(),
       received_by = 'system-auto-receive-fix'
  FROM branches b
 WHERE b.name = c.branch_name
   AND c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'dispatched'
   AND c.received_at IS NULL
   AND c.created_at  >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

-- ── 4) Flip bills' current_branch to the destination hub ────────────────
--      Mirrors what create_consignment now does at creation time.
UPDATE purchases p
   SET current_branch = c.dest_branch,
       stock_status   = 'at_branch'   -- assert; should already be at_branch
  FROM consignment_items ci
  JOIN consignments      c ON c.id = ci.consignment_id
  JOIN branches          b ON b.name = c.branch_name
 WHERE ci.purchase_id  = p.id
   AND c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'received'
   AND c.received_by   = 'system-auto-receive-fix';

-- ── 5) Stamp consignment_items.received_at to match the voucher ─────────
UPDATE consignment_items ci
   SET received_at        = c.received_at,
       received_by_email  = c.received_by
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE ci.consignment_id = c.id
   AND c.movement_type   = 'INTERNAL'
   AND b.region          = 'Kerala'
   AND c.status          = 'received'
   AND c.received_by     = 'system-auto-receive-fix'
   AND ci.received_at IS NULL;

-- ── 6) Audit log entry per voucher ──────────────────────────────────────
INSERT INTO consignment_activity_log (consignment_id, event_type, actor_email, details, created_at)
SELECT c.id,
       'received_at_hub_backfill',
       'chaitanya@whitegold.money',
       jsonb_build_object(
         'source_leaf', c.branch_name,
         'dest_hub',    c.dest_branch,
         'voucher',     c.consignment_no,
         'reason',      'Auto-receive backfill — KL leaf->hub vouchers created under transient broken model were marooned. Bills flipped to hub current_branch so hub->HO can be built.',
         'triggered_by','manual_sql_one_off'
       ),
       NOW()
  FROM consignments c
  JOIN branches b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.status        = 'received'
   AND c.received_by   = 'system-auto-receive-fix';

-- ── 7) Verify — vouchers should now read received ───────────────────────
SELECT c.tmp_prf_no, c.consignment_no AS challan_no,
       c.branch_name AS source_leaf,
       c.dest_branch AS dest_hub,
       c.status, c.received_at, c.received_by
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.received_by   = 'system-auto-receive-fix'
 ORDER BY c.received_at;

-- ── 8) Verify — bills' current_branch should now match dest_hub ─────────
SELECT p.application_id, p.branch_name AS origin_leaf,
       p.current_branch, c.dest_branch AS expected_hub,
       p.stock_status
  FROM consignment_items ci
  JOIN consignments      c ON c.id = ci.consignment_id
  JOIN purchases         p ON p.id = ci.purchase_id
  JOIN branches          b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.received_by   = 'system-auto-receive-fix'
   AND p.current_branch <> c.dest_branch   -- should return 0 rows
 LIMIT 20;

COMMIT;
