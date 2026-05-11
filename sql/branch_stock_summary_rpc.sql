-- Server-side aggregation for the Branch Stock Overview + In Transit views.
-- Replaces the 24K-row JS aggregation with a single grouped SQL query.
-- Run in Supabase SQL editor when changed.
--
-- Stock status modes the parameterised version supports:
--   'at_branch'      → bills sitting at the branch awaiting a consignment
--   'in_consignment' → bills currently in flight (consigned, not yet received)
--
-- Both modes share the same per-branch shape (total_bills, today_bills,
-- gross/net weight, value, oldest pending date). The 'oldest' field is
-- always derived from purchase_date so it means the same thing across modes
-- (oldest BILL, not oldest consignment).
--
-- The crm-approved gate only applies to own bills in the 'at_branch' mode.
-- Once a bill enters a consignment, accounts has already validated it so
-- the gate is bypassed for in_consignment.

create or replace function branch_stock_summary(p_stock_status text default 'at_branch')
returns table (
  branch_name        text,
  total_bills        bigint,
  today_bills        bigint,
  total_gross_wt     numeric,
  total_net_wt       numeric,
  today_net_wt       numeric,
  total_gross_value  numeric,
  today_gross_value  numeric,
  oldest_pending_date date
)
language sql
security definer
as $$
  with ist as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select
    coalesce(p.current_branch, p.branch_name) as branch_name,
    count(*)::bigint                                                                          as total_bills,
    count(*) filter (where p.purchase_date::date = (select today from ist))::bigint           as today_bills,
    sum(p.gross_weight)                                                                       as total_gross_wt,
    sum(p.net_weight)                                                                         as total_net_wt,
    sum(p.net_weight) filter (where p.purchase_date::date = (select today from ist))          as today_net_wt,
    sum(p.total_amount)                                                                       as total_gross_value,
    sum(p.total_amount) filter (where p.purchase_date::date = (select today from ist))        as today_gross_value,
    min(p.purchase_date::date) filter (where p.purchase_date::date < (select today from ist)) as oldest_pending_date
  from purchases p
  where p.stock_status = p_stock_status
    and p.is_deleted   = false
    and (
      -- For at_branch: own bills need crm approval, transferred-in bills bypass.
      -- For in_consignment: accounts already validated when the consignment was
      -- created, so we don't re-check crm_status.
      p_stock_status <> 'at_branch'
      or ((p.current_branch is null or p.current_branch = p.branch_name) and p.crm_status = 'approved')
      or (p.current_branch is not null and p.current_branch <> p.branch_name)
    )
  group by coalesce(p.current_branch, p.branch_name);
$$;

grant execute on function branch_stock_summary(text) to anon, authenticated, service_role;

-- Backwards-compat: drop the old zero-arg version if it exists. Callers that
-- used branch_stock_summary() now resolve to branch_stock_summary('at_branch')
-- via the default param.
drop function if exists branch_stock_summary();
