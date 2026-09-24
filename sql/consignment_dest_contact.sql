-- Destination-side contact on a consignment — who at the hub/HO end is on
-- record for this shipment. Record-keeping only: unlike branch_contact_name/
-- branch_contact_phone (which print on the Issue Voucher / Delivery
-- Challan), these are never read by a document generator — just stored for
-- later reference (e.g. surfaced in the consignment's activity/detail view).
-- Run once in the Supabase SQL editor. Idempotent.

ALTER TABLE consignments ADD COLUMN IF NOT EXISTS dest_contact_name  TEXT;
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS dest_contact_phone TEXT;
