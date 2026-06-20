-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: mark all Bangalore-branch bills purchased on/before 14 Jun 2026 as
-- received at HO (stock_status → 'at_ho').
--
-- Scope:
--   • branch region = 'Bangalore'   (33 branches, derived from the branches table
--                                     — not hardcoded)
--   • purchase_date <= '2026-06-14'  (inclusive)
--   • crm_status = 'approved'        (real purchased gold only — deleted / pending
--                                     / rejected rows are NOT physical stock, so
--                                     they're left alone)
--   • is_deleted = false
--   • not already at_ho
--
-- As of writing this hits ~85 bills / ~2156.52 g (all currently at_branch).
-- current_branch is cleared (the gold is at HO, not at a branch). dispatched_at
-- is left untouched.
--
-- To include the non-approved rows too, drop the crm_status filter in STEP 2.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW — what will flip, by status ─────────────────────────────
SELECT p.stock_status, p.crm_status,
       count(*)                              AS bills,
       round(sum(p.net_weight)::numeric, 2)  AS net_g
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE b.region        = 'Bangalore'
   AND p.purchase_date <= '2026-06-14'
   AND p.is_deleted    = false
   AND p.stock_status <> 'at_ho'
 GROUP BY p.stock_status, p.crm_status
 ORDER BY p.stock_status, p.crm_status;
-- Expect: at_branch / approved ≈ 85 bills / 2156.52 g  (this is what STEP 2 flips)
--         at_branch / deleted  ≈ 17 bills              (excluded — not real stock)

-- ── STEP 2 · APPLY ───────────────────────────────────────────────────────────
BEGIN;

UPDATE purchases p
   SET stock_status   = 'at_ho',
       current_branch = NULL
  FROM branches b
 WHERE b.name = p.branch_name
   AND b.region        = 'Bangalore'
   AND p.purchase_date <= '2026-06-14'
   AND p.crm_status     = 'approved'
   AND p.is_deleted     = false
   AND p.stock_status  <> 'at_ho';

COMMIT;

-- ── STEP 3 · VERIFY — approved Bangalore bills <=14 Jun still at_branch ──────
SELECT count(*) AS still_at_branch
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE b.region        = 'Bangalore'
   AND p.purchase_date <= '2026-06-14'
   AND p.crm_status     = 'approved'
   AND p.is_deleted     = false
   AND p.stock_status  <> 'at_ho';
-- Expect 0.
