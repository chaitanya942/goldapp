-- Bulk patch helper used by /api/backfill-purchases. Takes a JSON array of
-- per-row patches and applies them as a single SET-based UPDATE — orders of
-- magnitude faster than the previous loop of per-row Supabase REST calls.
--
-- Only the four CRM-sourced fields are touched. Anything not supplied (NULL)
-- is left as-is via COALESCE — never reset to NULL. The function never
-- touches stock_status, dispatched_at, current_branch, weights, etc.
--
-- Run once. Safe to re-run.

create or replace function bulk_patch_purchases_proofs(records jsonb)
returns int
language sql
security definer
set search_path = public
as $$
  with v as (
    select * from jsonb_to_recordset(records) as x(
      application_id    text,
      id_proof_types    text,
      id_proof_numbers  text,
      bank_name         text,
      payment_reference text
    )
  ), updated as (
    update purchases p set
      id_proof_types    = coalesce(v.id_proof_types,    p.id_proof_types),
      id_proof_numbers  = coalesce(v.id_proof_numbers,  p.id_proof_numbers),
      bank_name         = coalesce(v.bank_name,         p.bank_name),
      payment_reference = coalesce(v.payment_reference, p.payment_reference)
    from v where p.application_id = v.application_id
    returning 1
  )
  select count(*)::int from updated;
$$;

grant execute on function bulk_patch_purchases_proofs(jsonb) to service_role;
