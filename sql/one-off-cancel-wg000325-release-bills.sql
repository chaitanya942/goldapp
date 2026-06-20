-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — cancel WG000325 (TUMKUR) so the 4 stuck bills can re-dispatch
-- ─────────────────────────────────────────────────────────────────────────────
-- Background:
--   • WG000325 (challan WGKA/KA-TUM/MAY/2026/002256) was meant to be cancelled
--     earlier today after a weight-mismatch dispute.
--   • The NIC E-Way Bill cancel call FAILED (EWB 182443423384 is still live on
--     NIC), so the standard cancel_consignment flow never ran.
--   • An earlier one-off (one-off-return-wg000325-tumkur-bills.sql) manually
--     flipped the 4 bills back to at_branch — but deliberately did not touch
--     the parent consignment.
--   • Now those bills can't be re-dispatched because create_consignment_atomic
--     sees them still attached to a non-cancelled parent.
--
-- This file closes the loop:
--   • Sets WG000325.status = 'cancelled' so the in-flight check releases the bills.
--   • Sets approval_status = 'rejected' + rejection_reason so the Approvals UI
--     reflects the truth.
--   • Stamps cancelled_at + cancel_reason for the audit trail (consignments
--     has no cancelled_by column — actor email is embedded in cancel_reason).
--   • EWB fields are LEFT IN PLACE — EWB 182443423384 is still live on NIC and
--     the operator (or future Force Cancel Local) will handle it separately.
--   • bills' stock_status is already at_branch from the earlier sweep — no
--     change needed to purchases.
--
-- Wrapped in BEGIN/COMMIT — preview SELECTs first, then COMMIT only after
-- visual confirmation. To abort: change COMMIT → ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current state ───────────────────────────────────────────────
SELECT id, tmp_prf_no, consignment_no, status, approval_status,
       eway_bill_no, dispatched_at, rejection_reason
  FROM consignments
 WHERE tmp_prf_no = 'WG000325';

-- ── 2) Cancel the parent consignment ─────────────────────────────────────────
UPDATE consignments
   SET status            = 'cancelled',
       approval_status   = 'rejected',
       rejection_reason  = 'Cancelled after NIC EWB cancel failed — bills released for re-dispatch. EWB 182443423384 remains live on NIC (handle separately). Cancelled by chaitanya@whitegold.money.',
       cancel_reason     = 'NIC EWB cancel failed; bills released locally for re-dispatch (by chaitanya@whitegold.money)',
       cancelled_at      = NOW()
 WHERE tmp_prf_no = 'WG000325'
   AND status NOT IN ('cancelled', 'received');

-- ── 3) Verify — should now show cancelled / rejected ─────────────────────────
SELECT id, tmp_prf_no, consignment_no, status, approval_status,
       cancelled_at, cancel_reason, rejection_reason
  FROM consignments
 WHERE tmp_prf_no = 'WG000325';

-- ── 4) Verify — the 4 bills no longer have any in-flight parent ──────────────
SELECT p.application_id, p.stock_status, c.status AS parent_status
  FROM consignment_items ci
  JOIN purchases    p ON p.id = ci.purchase_id
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE p.application_id IN ('WGKA100982','WGKA101048','WGKA101062','WGKA101369')
 ORDER BY p.application_id;

COMMIT;
