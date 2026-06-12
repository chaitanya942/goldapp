-- ─────────────────────────────────────────────────────────────────────────────
-- consignments: tamper-seal verification at receipt
--
-- Workflow:
--   1. Ops creates a consignment in WHITE FIELD → JAYANAGAR. The system
--      auto-generates tmp_prf_no = 'WG000004'. Ops puts the gold in a
--      tamper-evident bag whose serial matches that number, prints the
--      delivery challan (which already carries tmp_prf_no), seals the bag.
--   2. Bag arrives at HO. Auditor opens Collection Audit, sees the
--      consignment header. Before any bill on this consignment can be
--      marked received, the auditor must type the seal number visible on
--      the physical bag. Server compares to tmp_prf_no.
--      ─ Match  → stamp seal_verified_at/by, unlock receive flow.
--      ─ Mismatch → reject with a clear error message; ops can retry or
--        escalate (out of scope for this commit).
--
-- Backfill strategy:
--   Every existing consignment is pre-stamped 'verified' using its
--   dispatched_at (or created_at) timestamp so the new guard never
--   retroactively blocks legacy bills that ops was already auditing
--   before this feature shipped. Only consignments created AFTER this
--   migration runs will start with seal_verified_at = NULL and require
--   explicit verification.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table consignments
  add column if not exists seal_verified_at       timestamptz,
  add column if not exists seal_verified_by       uuid references user_profiles(id),
  add column if not exists seal_verified_by_email text;

-- One-shot backfill — runs only on first execution; subsequent runs find
-- nothing left to update (idempotent).
update consignments
   set seal_verified_at = coalesce(dispatched_at, created_at)
 where seal_verified_at is null;

-- Quick lookup for the receive guard.
create index if not exists idx_consignments_seal_verified_at
  on consignments (id) where seal_verified_at is null;

commit;
