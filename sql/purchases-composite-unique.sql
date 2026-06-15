-- ─────────────────────────────────────────────────────────────────────────────
-- purchases: application_id is unique PER CRM SOURCE, not globally.
-- ─────────────────────────────────────────────────────────────────────────────
-- The new CRM (Postgres) restarted its own bill numbering, so it reuses WGKA
-- numbers that the old CRM already used for DIFFERENT bills (e.g. WGKA55434 is
-- "TEST ASBEER MK / 14-Jun-2026" in the new CRM but "Sreelekshmi / 02-Jun-2025"
-- in the old CRM). The global UNIQUE on application_id blocked the new-CRM sync.
--
-- Every live sync already upserts with onConflict (application_id, crm_source)
-- — this migration makes the actual constraint match that design so old_crm and
-- new_crm rows with the same number can coexist.
--
-- Safe: the 103k existing rows are all crm_source='old_crm' with distinct
-- application_ids, so the composite constraint holds. No FK references
-- application_id (links use the uuid id), so dropping the old constraint is safe.
--
-- ⚠ Follow-up (not blocking go-live): any app query that looks a bill up by
--   application_id ALONE can now match two rows (old_crm + new_crm). Operational
--   flows filter by recency/status so the historical old_crm row is normally
--   excluded, but plain `.eq('application_id', x).single()` lookups should be
--   made crm_source-aware over time.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Drop the global application_id unique (both possible names).
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_application_id_unique;
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_application_id_key;

-- A bill number is unique within a CRM source.
ALTER TABLE purchases
  ADD CONSTRAINT purchases_application_id_crm_source_unique
  UNIQUE (application_id, crm_source);

COMMIT;
