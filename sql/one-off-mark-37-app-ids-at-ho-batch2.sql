-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark 37 specific application_ids as stock_status = 'at_ho' (batch 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Second 37-bill batch (companion to sql/one-off-mark-37-app-ids-at-ho.sql).
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
    'WGKA101049','WGKA101056','WGKA101220','WGKA101229','WGKA101280','WGKA101309',
    'WGKA101362','WGKA101372','WGKA101443','WGKA101448','WGKA101452','WGKA101470',
    'WGKA101474','WGKA101479','WGKA101504','WGKA101520','WGKA101523','WGKA101531',
    'WGKA101549','WGKA101550','WGKA101557','WGKA101572','WGKA101592','WGKA101598',
    'WGKA101609','WGKA101614','WGKA101620','WGKA101629','WGKA101650','WGKA101657',
    'WGKA101659','WGKA101678','WGKA101704','WGKA101716','WGKA101726','WGKA101727',
    'WGKA101731'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- Sanity — total matched should equal 37 (operator-provided count).
SELECT COUNT(*) AS matched_total
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA101049','WGKA101056','WGKA101220','WGKA101229','WGKA101280','WGKA101309',
    'WGKA101362','WGKA101372','WGKA101443','WGKA101448','WGKA101452','WGKA101470',
    'WGKA101474','WGKA101479','WGKA101504','WGKA101520','WGKA101523','WGKA101531',
    'WGKA101549','WGKA101550','WGKA101557','WGKA101572','WGKA101592','WGKA101598',
    'WGKA101609','WGKA101614','WGKA101620','WGKA101629','WGKA101650','WGKA101657',
    'WGKA101659','WGKA101678','WGKA101704','WGKA101716','WGKA101726','WGKA101727',
    'WGKA101731'
   );
-- Expected: 37

-- ── 2) Apply — flip to at_ho ──────────────────────────────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted = false
   AND stock_status IN ('at_branch', 'in_consignment')
   AND application_id IN (
    'WGKA101049','WGKA101056','WGKA101220','WGKA101229','WGKA101280','WGKA101309',
    'WGKA101362','WGKA101372','WGKA101443','WGKA101448','WGKA101452','WGKA101470',
    'WGKA101474','WGKA101479','WGKA101504','WGKA101520','WGKA101523','WGKA101531',
    'WGKA101549','WGKA101550','WGKA101557','WGKA101572','WGKA101592','WGKA101598',
    'WGKA101609','WGKA101614','WGKA101620','WGKA101629','WGKA101650','WGKA101657',
    'WGKA101659','WGKA101678','WGKA101704','WGKA101716','WGKA101726','WGKA101727',
    'WGKA101731'
   );

-- ── 3) Verify — post-update distribution. The 'at_ho' row count should
-- equal step-1's at_branch + in_consignment + at_ho totals. Any rows now
-- in sent_for_melting / melted were skipped (downstream, untouched).
SELECT stock_status,
       COUNT(*) AS bills
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA101049','WGKA101056','WGKA101220','WGKA101229','WGKA101280','WGKA101309',
    'WGKA101362','WGKA101372','WGKA101443','WGKA101448','WGKA101452','WGKA101470',
    'WGKA101474','WGKA101479','WGKA101504','WGKA101520','WGKA101523','WGKA101531',
    'WGKA101549','WGKA101550','WGKA101557','WGKA101572','WGKA101592','WGKA101598',
    'WGKA101609','WGKA101614','WGKA101620','WGKA101629','WGKA101650','WGKA101657',
    'WGKA101659','WGKA101678','WGKA101704','WGKA101716','WGKA101726','WGKA101727',
    'WGKA101731'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

COMMIT;
