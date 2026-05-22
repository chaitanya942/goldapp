-- Performance indexes for the `purchases` table.
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- These speed up the Master Purchase Data listing, filtering, sorting and
-- search, plus the per-page "Both CRMs" lookup.

create extension if not exists pg_trgm;

-- Default listing: WHERE is_deleted = false, ORDER BY purchase_date desc.
create index if not exists idx_purchases_active_date
  on purchases (purchase_date desc, transaction_time desc)
  where is_deleted = false;

-- Branch filter (one of the most-used dropdowns).
create index if not exists idx_purchases_branch
  on purchases (branch_name)
  where is_deleted = false;

-- application_id — the "Both CRMs" IN(...) lookup and the search box.
create index if not exists idx_purchases_application_id
  on purchases (application_id);

-- Equality / range filters used by the toolbar.
create index if not exists idx_purchases_crm_status
  on purchases (crm_status);
create index if not exists idx_purchases_stock_status
  on purchases (stock_status)
  where is_deleted = false;
create index if not exists idx_purchases_dispatched_at
  on purchases (dispatched_at)
  where dispatched_at is not null;

-- Fuzzy search (ILIKE %term%) needs trigram indexes to avoid a full scan.
create index if not exists idx_purchases_customer_trgm
  on purchases using gin (customer_name gin_trgm_ops);
create index if not exists idx_purchases_branch_trgm
  on purchases using gin (branch_name gin_trgm_ops);

-- Refresh planner statistics so the new indexes get used immediately.
analyze purchases;
