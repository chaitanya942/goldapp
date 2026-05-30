-- ─────────────────────────────────────────────────────────────────────────────
-- PREVIEW (read-only) — bills that WOULD be marked as booked (audit-consumed)
-- in the upcoming sweep. Mirrors the Bangalore backfill pattern across all
-- regions, but carves out the bills that are still operationally live.
-- ─────────────────────────────────────────────────────────────────────────────
-- Protected (NOT to be marked):
--   1) 30 May 2026 Bangalore purchases
--   2) Bills currently at_branch (visible in Branch Stock)
--   3) Bills on consignments created 30 May 2026 (any TAT, any region)
--   4) Bills on consignments created 29 May 2026 from branches with
--      delivery_tat_hours = 48 (arriving 31 May, eligible for today's bid)
--
-- Eligible to mark = everything else (excluding already-booked, already
-- audit-consumed, deleted, and the four carve-outs above).
--
-- Wrapped in BEGIN/ROLLBACK so the temp table is the only side-effect, and
-- it dies the moment the transaction ends — zero state left behind.
-- This is purely a preview; the matching UPDATE will be a separate file.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Build the candidate set ONCE in a temp table. PostgreSQL CTEs only live
-- for a single statement, which is why a multi-block preview can't reuse
-- the WITH directly — temp table sidesteps that.
CREATE TEMP TABLE _candidates AS
WITH protected_bills AS (
  -- 1) 30 May 2026 Bangalore purchases — today's bidding pool
  SELECT p.id
    FROM purchases p
    JOIN branches  b ON b.name = p.branch_name
   WHERE p.is_deleted = false
     AND b.region = 'Bangalore'
     AND p.purchase_date = DATE '2026-05-30'

  UNION

  -- 2) Bills currently at_branch — visible in Branch Stock, still live
  SELECT id
    FROM purchases
   WHERE is_deleted = false
     AND stock_status = 'at_branch'

  UNION

  -- 3) Bills on consignments created on 30 May 2026 (in_transit today)
  SELECT ci.purchase_id
    FROM consignment_items ci
    JOIN consignments c ON c.id = ci.consignment_id
   WHERE c.created_at >= '2026-05-30T00:00:00+05:30'
     AND c.created_at <  '2026-05-31T00:00:00+05:30'
     AND c.status <> 'cancelled'

  UNION

  -- 4) Bills on 48h-TAT consignments created 29 May 2026 (arrive 31 May,
  --    eligible for today's bid as Section 3 view-only)
  SELECT ci.purchase_id
    FROM consignment_items ci
    JOIN consignments c  ON c.id   = ci.consignment_id
    JOIN branches     br ON br.name = c.branch_name
   WHERE c.created_at >= '2026-05-29T00:00:00+05:30'
     AND c.created_at <  '2026-05-30T00:00:00+05:30'
     AND br.delivery_tat_hours = 48
     AND c.status <> 'cancelled'
)
SELECT p.id,
       p.branch_name,
       p.purchase_date,
       p.net_weight,
       p.gross_weight,
       p.stock_status,
       br.region
  FROM purchases p
  JOIN branches  br ON br.name = p.branch_name
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.id NOT IN (SELECT id FROM protected_bills);

-- ── 1) Headline totals — how big is this sweep? ───────────────────────────
SELECT 'TOTAL'                                  AS bucket,
       COUNT(*)                                 AS bills,
       ROUND(SUM(net_weight)::numeric, 3)       AS net_wt_g,
       ROUND(SUM(gross_weight)::numeric, 3)     AS gross_wt_g,
       MIN(purchase_date)                       AS oldest_purchase_date,
       MAX(purchase_date)                       AS newest_purchase_date
  FROM _candidates;

-- ── 2) Per-region breakdown ───────────────────────────────────────────────
SELECT region,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g
  FROM _candidates
 GROUP BY region
 ORDER BY bills DESC;

-- ── 3) Per-stock_status breakdown — confirms at_branch count is 0 ────────
SELECT stock_status,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g
  FROM _candidates
 GROUP BY stock_status
 ORDER BY bills DESC;

-- ── 4) Per-branch top 30 — spot anomalies before committing ──────────────
SELECT branch_name,
       region,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g
  FROM _candidates
 GROUP BY branch_name, region
 ORDER BY bills DESC
 LIMIT 30;

-- ── 5) Sanity check on each protected bucket — should match operational
--      reality before we commit to the sweep.
SELECT 'A. Bangalore 30 May purchases'  AS protected_bucket,
       COUNT(*)                          AS bills
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE p.is_deleted = false
   AND b.region = 'Bangalore'
   AND p.purchase_date = DATE '2026-05-30'
UNION ALL
SELECT 'B. at_branch (any region)',
       COUNT(*)
  FROM purchases
 WHERE is_deleted = false
   AND stock_status = 'at_branch'
UNION ALL
SELECT 'C. Bills on 30 May consignments',
       COUNT(DISTINCT ci.purchase_id)
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE c.created_at >= '2026-05-30T00:00:00+05:30'
   AND c.created_at <  '2026-05-31T00:00:00+05:30'
   AND c.status <> 'cancelled'
UNION ALL
SELECT 'D. Bills on 29 May 48h-TAT consignments',
       COUNT(DISTINCT ci.purchase_id)
  FROM consignment_items ci
  JOIN consignments c  ON c.id   = ci.consignment_id
  JOIN branches     br ON br.name = c.branch_name
 WHERE c.created_at >= '2026-05-29T00:00:00+05:30'
   AND c.created_at <  '2026-05-30T00:00:00+05:30'
   AND br.delivery_tat_hours = 48
   AND c.status <> 'cancelled';

-- Read-only preview — ROLLBACK drops the temp table and leaves the database
-- exactly as it was.
ROLLBACK;
