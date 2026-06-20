-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — mark 2 application_ids as stock_status = 'at_ho'
-- ─────────────────────────────────────────────────────────────────────────────
--   WGKA102385  (Raghavendra,    MANGALORE)        in_consignment -> at_ho
--   WGKA102777  (Murali Krishna, TS-CHANDA NAGAR)  in_consignment -> at_ho
--
-- Both are old_crm bills (bare WGKA, no hyphen). New-CRM bills are WGKA-XXXX, so
-- this IN-list can't accidentally touch a new-CRM twin. Skips anything already
-- at_ho, soft-deleted, or downstream (sent_for_melting / melted).
--
-- Wrapped in BEGIN/COMMIT. Run the preview; swap COMMIT for ROLLBACK if wrong.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current state ───────────────────────────────────────────────
SELECT application_id, crm_source, customer_name, stock_status, current_branch
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN ('WGKA102385', 'WGKA102777')
 ORDER BY application_id;

-- ── 2) Apply — flip at_branch / in_consignment → at_ho ───────────────────────
UPDATE purchases
   SET stock_status = 'at_ho'
 WHERE is_deleted = false
   AND stock_status IN ('at_branch', 'in_consignment')
   AND application_id IN ('WGKA102385', 'WGKA102777');

-- ── 3) Verify — both should now read at_ho ───────────────────────────────────
SELECT application_id, crm_source, stock_status
  FROM purchases
 WHERE is_deleted = false
   AND application_id IN ('WGKA102385', 'WGKA102777')
 ORDER BY application_id;

COMMIT;
