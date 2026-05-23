-- Performance index for the Consignment Report's date-range query.
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
--
-- The report does:
--   select ... from purchases
--    where is_deleted = false
--      and dispatched_at >= '<from> 00:00 IST'
--      and dispatched_at <= '<to> 23:59 IST'
--      and dispatched_at is not null
--   (optionally) and branch_name in (...)
--
-- Without an index Postgres has to scan every purchases row. With the
-- partial index below (only the rows that were ever dispatched and
-- aren't deleted) every date-window pull becomes an index range scan,
-- which is fast even on hundreds of thousands of bills.

create index if not exists idx_purchases_dispatched_at_active
  on purchases (dispatched_at desc)
  where is_deleted = false and dispatched_at is not null;

-- Refresh planner statistics so the new index gets picked up immediately.
analyze purchases;
