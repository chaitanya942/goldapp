-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — force-cancel WG000097 locally (NIC bypass)
-- ─────────────────────────────────────────────────────────────────────────────
-- Background:
--   WG000097 (MANDYA → HO, challan WGKA/KA-MAN/MAY/2026/…) has an open ops
--   cancellation request that NIC keeps refusing through ClearTax — the
--   integration has regressed across multiple layers (payload shape, verb,
--   field types) and we're not going to unblock this consignment via NIC
--   today. EWB 152443638091 stays live on NIC; either chase it manually on
--   ewaybillgst.gov.in or let it expire naturally (24h from generation).
--
--   This sweep does locally exactly what cancel_consignment_atomic + the
--   accounts-approval branch of approve_cancellation would have done if
--   NIC had cooperated:
--     1. consignment.status            = 'cancelled'
--     2. consignment.approval_status   = 'rejected'
--     3. consignment.rejection_reason  records WHY (NIC bypass + operator)
--     4. consignment.cancel_reason     also captured (operator + NIC note)
--     5. consignment.cancelled_at      = NOW()
--     6. consignment.approved_at       = NOW() (mirrors approve_cancellation)
--     7. consignment.approved_by       = actor email
--     8. consignment.cancellation_requested_at cleared so the row leaves the
--        "Cancel Requests" tab cleanly
--     9. EWB fields LEFT IN PLACE — EWB is still live on NIC and ops will
--        handle it separately (matches WG000325 precedent).
--    10. Every bill on the consignment: stock_status → at_branch,
--        dispatched_at → NULL → bills become visible in Branch Stock and
--        eligible for a fresh consignment.
--    11. consignment_items rows are kept (audit trail of the failed dispatch).
--    12. Audit-log entry written.
--
-- Wrapped in BEGIN/COMMIT. Preview SELECTs first, swap COMMIT → ROLLBACK
-- if anything looks off.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current state of consignment + its bills ────────────────
SELECT id, tmp_prf_no, consignment_no AS challan_no,
       status, approval_status, eway_bill_no,
       cancellation_requested_at, cancellation_reason,
       dispatched_at, received_at
  FROM consignments
 WHERE tmp_prf_no = 'WG000097';

SELECT p.application_id, p.customer_name, p.branch_name,
       p.stock_status, p.dispatched_at,
       p.net_weight, p.gross_weight, p.total_amount
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
  JOIN purchases    p ON p.id = ci.purchase_id
 WHERE c.tmp_prf_no = 'WG000097'
 ORDER BY p.application_id;

-- ── 2) Cancel the consignment locally ────────────────────────────────────
UPDATE consignments
   SET status                    = 'cancelled',
       approval_status           = 'rejected',
       cancelled_at              = NOW(),
       approved_at               = NOW(),
       approved_by               = 'chaitanya@whitegold.money',
       rejection_reason          = 'Force-cancelled locally after NIC EWB cancel kept failing through ClearTax (cancelRsnCode shape + Invalid-value-for-null-field type errors). EWB 152443638091 remains live on NIC — handle separately on ewaybillgst.gov.in or let it expire naturally. Original ops reason: ' || COALESCE(cancellation_reason, '—'),
       cancel_reason             = 'NIC EWB cancel unrecoverable through ClearTax today; cleared locally so bills can re-dispatch (by chaitanya@whitegold.money). EWB stays live on NIC.',
       cancellation_requested_at = NULL,
       cancellation_reason       = NULL
 WHERE tmp_prf_no = 'WG000097'
   AND status NOT IN ('cancelled', 'received');

-- ── 3) Return every bill on the consignment to source ────────────────────
--      Mirrors cancel_consignment_atomic's bill-release step.
UPDATE purchases p
   SET stock_status  = 'at_branch',
       dispatched_at = NULL
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE ci.purchase_id = p.id
   AND c.tmp_prf_no   = 'WG000097'
   AND p.stock_status = 'in_consignment';

-- ── 4) Audit log entry ───────────────────────────────────────────────────
INSERT INTO consignment_activity_log (consignment_id, event_type, actor_email, details, created_at)
SELECT id,
       'ewb_cancelled_local_only',
       'chaitanya@whitegold.money',
       jsonb_build_object(
         'ewb_no',       eway_bill_no,
         'tmp_prf_no',   tmp_prf_no,
         'warning',      'EWB was NOT cancelled on NIC — local state cleared only. Verify EWB status on ewaybillgst.gov.in.',
         'reason',       'ClearTax integration regression; unable to cancel through API. Bills released locally so ops can redispatch.',
         'triggered_by', 'manual_sql_one_off'
       ),
       NOW()
  FROM consignments
 WHERE tmp_prf_no = 'WG000097';

-- ── 5) Verify — consignment ──────────────────────────────────────────────
SELECT id, tmp_prf_no, consignment_no AS challan_no,
       status, approval_status,
       cancelled_at, approved_at, approved_by,
       cancellation_requested_at, eway_bill_no,
       rejection_reason
  FROM consignments
 WHERE tmp_prf_no = 'WG000097';

-- ── 6) Verify — bills back at MANDYA ─────────────────────────────────────
SELECT p.application_id, p.branch_name,
       p.stock_status, p.dispatched_at
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
  JOIN purchases    p ON p.id = ci.purchase_id
 WHERE c.tmp_prf_no = 'WG000097'
 ORDER BY p.application_id;

COMMIT;
