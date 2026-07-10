-- ─────────────────────────────────────────────────────────────────────────────
-- booking_split_allocations — accounting ledger for splitting ONE physical bill
-- across two bookings.
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem it solves: a single bill can only carry ONE purchases.booking_id, and
-- attach_selected_to_pipeline refuses an overshoot > 10 g. So a big bill (e.g.
-- 419 g net) can't both close a smaller open pipeline (e.g. 199 g) AND seed a
-- new booking with the remainder — the bill is atomic.
--
-- This ledger records that N net grams of the bill's PRIMARY booking (the new
-- booking it's attached to via booking_id) are actually credited to a DIFFERENT
-- booking whose pipeline it closed. The physical bill is never split — it stays
-- whole on the new booking. Every place that sums a booking's sourced net does:
--
--   effective_attached(B) = Σ(purchases.net_weight WHERE booking_id = B)
--                         − Σ(net_g WHERE from_booking_id = B)   -- credited away
--                         + Σ(net_g WHERE to_booking_id   = B)   -- credited in
--
-- Total sourced gold is conserved (the −/+ net out), and because it lives on a
-- side table (not on purchases), the 60 s CRM re-sync never disturbs it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists booking_split_allocations (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid references purchases(id) on delete set null,     -- the bill that was split (audit; math is booking-level)
  from_booking_id uuid not null references cal_quotas(id) on delete cascade, -- the bill's primary booking — debited
  to_booking_id   uuid not null references cal_quotas(id) on delete cascade, -- the pipeline booking it closed — credited
  net_g           numeric not null check (net_g > 0),
  created_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists idx_bsa_from_booking on booking_split_allocations(from_booking_id);
create index if not exists idx_bsa_to_booking   on booking_split_allocations(to_booking_id);
create index if not exists idx_bsa_purchase     on booking_split_allocations(purchase_id);
