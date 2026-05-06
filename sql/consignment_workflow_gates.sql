-- sql/consignment_workflow_gates.sql
--
-- Sequential workflow gates for consignment document generation.
-- The flow operations runs is:
--
--   1. Bills are added to the consignment
--   2. Operations clicks "Confirm Consignment" → ops_confirmed_at stamped,
--      bill list is now locked (no add/remove). Report can be generated.
--   3. Operations / Accounts clicks "Generate Consignee Report" →
--      consignee_report_generated_at stamped. Voucher / Challan unlock.
--   4. Operations clicks "Generate Issue Voucher" (Branch→Hub) or
--      "Generate Delivery Challan" (other movements). Stamp issue_voucher_*
--      or delivery_challan_*. Preview EWB / E-Invoice unlock.
--   5. Accounts clicks "Preview EWB" → review → "Confirm & Generate" → NIC.
--      ewb_generated_at + einvoice_generated_at already exist (Phase C).
--
-- Each step requires the prior step's timestamp to be set. UI shows a
-- workflow stepper so operations can see exactly where they are.
--
-- Apply via Supabase SQL Editor. Idempotent.

ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS ops_confirmed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ops_confirmed_by              UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS consignee_report_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consignee_report_generated_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS issue_voucher_generated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS issue_voucher_generated_by    UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS delivery_challan_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_challan_generated_by UUID REFERENCES user_profiles(id);

COMMENT ON COLUMN consignments.ops_confirmed_at IS
  'When operations explicitly confirmed the bill list is final. Locks bills and unlocks the consignee report. Reset by reopening the consignment.';
COMMENT ON COLUMN consignments.consignee_report_generated_at IS
  'Last time the consignee-report PDF was generated. Required before issue voucher / delivery challan can be generated.';
COMMENT ON COLUMN consignments.issue_voucher_generated_at IS
  'Last time the issue voucher PDF was generated (Branch→Hub flow). Required before EWB / E-Invoice preview unlocks for this flow.';
COMMENT ON COLUMN consignments.delivery_challan_generated_at IS
  'Last time the delivery challan PDF was generated. Required before EWB / E-Invoice preview unlocks for non-voucher flows.';
