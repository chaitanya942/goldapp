-- Adds the three extra customer / payment fields the sync now captures
-- from old-CRM transac_tbl when those columns exist there:
--   - pan_number         (PAN card number of the customer)
--   - bank_name          (bank used for the payout)
--   - payment_reference  (UTR / cheque / transaction ref number)
--
-- Run once. Safe to re-run (IF NOT EXISTS).
--
-- After this:
--   1. The next /api/sync-purchases call will start populating these for
--      new bills (last 2 days by default).
--   2. Hit "Backfill old-CRM → Supabase" on the Consignment Seeds page to
--      retroactively fill these from 2021-03-01 onwards. The backfill
--      auto-detects which CRM column names hold these values, since CRM
--      naming varies across deployments.

alter table purchases add column if not exists pan_number        text;
alter table purchases add column if not exists bank_name         text;
alter table purchases add column if not exists payment_reference text;

-- Light indexes for search / dedup later (partial — only rows that have a
-- value; keeps the index small on tables where most rows are NULL).
create index if not exists idx_purchases_pan_number
  on purchases (pan_number) where pan_number is not null;
create index if not exists idx_purchases_payment_reference
  on purchases (payment_reference) where payment_reference is not null;
