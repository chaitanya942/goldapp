-- One-off: TS-CHANDA NAGAR consignment (WG/TS/26-27/150, IRN 4a8a1063…) was
-- force-cancelled locally on 2026-07-28. The force-local path set
-- status='cancelled' but never flipped approval_status, so the row stayed
-- approval_status='approved' with the IRN kept — and therefore kept showing on
-- the Approvals → Approved tab.
--
-- Fix: set approval_status='rejected' with the standard cancellation reason
-- (matches the eway-bill/cancel + e-invoice/cancel routes). The "Rejected
-- because of cancellation of…" prefix also keeps it OFF the Rejected tab, so it
-- surfaces only on the Cancellations tab / portal-cleanup queue.
--
-- The IRN is intentionally LEFT in place — it is still LIVE on the IRP portal
-- and must be cancelled there (or via credit note if the 24h window has closed).
-- Keeping it lets the "Retry portal cancel" flow target it.
--
-- The code path (app/api/consignments/route.js → approve_cancellation) has been
-- fixed to do this automatically; this one-off repairs the already-affected row.

UPDATE consignments
SET approval_status  = 'rejected',
    rejection_reason = 'Rejected because of cancellation of E-Invoice',
    approved_at      = now(),
    approved_by      = 'chaitanya@whitegold.money'
WHERE id = '7d453fa2-988d-4f37-b824-34c762145704'
  AND status = 'cancelled'
  AND approval_status = 'approved';

SELECT id, tmp_prf_no, einvoice_doc_no, branch_name, status, approval_status,
       rejection_reason, irn
FROM consignments
WHERE id = '7d453fa2-988d-4f37-b824-34c762145704';
