-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: push bill WGKA55518 (new_crm, Somisetti Prasad, 122.91g) back to its
-- own branch TS-KHAMMAM.
--
-- It currently has current_branch = 'TS-AS RAO NAGAR' (the hub), so GoldApp
-- treats it as transferred-in and shows it under the hub's Create Consignment
-- screen. Its true branch is TS-KHAMMAM (branch_name already correct, and DevOps
-- has fixed the new-CRM branch to TS-KHAMMAM). No consignment was created, so we
-- just reset current_branch to the origin branch.
--
-- Scoped to crm_source='new_crm' so the unrelated old_crm WGKA55518 (Sridhara,
-- INDIRANAGAR) is untouched. Booking, stock_status, etc. are left as-is.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PREVIEW ──────────────────────────────────────────────────────────────────
SELECT application_id, crm_source, customer_name, branch_name, current_branch,
       stock_status, booking_id, dispatched_at
  FROM purchases
 WHERE application_id = 'WGKA55518' AND crm_source = 'new_crm';

-- ── APPLY ────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE purchases
   SET current_branch = 'TS-KHAMMAM'
 WHERE application_id = 'WGKA55518'
   AND crm_source     = 'new_crm'
   AND is_deleted     = false;

COMMIT;

-- ── VERIFY (current_branch should now equal branch_name = TS-KHAMMAM) ─────────
SELECT application_id, crm_source, branch_name, current_branch, stock_status, booking_id
  FROM purchases
 WHERE application_id = 'WGKA55518' AND crm_source = 'new_crm';
