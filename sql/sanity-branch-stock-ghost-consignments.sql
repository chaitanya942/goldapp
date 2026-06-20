-- ─────────────────────────────────────────────────────────────────────────────
-- SANITY CHECK — Branch Stock bills that are still tied to an in-flight
-- consignment (i.e. they shouldn't be visible in Branch Stock, but are)
-- ─────────────────────────────────────────────────────────────────────────────
-- Invariant we want to enforce:
--   stock_status = 'at_branch'  ⇒  the bill is NOT a member of any
--   consignment whose status is NOT IN ('cancelled', 'received').
--
-- Whenever that invariant breaks, create_consignment_atomic refuses with
-- "N bill(s) already in an in-flight consignment" — the user sees the bill
-- in Branch Stock, ticks it, hits Create, and gets blocked. Today's
-- WG000325/TUMKUR fix was one instance of this; this sweep finds every other
-- one across the whole DB.
--
-- Three blocks:
--   1) HEADLINE — how many bills are stuck, across how many parents?
--   2) PER-BRANCH — where is it concentrated?
--   3) DETAIL    — full row dump (one row per stuck bill, ordered by parent),
--                  including parent's EWB number, approval_status, and age.
--
-- All read-only. Run, eyeball the detail block, decide whether to cancel
-- the parents (separate UPDATE — not in this file).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) HEADLINE ──────────────────────────────────────────────────────────────
SELECT COUNT(DISTINCT p.id)                  AS stuck_bills,
       COUNT(DISTINCT c.id)                  AS stuck_parent_consignments,
       COUNT(DISTINCT p.id) FILTER (WHERE c.eway_bill_no IS NOT NULL)
                                             AS stuck_bills_with_live_ewb,
       MIN(c.created_at)                     AS oldest_stuck_parent,
       MAX(c.created_at)                     AS newest_stuck_parent
  FROM purchases p
  JOIN consignment_items ci ON ci.purchase_id  = p.id
  JOIN consignments      c  ON c.id            = ci.consignment_id
 WHERE p.is_deleted   = false
   AND p.stock_status = 'at_branch'
   AND c.status NOT IN ('cancelled', 'received');

-- ── 2) PER-BRANCH — where is the mess concentrated? ──────────────────────────
SELECT p.branch_name,
       COUNT(DISTINCT p.id)  AS stuck_bills,
       COUNT(DISTINCT c.id)  AS stuck_parents,
       COUNT(DISTINCT p.id) FILTER (WHERE c.eway_bill_no IS NOT NULL)
                              AS stuck_bills_with_ewb
  FROM purchases p
  JOIN consignment_items ci ON ci.purchase_id  = p.id
  JOIN consignments      c  ON c.id            = ci.consignment_id
 WHERE p.is_deleted   = false
   AND p.stock_status = 'at_branch'
   AND c.status NOT IN ('cancelled', 'received')
 GROUP BY p.branch_name
 ORDER BY stuck_bills DESC, stuck_parents DESC;

-- ── 3) DETAIL — every stuck bill, with its parent's EWB / approval state ─────
SELECT p.application_id                      AS bill_no,
       p.branch_name,
       p.purchase_date,
       p.net_weight,
       p.stock_status,
       c.id                                  AS consignment_id,
       c.tmp_prf_no,
       c.consignment_no                      AS challan_no,
       c.status                              AS parent_status,
       c.approval_status                     AS parent_approval,
       c.eway_bill_no,
       c.ewb_valid_until,
       c.created_at                          AS parent_created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600, 1)
                                             AS parent_age_hours
  FROM purchases p
  JOIN consignment_items ci ON ci.purchase_id  = p.id
  JOIN consignments      c  ON c.id            = ci.consignment_id
 WHERE p.is_deleted   = false
   AND p.stock_status = 'at_branch'
   AND c.status NOT IN ('cancelled', 'received')
 ORDER BY c.created_at, p.application_id;
