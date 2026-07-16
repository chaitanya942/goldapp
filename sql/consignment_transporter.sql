-- Per-consignment transporter, so the Delivery Challan / E-Invoice reflect who
-- actually carried a consignment (BVC Logistics vs a branch employee vs some
-- other courier) instead of a single global default that always said BVC.
--
-- Empty/NULL means "use the company default" (BVC) at document-render time, so
-- every existing consignment keeps behaving exactly as before.
ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS transporter_name text,
  ADD COLUMN IF NOT EXISTS transport_mode   text;
