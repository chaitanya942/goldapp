-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: fix existing new-CRM bills recorded under 'MANGALURU' → 'MANGALORE'
-- (GoldApp's canonical branch name). The lib/crmBranchAlias.js mapping handles
-- future syncs; this corrects the ~5 rows already synced before the alias.
--
-- Scoped to crm_source='new_crm' so old-CRM rows (already 'MANGALORE') are
-- untouched. Matching is case-insensitive on the branch name.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PREVIEW ──────────────────────────────────────────────────────────────────
SELECT application_id, crm_source, branch_name, current_branch, stock_status, purchase_date, net_weight
  FROM purchases
 WHERE crm_source = 'new_crm'
   AND branch_name ILIKE 'mangaluru';

-- ── APPLY ────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE purchases
   SET branch_name = 'MANGALORE',
       current_branch = CASE WHEN current_branch ILIKE 'mangaluru' THEN 'MANGALORE' ELSE current_branch END
 WHERE crm_source = 'new_crm'
   AND branch_name ILIKE 'mangaluru';

COMMIT;

-- ── VERIFY (expect 0) ─────────────────────────────────────────────────────────
SELECT count(*) AS still_mangaluru
  FROM purchases
 WHERE crm_source = 'new_crm'
   AND branch_name ILIKE 'mangaluru';
