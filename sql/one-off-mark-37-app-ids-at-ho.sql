-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark 37 specific application_ids as stock_status = 'at_ho'
-- ─────────────────────────────────────────────────────────────────────────────
-- Operator-supplied list of WGKA applications from two 01-Jun-2026 KL
-- consignees (WGKL/KL-VBP/JUN/2026/002424 — 23 bills, and
-- WGKL/KL-THR/JUN/2026/002430 — 14 bills) that have physically arrived
-- at HO but whose stock_status hasn't caught up. Flips them in one shot.
--
-- Skips:
--   - Bills already at_ho (no-op)
--   - Bills in sent_for_melting / melted (downstream — don't regress)
--   - Bills with is_deleted = true (soft-deleted)
--
-- Wrapped in BEGIN/COMMIT. Preview block first — confirm the right rows
-- are about to change, then run the UPDATE. Swap COMMIT for ROLLBACK if
-- the counts surprise you.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current stock_status distribution for the target set ────
SELECT stock_status,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g,
       ROUND(SUM(gross_weight)::numeric, 3)  AS gross_wt_g
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    -- WGKL/KL-VBP/JUN/2026/002424 (23 bills)
    'WGKA101543','WGKA101546','WGKA101551','WGKA101587','WGKA101616','WGKA101624',
    'WGKA101648','WGKA101653','WGKA101671','WGKA101676','WGKA101681','WGKA101698',
    'WGKA101708','WGKA101725','WGKA101756','WGKA101768','WGKA101784','WGKA101542',
    'WGKA101570','WGKA101591','WGKA101647','WGKA101718','WGKA101788',
    -- WGKL/KL-THR/JUN/2026/002430 (14 bills)
    'WGKA101545','WGKA101597','WGKA101628','WGKA101641','WGKA101674','WGKA101690',
    'WGKA101715','WGKA101740','WGKA101743','WGKA101817','WGKA101579','WGKA101605',
    'WGKA101625','WGKA101822'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- Sanity — total matched should equal 37 (operator-provided count).
SELECT COUNT(*) AS matched_total
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA101543','WGKA101546','WGKA101551','WGKA101587','WGKA101616','WGKA101624',
    'WGKA101648','WGKA101653','WGKA101671','WGKA101676','WGKA101681','WGKA101698',
    'WGKA101708','WGKA101725','WGKA101756','WGKA101768','WGKA101784','WGKA101542',
    'WGKA101570','WGKA101591','WGKA101647','WGKA101718','WGKA101788',
    'WGKA101545','WGKA101597','WGKA101628','WGKA101641','WGKA101674','WGKA101690',
    'WGKA101715','WGKA101740','WGKA101743','WGKA101817','WGKA101579','WGKA101605',
    'WGKA101625','WGKA101822'
   );
-- Expected: 37

-- ── 2) Apply — flip to at_ho ──────────────────────────────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted = false
   AND stock_status IN ('at_branch', 'in_consignment')
   AND application_id IN (
    'WGKA101543','WGKA101546','WGKA101551','WGKA101587','WGKA101616','WGKA101624',
    'WGKA101648','WGKA101653','WGKA101671','WGKA101676','WGKA101681','WGKA101698',
    'WGKA101708','WGKA101725','WGKA101756','WGKA101768','WGKA101784','WGKA101542',
    'WGKA101570','WGKA101591','WGKA101647','WGKA101718','WGKA101788',
    'WGKA101545','WGKA101597','WGKA101628','WGKA101641','WGKA101674','WGKA101690',
    'WGKA101715','WGKA101740','WGKA101743','WGKA101817','WGKA101579','WGKA101605',
    'WGKA101625','WGKA101822'
   );

-- ── 3) Verify — post-update distribution. The 'at_ho' row count should
-- equal step-1's at_branch + in_consignment + at_ho totals. Any rows now
-- in sent_for_melting / melted were skipped (downstream, untouched).
SELECT stock_status,
       COUNT(*) AS bills
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA101543','WGKA101546','WGKA101551','WGKA101587','WGKA101616','WGKA101624',
    'WGKA101648','WGKA101653','WGKA101671','WGKA101676','WGKA101681','WGKA101698',
    'WGKA101708','WGKA101725','WGKA101756','WGKA101768','WGKA101784','WGKA101542',
    'WGKA101570','WGKA101591','WGKA101647','WGKA101718','WGKA101788',
    'WGKA101545','WGKA101597','WGKA101628','WGKA101641','WGKA101674','WGKA101690',
    'WGKA101715','WGKA101740','WGKA101743','WGKA101817','WGKA101579','WGKA101605',
    'WGKA101625','WGKA101822'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

COMMIT;
