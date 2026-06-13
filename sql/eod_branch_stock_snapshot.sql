-- ─────────────────────────────────────────────────────────────────────────────
-- EOD Branch Stock Snapshot — "how much gold was lying AT THE BRANCH at end of
-- day, and which cases (bills)", frozen daily at 22:00 IST (10 PM).
--
-- Distinct from eod_inventory_snapshots (the 23:30 Physical Stock Report,
-- at_branch + in_transit, aggregate-only). This one is:
--   • AT-BRANCH ONLY  (stock_status = 'at_branch' — not yet dispatched)
--   • 22:00 IST cutoff (captured live when the cron fires at 10 PM)
--   • BILL-LEVEL       (the individual cases are stored, not just totals)
--
-- Two tables:
--   eod_branch_stock_snapshots — one row per day: region + branch rollups.
--   eod_branch_stock_items     — one row per bill that was at branch at 10 PM.
--
-- Starts from the first generation (no backfill). snapshot_date is UNIQUE so
-- a re-run on the same day overwrites cleanly (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Daily summary row ───────────────────────────────────────────────────────
create table if not exists eod_branch_stock_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  snapshot_date date        not null unique,                 -- YYYY-MM-DD (IST)
  generated_at  timestamptz not null default now(),
  generated_by  text,

  -- Org-wide total: { gross_wt, net_wt, gross_amt, bills, branches }
  total      jsonb not null default '{}'::jsonb,
  -- Per region (e.g. Bangalore / Rest of Karnataka / Kerala / Andhra Pradesh /
  -- Telangana): { <region>: { gross_wt, net_wt, gross_amt, bills, branches } }
  by_region  jsonb not null default '{}'::jsonb,
  -- Per branch, array sorted by net_wt desc:
  --   [{ branch_name, region, gross_wt, net_wt, gross_amt, bills }]
  by_branch  jsonb not null default '[]'::jsonb
);

create index if not exists idx_eod_branch_stock_snapshots_date
  on eod_branch_stock_snapshots (snapshot_date desc);

-- ── Bill-level "cases" for the drill-down ───────────────────────────────────
create table if not exists eod_branch_stock_items (
  id             uuid    primary key default gen_random_uuid(),
  snapshot_date  date    not null,
  branch_name    text    not null,             -- the owner branch (current_branch || branch_name)
  region         text,
  application_id text,
  customer_name  text,
  purchase_date  date,
  gross_weight   numeric,
  net_weight     numeric,
  total_amount   numeric
);

-- Hot path: drill into one branch's cases for one date.
create index if not exists idx_eod_branch_stock_items_date_branch
  on eod_branch_stock_items (snapshot_date, branch_name);
create index if not exists idx_eod_branch_stock_items_date
  on eod_branch_stock_items (snapshot_date);

-- ── RLS — authenticated read; service-role (API/cron) writes ────────────────
alter table eod_branch_stock_snapshots enable row level security;
alter table eod_branch_stock_items     enable row level security;

drop policy if exists eod_branch_stock_snap_read on eod_branch_stock_snapshots;
create policy eod_branch_stock_snap_read on eod_branch_stock_snapshots
  for select to authenticated using (true);

drop policy if exists eod_branch_stock_items_read on eod_branch_stock_items;
create policy eod_branch_stock_items_read on eod_branch_stock_items
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- CRON WIRING (do this in the separate `goldapp-cron` Railway worker, not here)
--
-- Add a daily job at 22:00 IST (16:30 UTC) that POSTs to the endpoint with the
-- cron token — same pattern as the 23:30 EOD inventory snapshot + the bidding
-- section-1 audit:
--
--   schedule: "30 16 * * *"   # 16:30 UTC == 22:00 IST, daily
--   request:
--     method:  POST
--     url:     https://<app-host>/api/eod-branch-snapshot
--     headers: { "X-Cron-Token": "<CRON_SECRET>" }
--
-- Until that line is added, admins can capture today's snapshot manually with
-- the 'Generate Now' button on the EOD Branch Stock Report tab. The capture is
-- idempotent (snapshot_date is UNIQUE; items are delete-then-insert), so a
-- manual run plus the cron run on the same day is safe.
-- ─────────────────────────────────────────────────────────────────────────────
