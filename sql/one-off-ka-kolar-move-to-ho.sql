-- One-off: move every open KA-KOLAR bill to HO.
--
-- Why this is a one-off and not the daily Bangalore morning op
-- ───────────────────────────────────────────────────────────
-- The daily op filters `branch_name IN (SELECT name FROM branches WHERE
-- region = 'Bangalore')`. KA-KOLAR's region is 'Rest of Karnataka', so that
-- op has never touched it — which is why 7 bills accumulated at the branch
-- (16 Jul × 1, 17 Jul × 5, 18 Jul × 1) while Branch Stock only surfaced the
-- one matching the 18 Jul date filter.
--
-- Note KA-KOLAR's `model_type` IS 'bangalore' even though its `region` is
-- 'Rest of Karnataka'. Those two columns disagree by design; the daily op
-- keys off region.
--
-- The booking
-- ───────────
-- WGKA-63951 (4.42g) carries a booking_id but was never dispatched — it is
-- the "stuck booking" on the Branch Stock banner. Flipping it to at_ho while
-- the booking is still attached would leave weight committed to a booking no
-- consignment will ever fulfil. So Block 3 releases the booking first
-- (booking_id + booked_at to NULL, the same pair the app's unbook path
-- clears) and only then moves the status. Booked weight is derived by summing
-- purchases on the booking, so cal_quotas needs no adjustment.
--
-- HOW TO USE
-- ──────────
-- Run ONE block at a time in the Supabase SQL editor — it only shows the LAST
-- query's output, so running the whole file at once skips every preview.


-- ── BLOCK 1 (preview): what is open at KA-KOLAR right now ──────────────────
-- Expect 7 rows. Check `current_branch`: if any row has a current_branch that
-- is NOT 'KA-KOLAR' and NOT NULL, that bill physically sits at another branch
-- or hub — STOP and deal with it separately, don't sweep it to HO.
select p.application_id,
       p.purchase_date,
       p.branch_name,
       p.current_branch,
       p.stock_status,
       p.gross_weight,
       p.net_weight,
       p.booking_id,
       p.booked_at
  from purchases p
 where p.branch_name = 'KA-KOLAR'
   and p.stock_status in ('at_branch', 'in_consignment')
   and p.is_deleted = false
 order by p.purchase_date, p.application_id;


-- ── BLOCK 2 (preview): is any live consignment still holding these? ────────
-- Anything returned here in a status other than 'cancelled' means the bill is
-- mid-dispatch. Resolve that consignment first — moving it to at_ho behind a
-- live consignment's back is how bills go missing from the bid desk.
select c.tmp_prf_no,
       c.consignment_no,
       c.status,
       c.branch_name as source_branch,
       c.dest_branch,
       p.application_id
  from consignments c
  join purchases p on p.id = any(c.bill_ids)
 where p.branch_name = 'KA-KOLAR'
   and p.stock_status in ('at_branch', 'in_consignment')
   and p.is_deleted = false;


-- ── BLOCK 3 (THE FIX — run only after reviewing Blocks 1 and 2) ────────────
-- Releases any attached booking and moves every open KA-KOLAR bill to HO.
-- current_branch is set to branch_name so it stays consistent with the
-- convention every branch-scoped view relies on (a NULL/stale current_branch
-- is what stranded the AP-NAD bills at the wrong hub).
update purchases
   set stock_status   = 'at_ho',
       current_branch = 'KA-KOLAR',
       booking_id     = null,
       booked_at      = null,
       updated_at     = now()
 where branch_name = 'KA-KOLAR'
   and stock_status in ('at_branch', 'in_consignment')
   and is_deleted = false;


-- ── BLOCK 4 (verify): nothing open left, and the moved bills look right ────
-- First result: should be 0 rows.
select application_id, stock_status
  from purchases
 where branch_name = 'KA-KOLAR'
   and stock_status in ('at_branch', 'in_consignment')
   and is_deleted = false;

-- Second result: the 7 bills now at HO, all with booking_id NULL.
select application_id, purchase_date, stock_status, current_branch,
       gross_weight, net_weight, booking_id
  from purchases
 where branch_name = 'KA-KOLAR'
   and purchase_date >= date '2026-07-16'
   and is_deleted = false
 order by purchase_date, application_id;
