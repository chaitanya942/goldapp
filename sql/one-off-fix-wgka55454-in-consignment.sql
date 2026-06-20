-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: put the SHIVAMOGGA new-CRM bill WGKA55454 (cust. AKSHATHA M P) into
-- Bidding Volume Section 2 (arriving tomorrow, 24h).
--
-- It needs BOTH:
--   • stock_status   = 'in_consignment'   (it had reverted to at_branch — see below)
--   • dispatched_at  = now()              (24h-TAT Shivamogga → arrives tomorrow)
-- The consignments API builds Sections 2/3/4 from in_consignment bills that have
-- a dispatched_at, then derives the HO-arrival date from dispatched_at + TAT.
--
-- WHY it reverted before: the new-CRM cron sync used to delete-then-reinsert
-- rows in the window, resetting stock_status to the at_branch default and
-- dropping dispatched_at every cycle. That is fixed in app/api/sync-new-crm
-- (non-destructive upsert), so this marking will now stick.
--
-- crm_source is pinned to 'new_crm' because the same WGKA number can also exist
-- as an old_crm row (composite key application_id + crm_source).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · LOCATE (confirm one row, new_crm, SHIVAMOGGA, Akshatha) ─────────
SELECT id, application_id, crm_source, customer_name, branch_name, current_branch,
       stock_status, dispatched_at, booking_id, is_deleted, crm_status, net_weight
  FROM purchases
 WHERE application_id = 'WGKA55454'
   AND crm_source     = 'new_crm';

-- ── STEP 2 · APPLY ───────────────────────────────────────────────────────────
BEGIN;

UPDATE purchases
   SET stock_status  = 'in_consignment',
       dispatched_at = now()
 WHERE application_id = 'WGKA55454'
   AND crm_source     = 'new_crm'
   AND is_deleted     = false
   AND booking_id IS NULL;   -- never touch a bill already booked

COMMIT;

-- ── STEP 3 · VERIFY ───────────────────────────────────────────────────────────
SELECT application_id, crm_source, customer_name, stock_status,
       dispatched_at, booking_id, net_weight
  FROM purchases
 WHERE application_id = 'WGKA55454'
   AND crm_source     = 'new_crm';
-- Refresh Bidding Volume → Section 2 should now show 4 bills for SHIVAMOGGA.
