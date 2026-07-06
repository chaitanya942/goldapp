-- report_schedules — configuration for auto-emailed reports (Finance et al.)
-- Run in the Supabase SQL editor. One row = one scheduled report delivery.
create table if not exists public.report_schedules (
  id                uuid primary key default gen_random_uuid(),
  report_key        text not null default 'purchase_report',   -- which report to build
  label             text,                                       -- optional human label
  enabled           boolean not null default true,
  frequency         text not null default 'daily',             -- 'daily' | 'weekly' | 'custom'
  send_time         text not null default '09:00',             -- HH:MM in IST (24h)
  weekdays          int[] not null default '{}',               -- 0=Sun..6=Sat; used by weekly/custom
  report_date_basis text not null default 'yesterday',         -- 'today' | 'yesterday' — which day the report covers
  recipients        text[] not null default '{}',              -- TO addresses
  cc                text[] not null default '{}',              -- CC addresses
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- dispatch bookkeeping (idempotency: one send per IST day per schedule)
  last_sent_date    date,
  last_sent_at      timestamptz,
  last_status       text,        -- 'sent' | 'error' | 'skipped_empty'
  last_error        text
);

-- Touch updated_at on any change.
create or replace function public.touch_report_schedules() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_touch_report_schedules on public.report_schedules;
create trigger trg_touch_report_schedules before update on public.report_schedules
  for each row execute function public.touch_report_schedules();
