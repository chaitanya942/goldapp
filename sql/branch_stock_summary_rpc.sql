-- Server-side aggregation for Branch Stock Overview.
-- Replaces the 24K-row JS aggregation with a single grouped SQL query.
-- Run once in Supabase SQL editor.

create or replace function branch_stock_summary()
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
  where p.stock_status = 'at_branch'
    and p.is_deleted   = false
    and (
      -- Own bills require crm approval
      ((p.current_branch is null or p.current_branch = p.branch_name) and p.crm_status = 'approved')
      or
      -- Transferred-in bills bypass crm filter (already validated at source)
      (p.current_branch is not null and p.current_branch <> p.branch_name)
    )
  group by coalesce(p.current_branch, p.branch_name);
$$;

grant execute on function branch_stock_summary() to anon, authenticated, service_role;
