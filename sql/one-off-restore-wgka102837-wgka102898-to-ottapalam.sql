-- One-off: restore WGKA102837 and WGKA102898 back to KL-OTTAPALAM.
--
-- Background:
--   - Bills were purchased at KL-OTTAPALAM.
--   - Ops created a consignment to KL-VENNALA-BY-PASS hub by mistake.
--   - Cancellation was requested AND the consignment row was cancelled,
--     BUT the per-bill cleanup didn't run — the bills are still showing on
--     Branch Stock under KL-VENNALA-BY-PASS instead of KL-OTTAPALAM.
--
-- Fix:
--   - stock_status   = 'at_branch'      (back at source, not in_consignment)
--   - current_branch = NULL             (branch_stock_summary RPC falls back
--                                        to branch_name = KL-OTTAPALAM, so
--                                        the bills surface at source)
--
-- Booking is NOT touched here. Block 1's preview reveals whether the bills
-- are also stuck booked — if so we can release in a follow-up.
--
-- HOW TO USE
-- ──────────
-- Run ONE block at a time in Supabase SQL editor (the editor only surfaces
-- the LAST query's output, so the previews would be skipped if you ran the
-- whole file).


-- ── BLOCK 1 (preview): current state of the two bills ──────────────────────
-- Confirm branch_name='KL-OTTAPALAM' and current_branch='KL-VENNALA-BY-PASS'
-- (or stock_status='in_consignment'). If branch_name is anything else, STOP
-- — the current_branch=NULL flip below would not land them at OTTAPALAM.
select p.id,
       p.application_id,
       p.branch_name,
       p.current_branch,
       p.stock_status,
       p.net_weight,
       p.purchase_date,
       p.booking_id,
       p.booked_at
  from purchases p
 where p.application_id in ('WGKA102837', 'WGKA102898');


-- ── BLOCK 2 (preview): any consignment still referencing these bills? ──────
-- The cancelled consignment should show status='cancelled'. If a non-
-- cancelled consignment also lists these bills in its bill_ids, that's a
-- separate issue — flag before continuing.
select c.id,
       c.tmp_prf_no,
       c.consignment_no,
       c.status,
       c.branch_name             as source_branch,
       c.dest_branch,
       c.cancellation_requested_at,
       c.cancelled_at
  from consignments c
  join purchases p on p.id = any(c.bill_ids)
 where p.application_id in ('WGKA102837', 'WGKA102898');


-- ── BLOCK 3 (THE FIX — review previews first) ──────────────────────────────
-- Restores both bills to "at source at KL-OTTAPALAM". Run only if Block 1
-- confirms branch_name='KL-OTTAPALAM' and Block 2 shows the linked
-- consignment is in status='cancelled' (or no consignment at all).
update purchases
   set stock_status   = 'at_branch',
       current_branch = null
 where application_id in ('WGKA102837', 'WGKA102898')
   and is_deleted     = false;


-- ── BLOCK 4 (verify): re-read after the update ──────────────────────────────
select id,
       application_id,
       branch_name,
       current_branch,
       stock_status,
       booking_id,
       net_weight,
       purchase_date
  from purchases
 where application_id in ('WGKA102837', 'WGKA102898');
