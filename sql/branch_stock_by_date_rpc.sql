-- Per-(branch, purchase_date) breakdown for the Branch Stock Overview date chips.
-- Mirrors branch_stock_summary's filters EXACTLY (same at_branch crm-approved
-- carve-out, same current_branch grouping) but adds purchase_date to the GROUP BY
-- so the client can offer "show only stock purchased on these day(s)" and
-- re-aggregate the branch table + region cards without paging 24K bills.
-- Run in the Supabase SQL editor. Keep in lock-step with branch_stock_summary_rpc.sql.

create or replace function branch_stock_by_date(p_stock_status text default 'at_branch')
returns table (
  branch_name   text,
  purchase_date date,
  bills         bigint,
  net_wt        numeric,
  gross_wt      numeric,
  gross_value   numeric
)
language sql
security definer
as $$
  with enriched as (
    select p.*, p.stock_status as effective_stock_status
    from purchases p
    join branches br on br.name = p.branch_name
    where p.is_deleted = false
  )
  select
    case
      when p_stock_status = 'in_consignment' then p.branch_name
      else coalesce(p.current_branch, p.branch_name)
    end as branch_name,
    p.purchase_date::date                     as purchase_date,
    count(*)::bigint                          as bills,
    sum(p.net_weight)                         as net_wt,
    sum(p.gross_weight)                       as gross_wt,
    sum(p.total_amount)                       as gross_value
  from enriched p
  where p.effective_stock_status = p_stock_status
    and (
      p_stock_status <> 'at_branch'
      or ((p.current_branch is null or p.current_branch = p.branch_name) and p.crm_status = 'approved')
      or (p.current_branch is not null and p.current_branch <> p.branch_name)
    )
  group by 1, 2;
$$;

grant execute on function branch_stock_by_date(text) to anon, authenticated, service_role;
