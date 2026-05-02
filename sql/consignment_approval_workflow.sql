-- Consignment approval workflow
-- Operations team generates EWB/IRN; accounts team approves before downloads unlock.
-- Apply via Supabase SQL editor.

alter table consignments add column if not exists approval_status   text default 'pending';
  -- values: 'pending' | 'approved' | 'rejected'
alter table consignments add column if not exists approved_at       timestamptz;
alter table consignments add column if not exists approved_by       text;
alter table consignments add column if not exists rejection_reason  text;

-- Auto-approve all existing consignments so the new gate doesn't break in-flight work.
update consignments
   set approval_status = 'approved',
       approved_at     = coalesce(approved_at, created_at)
 where approval_status is null
    or approval_status = 'pending';

-- Pending lookup index — accounts team's "approvals queue" page hits this constantly.
create index if not exists idx_consignments_pending_approval
  on consignments(approval_status, created_at desc)
  where approval_status = 'pending';
