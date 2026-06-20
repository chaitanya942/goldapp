-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark 11 specific application_ids as stock_status = 'at_ho'
-- ─────────────────────────────────────────────────────────────────────────────
-- Operator-supplied list of WGKA applications that have physically arrived
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
    'WGKA99547','WGKA100389','WGKA101055','WGKA101303','WGKA101354','WGKA101371',
    'WGKA101454','WGKA101496','WGKA101513','WGKA101621','WGKA101728'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- Sanity — total matched should equal 11 (operator-provided count).
SELECT COUNT(*) AS matched_total
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA99547','WGKA100389','WGKA101055','WGKA101303','WGKA101354','WGKA101371',
    'WGKA101454','WGKA101496','WGKA101513','WGKA101621','WGKA101728'
   );
-- Expected: 11

-- ── 2) Apply — flip to at_ho ──────────────────────────────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted = false
   AND stock_status IN ('at_branch', 'in_consignment')
   AND application_id IN (
    'WGKA99547','WGKA100389','WGKA101055','WGKA101303','WGKA101354','WGKA101371',
    'WGKA101454','WGKA101496','WGKA101513','WGKA101621','WGKA101728'
   );

-- ── 3) Verify — post-update distribution. The 'at_ho' row count should
-- equal step-1's at_branch + in_consignment + at_ho totals. Any rows now
-- in sent_for_melting / melted were skipped (downstream, untouched).
SELECT stock_status,
       COUNT(*) AS bills
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA99547','WGKA100389','WGKA101055','WGKA101303','WGKA101354','WGKA101371',
    'WGKA101454','WGKA101496','WGKA101513','WGKA101621','WGKA101728'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

COMMIT;
