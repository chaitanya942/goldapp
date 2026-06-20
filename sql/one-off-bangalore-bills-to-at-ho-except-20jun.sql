-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: mark ALL Bangalore-branch bills as received at HO (stock_status →
-- 'at_ho') EXCEPT those purchased on 20 Jun 2026 (today's stock stays at branch).
--
-- Scope:
--   • branch region = 'Bangalore'    (derived from the branches table, not hardcoded)
--   • purchase_date <> '2026-06-20'   (everything except this date; NULL-dated
--                                      rows are left untouched on purpose)
--   • crm_status = 'approved'         (real purchased gold only — pending / rejected
--                                      / deleted rows are not physical stock)
--   • is_deleted = false
--   • not already at_ho
--
-- Covers both old_crm and new_crm Bangalore bills. current_branch is cleared
-- (the gold is at HO, not at a branch). dispatched_at is left intact.
-- Drop the crm_status filter in STEP 2 if you want to flip non-approved rows too.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW — what will flip, by date / source / status ─────────────
SELECT p.purchase_date, p.crm_source, p.stock_status,
       count(*)                              AS bills,
       round(sum(p.net_weight)::numeric, 2)  AS net_g
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE b.region         = 'Bangalore'
   AND p.purchase_date <> '2026-06-20'
   AND p.crm_status     = 'approved'
   AND p.is_deleted     = false
   AND p.stock_status  <> 'at_ho'
 GROUP BY p.purchase_date, p.crm_source, p.stock_status
 ORDER BY p.purchase_date, p.crm_source, p.stock_status;

-- ── STEP 2 · APPLY ───────────────────────────────────────────────────────────
BEGIN;

UPDATE purchases p
   SET stock_status   = 'at_ho',
       current_branch = NULL
  FROM branches b
 WHERE b.name = p.branch_name
   AND b.region         = 'Bangalore'
   AND p.purchase_date <> '2026-06-20'
   AND p.crm_status     = 'approved'
   AND p.is_deleted     = false
   AND p.stock_status  <> 'at_ho';

COMMIT;

-- ── STEP 3 · VERIFY — approved Bangalore non-20-Jun bills still not at_ho (expect 0)
SELECT count(*) AS still_not_at_ho
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE b.region         = 'Bangalore'
   AND p.purchase_date <> '2026-06-20'
   AND p.crm_status     = 'approved'
   AND p.is_deleted     = false
   AND p.stock_status  <> 'at_ho';

-- ── STEP 4 · SANITY — what remains at branch for Bangalore (expect only 20-Jun)
SELECT p.purchase_date, count(*) AS bills, round(sum(p.net_weight)::numeric, 2) AS net_g
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE b.region        = 'Bangalore'
   AND p.is_deleted    = false
   AND p.stock_status <> 'at_ho'
 GROUP BY p.purchase_date
 ORDER BY p.purchase_date;
