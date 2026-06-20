-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark 69 application_ids as stock_status = 'at_ho'
-- ─────────────────────────────────────────────────────────────────────────────
-- Operator-supplied list. Mixed CRMs (post-hyphen-migration ids are exact):
--   57 new_crm (WGKA-XXXX, hyphenated) + 12 old_crm (WGKAXXXX, bare).
-- Matching the exact strings hits the correct CRM row for each — no twin risk.
--
-- Skips: already at_ho (no-op) · sent_for_melting / melted (downstream) ·
--        is_deleted = true.
--
-- Wrapped in BEGIN/COMMIT. Run STEP 1 preview; swap COMMIT for ROLLBACK if the
-- counts surprise you.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current stock_status distribution for the target set ────────
SELECT stock_status,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g,
       ROUND(SUM(gross_weight)::numeric, 3)  AS gross_wt_g
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA103825','WGKA104142','WGKA-55775','WGKA-55763','WGKA-55682',
    'WGKA-55941','WGKA-56084','WGKA103931','WGKA-56135','WGKA-55952',
    'WGKA-55814','WGKA-56187','WGKA-56282','WGKA-56240','WGKA-56089',
    'WGKA-56144','WGKA-55449','WGKA-55954','WGKA-56255','WGKA-56118',
    'WGKA-56063','WGKA-56232','WGKA-56087','WGKA-55897','WGKA-56330',
    'WGKA-56107','WGKA-56074','WGKA-55821','WGKA-56076','WGKA-56250',
    'WGKA-56062','WGKA-56142','WGKA-56386','WGKA-56367','WGKA-56351',
    'WGKA-56167','WGKA-56086','WGKA-56347','WGKA-56289','WGKA-56205',
    'WGKA-56161','WGKA-56098','WGKA-56278','WGKA-56140','WGKA-56054',
    'WGKA-56038','WGKA-56251','WGKA-56222','WGKA-56211','WGKA-56150',
    'WGKA-56119','WGKA-56127','WGKA-56070','WGKA-56035','WGKA-55864',
    'WGKA-55518','WGKA101819','WGKA102386','WGKA103217','WGKA103173',
    'WGKA103936','WGKA104053','WGKA104165','WGKA104164','WGKA101632',
    'WGKA-55854','WGKA-56068','WGKA-56166','WGKA-56116'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- ── 2) Apply — flip at_branch / in_consignment → at_ho ───────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted = false
   AND stock_status IN ('at_branch', 'in_consignment')
   AND application_id IN (
    'WGKA103825','WGKA104142','WGKA-55775','WGKA-55763','WGKA-55682',
    'WGKA-55941','WGKA-56084','WGKA103931','WGKA-56135','WGKA-55952',
    'WGKA-55814','WGKA-56187','WGKA-56282','WGKA-56240','WGKA-56089',
    'WGKA-56144','WGKA-55449','WGKA-55954','WGKA-56255','WGKA-56118',
    'WGKA-56063','WGKA-56232','WGKA-56087','WGKA-55897','WGKA-56330',
    'WGKA-56107','WGKA-56074','WGKA-55821','WGKA-56076','WGKA-56250',
    'WGKA-56062','WGKA-56142','WGKA-56386','WGKA-56367','WGKA-56351',
    'WGKA-56167','WGKA-56086','WGKA-56347','WGKA-56289','WGKA-56205',
    'WGKA-56161','WGKA-56098','WGKA-56278','WGKA-56140','WGKA-56054',
    'WGKA-56038','WGKA-56251','WGKA-56222','WGKA-56211','WGKA-56150',
    'WGKA-56119','WGKA-56127','WGKA-56070','WGKA-56035','WGKA-55864',
    'WGKA-55518','WGKA101819','WGKA102386','WGKA103217','WGKA103173',
    'WGKA103936','WGKA104053','WGKA104165','WGKA104164','WGKA101632',
    'WGKA-55854','WGKA-56068','WGKA-56166','WGKA-56116'
   );

-- ── 3) Verify — expect at_branch / in_consignment = 0 (any sent_for_melting /
--      melted rows were intentionally skipped) ──────────────────────────────
SELECT stock_status,
       COUNT(*) AS bills
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN (
    'WGKA103825','WGKA104142','WGKA-55775','WGKA-55763','WGKA-55682',
    'WGKA-55941','WGKA-56084','WGKA103931','WGKA-56135','WGKA-55952',
    'WGKA-55814','WGKA-56187','WGKA-56282','WGKA-56240','WGKA-56089',
    'WGKA-56144','WGKA-55449','WGKA-55954','WGKA-56255','WGKA-56118',
    'WGKA-56063','WGKA-56232','WGKA-56087','WGKA-55897','WGKA-56330',
    'WGKA-56107','WGKA-56074','WGKA-55821','WGKA-56076','WGKA-56250',
    'WGKA-56062','WGKA-56142','WGKA-56386','WGKA-56367','WGKA-56351',
    'WGKA-56167','WGKA-56086','WGKA-56347','WGKA-56289','WGKA-56205',
    'WGKA-56161','WGKA-56098','WGKA-56278','WGKA-56140','WGKA-56054',
    'WGKA-56038','WGKA-56251','WGKA-56222','WGKA-56211','WGKA-56150',
    'WGKA-56119','WGKA-56127','WGKA-56070','WGKA-56035','WGKA-55864',
    'WGKA-55518','WGKA101819','WGKA102386','WGKA103217','WGKA103173',
    'WGKA103936','WGKA104053','WGKA104165','WGKA104164','WGKA101632',
    'WGKA-55854','WGKA-56068','WGKA-56166','WGKA-56116'
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

COMMIT;
