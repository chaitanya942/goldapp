-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnose — which consignments are holding the "stuck" bills hostage?
-- ─────────────────────────────────────────────────────────────────────────────
-- Symptom: create_consignment_atomic rejects with
--   "N bill(s) already in an in-flight consignment"
-- even though the bills are visible in Branch Stock (stock_status='at_branch').
--
-- Cause: an earlier cancellation flipped stock_status back but did NOT
-- cancel the parent consignment OR remove the consignment_items rows. The
-- in-flight check joins ci → c and flags any non-cancelled / non-received
-- parent.
--
-- Run this FIRST to see exactly which parent consignment(s) need cancelling.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT p.application_id           AS bill_no,
       p.branch_name,
       p.stock_status,
       p.dispatched_at,
       c.id                        AS consignment_id,
       c.tmp_prf_no,
       c.consignment_no            AS challan_no,
       c.status                    AS consignment_status,
       c.created_at                AS consignment_created_at,
       c.eway_bill_no,
       c.approval_status
  FROM consignment_items ci
  JOIN purchases    p ON p.id = ci.purchase_id
  JOIN consignments c ON c.id = ci.consignment_id
 WHERE p.application_id IN (
   -- TUMKUR bills hitting the error today
   'WGKA100982','WGKA101048','WGKA101062','WGKA101369','WGKA101420',
   -- AP-TIRUPATHI bill hitting the error today
   'WGKA101267'
 )
   AND c.status NOT IN ('cancelled', 'received')
 ORDER BY c.id, p.application_id;
