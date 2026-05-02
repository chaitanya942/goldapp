-- Consignment module — Phase C migrations
-- Adds: activity log, EWB lock + audit cols, GST rate snapshot, EWB expiry,
-- reverse flow status, per-bill received flag, multi-vehicle, cleartax_response cache.
--
-- Apply via Supabase SQL editor. Idempotent (uses IF NOT EXISTS / IF EXISTS).

-- 1) Activity log table — every consignment lifecycle event recorded with actor
create table if not exists consignment_activity_log (
  id              bigserial primary key,
  consignment_id  uuid not null references consignments(id) on delete cascade,
  event_type      text not null,            -- created, ewb_generated, ewb_cancelled, einvoice_generated, einvoice_cancelled, received, partial_received, cancelled, returned, etc.
  actor_email     text,
  actor_role      text,
  details         jsonb,                    -- free-form: { bills_received: [...], reason: '...', from_status: 'x', to_status: 'y' }
  created_at      timestamptz not null default now()
);
create index if not exists idx_consignment_activity_log_cid on consignment_activity_log(consignment_id, created_at desc);
create index if not exists idx_consignment_activity_log_event on consignment_activity_log(event_type);

-- 2) EWB generation lock + audit columns on consignments
alter table consignments add column if not exists ewb_generation_started_at timestamptz;
alter table consignments add column if not exists ewb_generated_at          timestamptz;
alter table consignments add column if not exists einvoice_generated_at     timestamptz;
alter table consignments add column if not exists ewb_valid_until           timestamptz;
alter table consignments add column if not exists cleartax_response         jsonb;

-- 3) GST rate snapshot — frozen at consignment creation so retroactive rate changes
-- don't alter old documents on regeneration.
alter table consignments add column if not exists gst_rate_snapshot jsonb;
-- Shape: { igst: 3, cgst: 1.5, sgst: 1.5, hsn: '7108', captured_at: '...' }

-- 4) Reverse flow — cancellation / return support
-- consignments.status existing values: 'draft', 'dispatched', 'received', 'seed'
-- Adding: 'cancelled' (consignment voided before receive), 'returned' (bills sent back to source)
alter table consignments add column if not exists cancelled_at  timestamptz;
alter table consignments add column if not exists cancel_reason text;
alter table consignments add column if not exists returned_at   timestamptz;

-- 5) Per-bill received flag — partial receive at destination
-- Stored on consignment_items so missing bills can be flagged individually.
alter table consignment_items add column if not exists received_at        timestamptz;
alter table consignment_items add column if not exists received_by_email  text;
alter table consignment_items add column if not exists short_reason       text; -- 'missing', 'damaged', etc.

-- 6) Multi-vehicle support — store secondary vehicle when shipment splits
-- Existing vehicle_no remains primary; vehicles JSONB array captures all when >1.
alter table consignments add column if not exists vehicles jsonb;
-- Shape: [{ vehicle_no: 'KA01AB1234', from_pin: '560001', to_pin: '682001', ewb_no: '...' }, ...]

-- 7) Helpful view: bill journey — every consignment a bill has ever been part of, ordered.
create or replace view bill_journey as
select
  ci.purchase_id,
  c.id              as consignment_id,
  c.tmp_prf_no,
  c.challan_no,
  c.movement_type,
  c.branch_name     as source_branch,
  c.dest_branch,
  c.status,
  c.created_at,
  c.received_at,
  c.cancelled_at,
  ci.received_at    as bill_received_at,
  ci.short_reason
from consignment_items ci
join consignments c on c.id = ci.consignment_id
order by ci.purchase_id, c.created_at;

-- 8) RLS — allow authenticated read on activity log (writes only via service role from API)
alter table consignment_activity_log enable row level security;
drop policy if exists "activity_log_select" on consignment_activity_log;
create policy "activity_log_select" on consignment_activity_log
  for select using (auth.role() = 'authenticated');
