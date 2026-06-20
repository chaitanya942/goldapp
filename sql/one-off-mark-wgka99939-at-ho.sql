-- One-off: mark application_id WGKA99939 as at_ho.
-- Manual stock-state correction — the bill should be reflected as already
-- received at HO regardless of its current event-driven status. Matches the
-- semantics of one-off-flip-stale-at-branch-to-at-ho.sql but scoped to a
-- single bill.
--
-- Note: purchases has no consignment_id column. The bill ↔ consignment link
-- lives on the consignments table (bill_ids array). If this bill is still
-- referenced by an in-flight consignment, that's a SEPARATE cleanup on the
-- consignment row — this script only touches the purchase's stock state.
--
-- HOW TO USE
-- ──────────
-- Run ONE block at a time in Supabase SQL editor (the editor only surfaces
-- the LAST query's output, so the previews would be skipped if you ran the
-- whole file).


-- ── BLOCK 1 (preview): current state of the bill ────────────────────────────
select id,
       application_id,
       branch_name,
       current_branch,
       stock_status,
       booking_id,
       net_weight,
       purchase_date,
       crm_status,
       is_deleted
  from purchases
 where application_id = 'WGKA99939';


-- ── BLOCK 2 (preview): any consignment still referencing this bill? ─────────
-- If a row comes back, that consignment is the source of truth for the
-- bill's in_consignment status. Releasing the purchase's stock_status to
-- at_ho without addressing the consignment leaves the consignment showing
-- a phantom bill — usually fine if the consignment is already 'received'
-- or 'cancelled', but worth a glance.
select c.id,
       c.tmp_prf_no,
       c.consignment_no,
       c.status,
       c.branch_name,
       c.dest_branch
  from consignments c
  join purchases p on p.id = any(c.bill_ids)
 where p.application_id = 'WGKA99939';


-- ── BLOCK 3 (THE FIX — review the previews first) ───────────────────────────
-- Sets stock_status='at_ho', clears current_branch (HO is the terminal state
-- — no branch ownership). booking_id preserved: movement is separate from
-- booking.
update purchases
   set stock_status   = 'at_ho',
       current_branch = null
 where application_id = 'WGKA99939'
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
 where application_id = 'WGKA99939';
