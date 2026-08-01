-- One-off: mark WGKA-64344 as at_ho.
--
-- State at time of writing (verified):
--   branch_name = current_branch = 'KA-KOLAR', stock_status = 'at_branch',
--   net 27.44 g / gross 30.73 g, booked to cal_quotas d030c353 (Augmont 300 g).
--
-- The booking is LEFT ATTACHED on purpose. 'at_ho' + a booking_id is a normal
-- state — the bill has simply reached Head Office while still fulfilling its
-- booking (hundreds of live bills are in exactly this state). This is NOT the
-- KA-KOLAR morning sweep, which released bookings; here we only move the one
-- bill to HO. current_branch already equals branch_name, so nothing else moves.
--
-- Run one block at a time in the Supabase SQL editor (it only shows the last
-- query's output).


-- ── BLOCK 1 (preview): confirm the row before touching it ──────────────────
select application_id, branch_name, current_branch, stock_status,
       booking_id, net_weight, gross_weight, purchase_date
  from purchases
 where application_id = 'WGKA-64344'
   and is_deleted = false;


-- ── BLOCK 2 (the change): move it to HO ────────────────────────────────────
update purchases
   set stock_status = 'at_ho',
       updated_at   = now()
 where application_id = 'WGKA-64344'
   and is_deleted    = false;


-- ── BLOCK 3 (verify): should now read at_ho, booking still attached ────────
select application_id, branch_name, current_branch, stock_status,
       booking_id, net_weight, gross_weight
  from purchases
 where application_id = 'WGKA-64344'
   and is_deleted = false;
