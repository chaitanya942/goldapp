-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — WGKA55655 (Nagaraju Lakkavarapu, new_crm): full release for rebooking
-- ─────────────────────────────────────────────────────────────────────────────
-- Symptom: bill won't re-book and "Create Consignment" fails. It's the
-- WG000325 / TUMKUR pattern — stock_status was flipped back to 'at_branch' but
-- its parent consignment was never cancelled, so:
--   • consignment_items still links it to WG000079 (status=dispatched) →
--     create_consignment's in-flight pre-flight (route.js:2616) rejects it.
--   • dispatched_at (the "consignment date") + booking_id/booked_at are stale.
--   • current_branch was TS-KUKATPALLY, so the hub view sucks it into the
--     Kukatpally consolidation — but it's a TS-NIZAMABAD branch bill.
--
-- WG000079 carries 4 bills; the other 3 (WGKA104037 / WGKA55548 / WGKA55626)
-- actually travelled and are at_ho. So we DETACH ONLY THIS BILL — we do NOT
-- cancel the consignment.
--
-- Target purchase row (precise, by id) — the old_crm twin under the same WGKA
-- number is a DIFFERENT customer (Shabeer ahmed) and is never touched:
--   purchase id   = c07ea5a9-1f09-48c8-98b0-d637a37c698e
--   consignment   = bcb63c28-811c-40b6-968b-c6bee53530a1 (WG000079)
--   item link     = 0d33e069-0b7a-4e82-ae35-68744c4c2b2b
--
-- Wrapped in BEGIN/COMMIT. Run the preview; swap COMMIT for ROLLBACK if wrong.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — the bill + its stale consignment link ───────────────────────
SELECT p.id, p.crm_source, p.customer_name, p.stock_status,
       p.branch_name, p.current_branch, p.dispatched_at, p.booking_id, p.booked_at,
       ci.id              AS item_id,
       c.tmp_prf_no, c.consignment_no, c.status AS consignment_status
  FROM purchases p
  LEFT JOIN consignment_items ci ON ci.purchase_id = p.id
  LEFT JOIN consignments      c  ON c.id = ci.consignment_id
 WHERE p.id = 'c07ea5a9-1f09-48c8-98b0-d637a37c698e';

-- ── 2) Detach this bill from WG000079 (other 3 bills stay attached) ───────────
DELETE FROM consignment_items
 WHERE id = '0d33e069-0b7a-4e82-ae35-68744c4c2b2b'
   AND purchase_id    = 'c07ea5a9-1f09-48c8-98b0-d637a37c698e'
   AND consignment_id = 'bcb63c28-811c-40b6-968b-c6bee53530a1';

-- ── 3) Reset the purchase row: clear consignment date + booking, pin to
--      Nizamabad, keep at_branch ────────────────────────────────────────────
UPDATE purchases
   SET dispatched_at  = NULL,   -- consignment date — cleared so it can re-consign
       booking_id     = NULL,   -- unbook so it can re-book
       booked_at      = NULL,
       current_branch = 'TS-NIZAMABAD',
       stock_status   = 'at_branch'
 WHERE id = 'c07ea5a9-1f09-48c8-98b0-d637a37c698e'
   AND crm_source = 'new_crm';

-- ── 4) Verify — no consignment link; clean at_branch Nizamabad bill,
--      no booking, no dispatch date ────────────────────────────────────────
SELECT p.id, p.crm_source, p.customer_name, p.stock_status,
       p.branch_name, p.current_branch, p.dispatched_at, p.booking_id, p.booked_at,
       ci.id AS item_id_should_be_null
  FROM purchases p
  LEFT JOIN consignment_items ci ON ci.purchase_id = p.id
 WHERE p.id = 'c07ea5a9-1f09-48c8-98b0-d637a37c698e';

-- ── 5) Sanity — WG000079 should still hold the other 3 bills ─────────────────
SELECT ci.purchase_id, p.application_id, p.customer_name, p.stock_status
  FROM consignment_items ci
  JOIN purchases p ON p.id = ci.purchase_id
 WHERE ci.consignment_id = 'bcb63c28-811c-40b6-968b-c6bee53530a1';

COMMIT;
