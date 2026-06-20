-- One-off data correction. Bills older than 30 days that are still showing
-- stock_status='at_branch' have realistically already moved to HO — the
-- transition just never got recorded. Flip those to 'at_ho' and clear
-- current_branch (mirrors the receive-at-HO behaviour).
--
-- Excluded:
--   - is_deleted = true / crm_status = 'deleted' (soft-deleted, audit-only)
--   - any stock_status other than at_branch (already moved through pipeline)
--
-- Not touched: dispatched_at / received_at — we don't have a real timestamp
-- for when these moved, so faking NOW() would corrupt the audit trail.
-- Downstream consumers must tolerate NULL receive timestamps on
-- historically-corrected rows.
--
-- HOW TO USE
-- ──────────
-- Run ONE block at a time in Supabase SQL editor. Highlight the block (or
-- copy-paste it on its own) and click Run. The editor only shows the last
-- query's output, so running the whole file at once would skip past the
-- previews straight to the UPDATE.


-- ── BLOCK 1 (preview): total count + date range ─────────────────────────────
select
  count(*)                    as rows_to_flip,
  count(distinct branch_name) as branches_affected,
  min(purchase_date)          as oldest_date,
  max(purchase_date)          as newest_date
from purchases
where stock_status   = 'at_branch'
  and purchase_date <= (current_date - interval '30 days')
  and is_deleted     = false
  and crm_status    != 'deleted';


-- ── BLOCK 2 (preview): breakdown per branch ─────────────────────────────────
select branch_name, count(*) as rows_to_flip
from purchases
where stock_status   = 'at_branch'
  and purchase_date <= (current_date - interval '30 days')
  and is_deleted     = false
  and crm_status    != 'deleted'
group by branch_name
order by rows_to_flip desc;


-- ── BLOCK 3 (THE FIX — run this last, after reviewing the previews) ────────
update purchases
set stock_status   = 'at_ho',
    current_branch = null
where stock_status   = 'at_branch'
  and purchase_date <= (current_date - interval '30 days')
  and is_deleted     = false
  and crm_status    != 'deleted';
