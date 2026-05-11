-- Server-side aggregation for the Branch Stock Overview + In Transit views.
-- Replaces the 24K-row JS aggregation with a single grouped SQL query.
-- Run in Supabase SQL editor when changed.
--
-- Stock status modes:
--   'at_branch'      → bills sitting at the branch awaiting a consignment
--   'in_consignment' → bills currently in flight (consigned, not yet received)
--   'at_ho'          → bills received at HO (terminal for outstation; computed
--                       for Bangalore after midnight)
--
-- Bangalore lifecycle override (for approved bills only):
--   Same day, < 19:30 IST          → at_branch
--   Same day, 19:30 IST – 23:59    → in_consignment
--   Previous days (after midnight) → at_ho
-- This automates the daily consolidation flow without a cron job — the RPC
-- always reflects the actual IST time of the call.
--
-- Branch-grouping rule (the key insight):
--   - at_branch       → group by coalesce(current_branch, branch_name)
--                       = where the gold physically IS right now (the hub if
--                       a transferred-in bill, else the origin branch).
--   - in_consignment  → group by branch_name (the ORIGIN branch).
--                       This is what breaks Hub→HO consolidations back down
--                       into their constituent source branches in the In
--                       Transit view, so HASSAN, MYSURU, HUBLI etc. each get
--                       their own row instead of the hub swallowing them all
--                       under one inflated entry.
--
-- Non-Bangalore bills keep their stored stock_status (authoritative). The
-- crm-approved gate only applies in the 'at_branch' mode for outstation
-- (the existing transferred-in carve-out is preserved). Once a bill enters
-- in_consignment, accounts has already validated it so the gate is bypassed.

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
  with
    ist as (
      select
        (now() at time zone 'Asia/Kolkata')::date as today,
        (now() at time zone 'Asia/Kolkata')::time as time_now
    ),
    -- Bangalore branches follow a time-of-day lifecycle for approved bills:
    --   Same day, < 19:30 IST          → at_branch
    --   Same day, 19:30 IST – 23:59    → in_consignment
    --   Previous days (after midnight) → at_ho
    -- Non-Bangalore bills keep their stored stock_status (authoritative).
    -- Unapproved Bangalore bills keep their stored status too (they're
    -- sitting at the branch awaiting CRM approval, not in the lifecycle).
    enriched as (
      select
        p.*,
        case
          when br.region = 'Bangalore' and p.crm_status = 'approved'
               and p.purchase_date::date = (select today from ist)
               and (select time_now from ist) < time '19:30:00'
            then 'at_branch'
          when br.region = 'Bangalore' and p.crm_status = 'approved'
               and p.purchase_date::date = (select today from ist)
               and (select time_now from ist) >= time '19:30:00'
            then 'in_consignment'
          when br.region = 'Bangalore' and p.crm_status = 'approved'
               and p.purchase_date::date < (select today from ist)
            then 'at_ho'
          else p.stock_status
        end as effective_stock_status
      from purchases p
      join branches br on br.name = p.branch_name
      where p.is_deleted = false
    )
  select
    -- For in_consignment we report the ORIGIN branch (the bill's source),
    -- not the hub it's currently sitting at — so Hub→HO consolidations break
    -- back down into the source branches that contributed to them.
    -- For at_branch we report where the gold physically IS (current_branch).
    case
      when p_stock_status = 'in_consignment' then p.branch_name
      else coalesce(p.current_branch, p.branch_name)
    end as branch_name,
    count(*)::bigint                                                                          as total_bills,
    count(*) filter (where p.purchase_date::date = (select today from ist))::bigint           as today_bills,
    sum(p.gross_weight)                                                                       as total_gross_wt,
    sum(p.net_weight)                                                                         as total_net_wt,
    sum(p.net_weight) filter (where p.purchase_date::date = (select today from ist))          as today_net_wt,
    sum(p.total_amount)                                                                       as total_gross_value,
    sum(p.total_amount) filter (where p.purchase_date::date = (select today from ist))        as today_gross_value,
    min(p.purchase_date::date) filter (where p.purchase_date::date < (select today from ist)) as oldest_pending_date
  from enriched p
  where p.effective_stock_status = p_stock_status
    and (
      p_stock_status <> 'at_branch'
      or ((p.current_branch is null or p.current_branch = p.branch_name) and p.crm_status = 'approved')
      or (p.current_branch is not null and p.current_branch <> p.branch_name)
    )
  group by
    case
      when p_stock_status = 'in_consignment' then p.branch_name
      else coalesce(p.current_branch, p.branch_name)
    end;
$$;

grant execute on function branch_stock_summary(text) to anon, authenticated, service_role;
drop function if exists branch_stock_summary();
