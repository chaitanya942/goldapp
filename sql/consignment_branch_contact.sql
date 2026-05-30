-- sql/consignment_branch_contact.sql
--
-- Per-consignment override for the branch contact (name + phone) that
-- prints on the Delivery Challan and Issue Voucher.
--
-- Why a per-consignment override (instead of just reading branches.contact_person
-- live at generation time): the operator filling out the consignment knows who
-- actually packed and handed over this specific shipment. The "default" branch
-- contact may be a different person (the branch manager) — operations needs to
-- record the person responsible for THIS shipment so the receiving end can
-- reach the right person if something is off when they unpack.
--
-- Both columns nullable — null = use the live branches.contact_person /
-- contact_phone as the fallback. So existing consignments (created before
-- this column existed) keep working unchanged.
--
-- Idempotent — safe to re-run.

ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS branch_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS branch_contact_phone TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Branch-level contact email (additive — name + phone already exist as
-- branches.contact_person + contact_phone). Email is currently informational —
-- not used in any document — but ops wants a slot for it on the Branch
-- Management form so it's captured alongside name + phone.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS contact_email TEXT;
