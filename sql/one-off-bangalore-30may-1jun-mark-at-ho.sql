-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark Bangalore bills with purchase_date 30-May or 1-Jun 2026
-- as stock_status='at_ho'.
-- ─────────────────────────────────────────────────────────────────────────────
-- Continuation of sql/one-off-bangalore-pre-30may-mark-at-ho.sql (which
-- handled purchase_date <= 2026-05-29). This pass closes the two days
-- that slipped through: 30-May and 1-Jun. Bangalore moved to the
-- event-driven lifecycle on the 1-Jun cutover, so any bills from these
-- two dates still flagged at_branch / in_consignment should be flipped
-- to at_ho to match the physical reality.
--
-- Targets bills that are:
--   - At a Bangalore branch (branches.region='Bangalore' AND is_active=true)
--   - purchase_date IN ('2026-05-30', '2026-06-01)
--   - Currently at_branch or in_consignment
--   - Not deleted (is_deleted = false)
--
-- DOES NOT touch:
--   - stock_status = 'at_ho'           (already done)
--   - stock_status = 'sent_for_melting'/'melted'  (downstream — don't regress)
--   - bills outside the two target dates
--   - is_deleted = true                (soft-deleted)
--
-- Idempotent — re-running is a no-op once everything is at_ho.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current stock_status distribution for the target set ─────
SELECT stock_status,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date IN (DATE '2026-05-30', DATE '2026-06-01')
   AND p.stock_status IN ('at_branch', 'in_consignment')
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- Per-branch + per-date breakdown so any stray row shows up before the UPDATE.
SELECT p.purchase_date,
       p.branch_name,
       p.stock_status,
       COUNT(*) AS bills,
       ROUND(SUM(p.net_weight)::numeric, 3) AS net_wt_g
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date IN (DATE '2026-05-30', DATE '2026-06-01')
   AND p.stock_status IN ('at_branch', 'in_consignment')
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY p.purchase_date, p.branch_name, p.stock_status
 ORDER BY p.purchase_date, bills DESC;

-- ── 2) Apply — flip to at_ho ───────────────────────────────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted     = false
   AND purchase_date IN (DATE '2026-05-30', DATE '2026-06-01')
   AND stock_status IN ('at_branch', 'in_consignment')
   AND branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

-- ── 3) Verify — should be 0 in-flight rows for these two dates ────────────
SELECT COUNT(*) AS bangalore_30may_1jun_still_in_flight
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date IN (DATE '2026-05-30', DATE '2026-06-01')
   AND p.stock_status IN ('at_branch', 'in_consignment')
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );
-- Expected: 0

-- Sanity — at_ho rows now in the same window. Should equal the sum of the
-- two pre-update counts from step 1.
SELECT COUNT(*) AS bangalore_30may_1jun_at_ho_now
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date IN (DATE '2026-05-30', DATE '2026-06-01')
   AND p.stock_status   = 'at_ho'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

COMMIT;
