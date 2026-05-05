-- sql/credit_note_columns.sql
--
-- Stores the Credit Note IRN issued against a wrongly-generated E-Invoice
-- whose 24-hour cancellation window has passed.
--
-- Both the original IRN and the credit_note_irn are kept on the consignment
-- row so the audit trail shows the full history. Both end up in GSTR-1
-- (original = positive line, credit note = negative line, net zero tax).
--
-- Apply via Supabase SQL Editor. Idempotent.

ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS credit_note_irn          TEXT,
  ADD COLUMN IF NOT EXISTS credit_note_ack_no       TEXT,
  ADD COLUMN IF NOT EXISTS credit_note_ack_dt       TEXT,
  ADD COLUMN IF NOT EXISTS credit_note_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credit_note_response     JSONB;

CREATE INDEX IF NOT EXISTS idx_consignments_credit_note_irn
  ON consignments (credit_note_irn)
  WHERE credit_note_irn IS NOT NULL;
