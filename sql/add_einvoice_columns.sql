-- E-Invoice (IRP) fields on consignments.
-- Run once in Supabase SQL editor.

ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS irn             TEXT,
  ADD COLUMN IF NOT EXISTS ack_no          TEXT,
  ADD COLUMN IF NOT EXISTS ack_dt          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_qr_code  TEXT;
