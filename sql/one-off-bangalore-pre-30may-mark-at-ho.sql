-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark all pre-30-May-2026 Bangalore bills as stock_status='at_ho'
-- ─────────────────────────────────────────────────────────────────────────────
-- Companion to sql/one-off-backfill-bangalore-pre-30may-full-sweep.sql.
-- The backfill marked them as Booked (audit_consumed_at); this pass also
-- flips their physical location to HO so they stop showing up in
-- "Branch Stock" / "In Transit" inventory views (which only consider
-- at_branch and in_consignment rows).
--
-- Targets bills that are:
--   - At a Bangalore branch (branches.region='Bangalore' AND is_active=true)
--   - purchase_date <= '2026-05-29'  (cutoff: end of yesterday IST)
--   - Currently at_branch or in_consignment  (the two "in-flight" states)
--   - Not deleted (is_deleted = false)
--
-- DOES NOT touch:
--   - stock_status = 'at_ho'           (already done)
--   - stock_status = 'sent_for_melting'/'melted'  (downstream — don't regress)
--   - bills with purchase_date >= '2026-05-30' (today's flow, leave alone)
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
   AND p.purchase_date <= DATE '2026-05-29'
   AND p.stock_status IN ('at_branch', 'in_consignment')
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- Per-branch breakdown so a stray branch shows up before the UPDATE fires.
SELECT p.branch_name,
       p.stock_status,
       COUNT(*) AS bills,
       ROUND(SUM(p.net_weight)::numeric, 3) AS net_wt_g
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date <= DATE '2026-05-29'
   AND p.stock_status IN ('at_branch', 'in_consignment')
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY p.branch_name, p.stock_status
 ORDER BY bills DESC;

-- ── 2) Apply — flip to at_ho ───────────────────────────────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted     = false
   AND purchase_date <= DATE '2026-05-29'
   AND stock_status IN ('at_branch', 'in_consignment')
   AND branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

-- ── 3) Verify — count of in-flight pre-30-may Bangalore bills should be 0 ─
SELECT COUNT(*) AS bangalore_pre_30may_still_in_flight
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date <= DATE '2026-05-29'
   AND p.stock_status IN ('at_branch', 'in_consignment')
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );
-- Expected: 0

-- Sanity — how many at_ho rows do we now have in the same window? Should
-- equal sum of the two pre-update counts from step 1.
SELECT COUNT(*) AS bangalore_pre_30may_at_ho_now
  FROM purchases p
 WHERE p.is_deleted     = false
   AND p.purchase_date <= DATE '2026-05-29'
   AND p.stock_status   = 'at_ho'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

COMMIT;
