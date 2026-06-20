-- One-off: restore WGKA102756 and WGKA102747 after a failed consignment cancel.
--
-- Background:
--   - Bills were purchased at KL-OTTAPALAM.
--   - Ops created a consignment to KL-VENNALA-BY-PASS hub by mistake.
--   - Cancellation was requested and the consignment row was cancelled,
--     BUT the per-bill cleanup didn't run (or didn't run completely) — the
--     bills are still showing in KL-VENNALA-BY-PASS hub on Branch Stock.
--   - Separately, they remain attached to a booking and need to be released.
--
-- Combined fix (one shot, not two):
--   - stock_status   = 'at_branch'      (back at source, not in_consignment)
--   - current_branch = NULL             (RPC falls back to branch_name, which
--                                        is the original KL-OTTAPALAM — so
--                                        Branch Stock shows them at the
--                                        source again)
--   - booking_id     = NULL             (release booking)
--   - booked_at      = NULL             (release booking)
--
-- HOW TO USE
-- ──────────
-- Run ONE block at a time in Supabase SQL editor (the editor only surfaces
-- the LAST query's output, so the previews would be skipped if you ran the
-- whole file).


-- ── BLOCK 1 (preview): current state of the two bills + their booking ──────
-- Confirm branch_name = 'KL-OTTAPALAM' so the current_branch=NULL flip lands
-- them back at the right source on Branch Stock. If branch_name is anything
-- else, STOP — the assumption above is wrong and we need to set
-- current_branch explicitly.
select p.id,
       p.application_id,
       p.branch_name,
       p.current_branch,
       p.stock_status,
       p.net_weight,
       p.purchase_date,
       p.booking_id,
       p.booked_at,
       q.weight        as booking_weight,
       q.pipeline_region,
       q.pipeline_arrival_date,
       q.pipeline_remaining_g
  from purchases p
  left join cal_quotas q on q.id = p.booking_id
 where p.application_id in ('WGKA102756', 'WGKA102747');


-- ── BLOCK 2 (preview): any consignment still referencing these bills? ───────
-- The cancelled consignment should be in status='cancelled'. If a non-
-- cancelled consignment still lists these bills in its bill_ids, that's a
-- separate problem — flag it before continuing.
select c.id,
       c.tmp_prf_no,
       c.consignment_no,
       c.status,
       c.branch_name as source_branch,
       c.dest_branch,
       c.cancellation_requested_at,
       c.cancelled_at
  from consignments c
  join purchases p on p.id = any(c.bill_ids)
 where p.application_id in ('WGKA102756', 'WGKA102747');


-- ── BLOCK 3 (THE FIX — review previews first) ───────────────────────────────
-- Restores both bills to "at source, unbooked". Run only if Block 1 confirms
-- branch_name='KL-OTTAPALAM' and Block 2 shows the linked consignment is
-- in status='cancelled' (or no consignment at all).
update purchases
   set stock_status   = 'at_branch',
       current_branch = null,
       booking_id     = null,
       booked_at      = null
 where application_id in ('WGKA102756', 'WGKA102747')
   and is_deleted     = false;


-- ── BLOCK 4 (verify): re-read after the update ──────────────────────────────
select id,
       application_id,
       branch_name,
       current_branch,
       stock_status,
       booking_id,
       booked_at,
       net_weight,
       purchase_date
  from purchases
 where application_id in ('WGKA102756', 'WGKA102747');
