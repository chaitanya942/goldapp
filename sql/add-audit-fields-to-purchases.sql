-- Collection Audit module storage. Records each bill's per-arrival weight
-- check at HO: the auditor types the measured gross weight, the system
-- compares against the CRM-entered gross_weight, and either marks the bill
-- received (stock_status → at_ho) or keeps it pending for re-weighing.
--
-- Columns:
--   audit_gross_weight   The weight the auditor measured (g). NULL until audited.
--   audit_discrepancy_g  Generated: measured − CRM. Positive if auditor measured more,
--                        negative if less. NULL when audit_gross_weight is NULL.
--   audited_at           Timestamp of the latest audit action. Updated on every
--                        Mark Received / Keep Pending click.
--   audited_by           UUID of the auditor (auth.users.id).
--   audit_remark         Free-text note. Required when a discrepancy is accepted.
--
-- Idempotent. Safe to re-run.

alter table purchases add column if not exists audit_gross_weight   numeric(10,3);
alter table purchases add column if not exists audited_at           timestamptz;
alter table purchases add column if not exists audited_by           uuid;
alter table purchases add column if not exists audit_remark         text;

-- Generated column for the diff. Postgres 12+ supports STORED generated cols.
-- Re-creating the column on each run would error, so we wrap in a DO block.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'purchases' and column_name = 'audit_discrepancy_g'
  ) then
    alter table purchases
      add column audit_discrepancy_g numeric(10,3)
      generated always as (audit_gross_weight - gross_weight) stored;
  end if;
end $$;

-- Lookups for the Collection Audit page: "show me everything pending audit"
-- and "show me everything with a recorded discrepancy". Both filter by status
-- and audit-presence — partial indexes keep them small.
create index if not exists idx_purchases_pending_audit
  on purchases (purchase_date desc)
  where stock_status in ('at_branch', 'in_consignment')
    and is_deleted = false
    and crm_status != 'deleted';

create index if not exists idx_purchases_audit_discrepancy
  on purchases (audited_at desc)
  where audit_discrepancy_g is not null and audit_discrepancy_g != 0;
