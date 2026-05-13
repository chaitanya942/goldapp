-- ── Add crm_txn_id to purchases ───────────────────────────────────────────────
-- Stable identity column matching CRM's transac_tbl.id (txn_id).
--
-- application_id (= CRM bill_no) is mutable: staff can rename a bill in CRM,
-- which previously caused sync to insert a fresh Supabase row (defaulting
-- stock_status to 'at_branch') while the original — carrying ops's
-- in_consignment / at_ho movement state — was orphaned and marked deleted by
-- the reconcile pass. Net effect: ops's work disappeared on every rename.
--
-- crm_txn_id lets the sync recognise "same transaction, new bill_no" and
-- UPDATE the existing row's application_id in place, so stock_status persists.
-- application_id stays the user-facing primary identifier; crm_txn_id is the
-- hidden anchor.
--
-- Backfill happens automatically as part of the next sync window (2-day
-- rolling). Older settled bills don't need crm_txn_id for stock_status
-- preservation.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS crm_txn_id BIGINT;

-- Partial index keeps writes cheap (most older rows will stay NULL until
-- they're re-synced) but still gives us fast lookups by txn_id within source.
CREATE INDEX IF NOT EXISTS idx_purchases_crm_txn_id
  ON purchases (crm_txn_id, crm_source)
  WHERE crm_txn_id IS NOT NULL;
