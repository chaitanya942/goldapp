-- ─────────────────────────────────────────────────────────────────────────────
-- audit_discrepancy_cases
--
-- Workflow:
--   Auditor reviews the Audit Report → selects one or more discrepancy bills
--   → clicks "Send to Ops". Each selected bill becomes one row in this table
--   with status='pending'. Ops opens the Discrepancy Cases sub-module,
--   writes a reason for the discrepancy, marks the case 'resolved'.
--
-- One open case per bill: a unique partial index on (purchase_id) where
-- status='pending' prevents an auditor from queueing the same bill twice
-- while a case is still open. Once resolved, the same bill can be queued
-- again if a new discrepancy surfaces.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists audit_discrepancy_cases (
  id            uuid        primary key default gen_random_uuid(),
  purchase_id   uuid        not null references purchases(id) on delete cascade,

  -- The discrepancy snapshot at the time the case was raised. We freeze
  -- these here because the underlying purchase row can change (a re-audit
  -- can overwrite audit_gross_weight) and ops needs to reason about what
  -- the auditor actually saw.
  snapshot_crm_gross_g     numeric,
  snapshot_audit_gross_g   numeric,
  snapshot_discrepancy_g   numeric,

  -- Auditor side
  sent_by       uuid        not null references user_profiles(id),
  sent_at       timestamptz not null default now(),

  -- Ops side
  status        text        not null default 'pending'
                check (status in ('pending', 'resolved')),
  reason        text,
  resolved_by   uuid        references user_profiles(id),
  resolved_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One open case per bill — prevents duplicate queuing.
create unique index if not exists uidx_discrepancy_cases_open_per_bill
  on audit_discrepancy_cases (purchase_id) where status = 'pending';

-- Queue scan: ops opens the screen and reads pending cases newest first.
create index if not exists idx_discrepancy_cases_status_sent
  on audit_discrepancy_cases (status, sent_at desc);

-- Reverse lookup: "is this bill currently queued?" check on the audit log.
create index if not exists idx_discrepancy_cases_purchase
  on audit_discrepancy_cases (purchase_id);

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function audit_discrepancy_cases_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_audit_discrepancy_cases_touch on audit_discrepancy_cases;
create trigger trg_audit_discrepancy_cases_touch
  before update on audit_discrepancy_cases
  for each row execute function audit_discrepancy_cases_touch_updated_at();

-- ── RLS — authenticated users can read; service-role writes from API ───────
alter table audit_discrepancy_cases enable row level security;

drop policy if exists discrepancy_cases_read on audit_discrepancy_cases;
create policy discrepancy_cases_read on audit_discrepancy_cases
  for select to authenticated using (true);
