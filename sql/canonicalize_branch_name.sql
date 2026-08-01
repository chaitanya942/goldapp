-- ─────────────────────────────────────────────────────────────────────────────
-- canonicalize_branch_name — DB-level guard so a bill can never orphan itself
-- ─────────────────────────────────────────────────────────────────────────────
-- Karnataka branches are canonically KA-prefixed (KA-MYSURU, KA-SHIVAMOGGA …),
-- matching AP-/TS-/KL-. But a sync writing the BARE name ("SHIVAMOGGA") stamps a
-- branch_name that exists in no branches row, so the bill silently drops out of
-- every branch-scoped view — Booking Volume filters in-transit bills with
-- `.in('branch_name', <names from branches>)`, so an orphaned bill disappears from
-- the bid desk entirely (that is exactly how KA-SHIVAMOGGA's consignment went
-- missing from Section 2).
--
-- This trigger repairs the name on the way IN, so correctness no longer depends on
-- every writer being on the latest code. It is:
--   • DATA-DRIVEN — no hardcoded branch list. It only rewrites when the bare name
--     is absent from `branches` AND the KA- form is present. Nothing else is touched.
--   • IDEMPOTENT + harmless once every sync is updated (the condition stops matching).
--   • A permanent safety net against this class of regression.
--
-- Apply once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function canonicalize_branch_name()
returns trigger
language plpgsql
as $$
begin
  -- branch_name: bare Karnataka name → KA- canonical
  if new.branch_name is not null
     and not exists (select 1 from branches b where b.name = new.branch_name)
     and     exists (select 1 from branches b where b.name = 'KA-' || new.branch_name)
  then
    new.branch_name := 'KA-' || new.branch_name;
  end if;

  -- current_branch follows the same rule (hub transfers / branch stock views)
  if new.current_branch is not null
     and not exists (select 1 from branches b where b.name = new.current_branch)
     and     exists (select 1 from branches b where b.name = 'KA-' || new.current_branch)
  then
    new.current_branch := 'KA-' || new.current_branch;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_canonicalize_branch_name on purchases;
create trigger trg_canonicalize_branch_name
  before insert or update on purchases
  for each row
  execute function canonicalize_branch_name();

-- Repair anything already orphaned by a stale writer.
update purchases p
   set branch_name = 'KA-' || p.branch_name
 where p.branch_name is not null
   and not exists (select 1 from branches b where b.name = p.branch_name)
   and     exists (select 1 from branches b where b.name = 'KA-' || p.branch_name);

update purchases p
   set current_branch = 'KA-' || p.current_branch
 where p.current_branch is not null
   and not exists (select 1 from branches b where b.name = p.current_branch)
   and     exists (select 1 from branches b where b.name = 'KA-' || p.current_branch);
