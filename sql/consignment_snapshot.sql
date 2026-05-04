-- sql/consignment_snapshot.sql
--
-- Snapshot fields for consignments + consignment_items.
--
-- Why: EWB/E-Invoice generators currently re-read live `branches.address` and
-- `purchases.gross_weight` at generation time. If anything changes between
-- consignment creation and document generation (branch address corrected,
-- a bill's weight edited, etc.), the document drifts from the consignment.
--
-- Fix: every consignment row freezes its source/dest address + GSTIN + PIN
-- at creation time, and every consignment_items row freezes the bill's
-- weight/amount/customer at the same moment. The EWB/E-Invoice generators
-- read from these snapshots — never from live tables.
--
-- This migration is idempotent (IF NOT EXISTS everywhere) and back-fills
-- existing rows from current live data so no consignment is left without
-- a snapshot.
--
-- Apply via: Supabase SQL Editor.

-- ── consignments: source + destination address snapshot + total gross weight ──
ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS total_gross_wt   NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS source_address   TEXT,
  ADD COLUMN IF NOT EXISTS source_city      TEXT,
  ADD COLUMN IF NOT EXISTS source_pin       TEXT,
  ADD COLUMN IF NOT EXISTS source_state     TEXT,
  ADD COLUMN IF NOT EXISTS source_region    TEXT,
  ADD COLUMN IF NOT EXISTS source_gstin     TEXT,
  ADD COLUMN IF NOT EXISTS dest_address     TEXT,
  ADD COLUMN IF NOT EXISTS dest_city        TEXT,
  ADD COLUMN IF NOT EXISTS dest_pin         TEXT,
  ADD COLUMN IF NOT EXISTS dest_state       TEXT,
  ADD COLUMN IF NOT EXISTS dest_region      TEXT,
  ADD COLUMN IF NOT EXISTS dest_gstin       TEXT;

-- ── consignment_items: per-bill snapshot ────────────────────────────────────
ALTER TABLE consignment_items
  ADD COLUMN IF NOT EXISTS bill_no_snap        TEXT,
  ADD COLUMN IF NOT EXISTS gross_weight_snap   NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS net_weight_snap     NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS total_amount_snap   NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS customer_name_snap  TEXT,
  ADD COLUMN IF NOT EXISTS purchase_date_snap  DATE,
  ADD COLUMN IF NOT EXISTS hsn_code_snap       TEXT;

-- ── Backfill: copy live data into snapshot for existing rows that don't have it ──
-- consignments source/dest from branches
UPDATE consignments c
SET source_address = COALESCE(c.source_address, b.address),
    source_city    = COALESCE(c.source_city,    b.city),
    source_pin     = COALESCE(c.source_pin,     b.pin_code),
    source_state   = COALESCE(c.source_state,   b.state),
    source_region  = COALESCE(c.source_region,  b.region),
    source_gstin   = COALESCE(c.source_gstin,   b.branch_gstin)
FROM branches b
WHERE b.name = c.branch_name
  AND (c.source_address IS NULL OR c.source_pin IS NULL);

UPDATE consignments c
SET dest_address = COALESCE(c.dest_address, b.address),
    dest_city    = COALESCE(c.dest_city,    b.city),
    dest_pin     = COALESCE(c.dest_pin,     b.pin_code),
    dest_state   = COALESCE(c.dest_state,   b.state),
    dest_region  = COALESCE(c.dest_region,  b.region),
    dest_gstin   = COALESCE(c.dest_gstin,   b.branch_gstin)
FROM branches b
WHERE b.name = c.dest_branch
  AND c.movement_type = 'INTERNAL'
  AND (c.dest_address IS NULL OR c.dest_pin IS NULL);

-- consignment_items per-bill snapshot from purchases
UPDATE consignment_items ci
SET bill_no_snap       = COALESCE(ci.bill_no_snap,       p.bill_no),
    gross_weight_snap  = COALESCE(ci.gross_weight_snap,  p.gross_weight),
    net_weight_snap    = COALESCE(ci.net_weight_snap,    p.net_weight),
    total_amount_snap  = COALESCE(ci.total_amount_snap,  p.total_amount),
    customer_name_snap = COALESCE(ci.customer_name_snap, p.customer_name),
    purchase_date_snap = COALESCE(ci.purchase_date_snap, p.purchase_date::DATE),
    hsn_code_snap      = COALESCE(ci.hsn_code_snap,      p.hsn_code)
FROM purchases p
WHERE p.id = ci.purchase_id
  AND (ci.gross_weight_snap IS NULL OR ci.total_amount_snap IS NULL);

-- consignments.total_gross_wt backfill from snapshotted item rows
UPDATE consignments c
SET total_gross_wt = COALESCE(c.total_gross_wt, sub.tot_gross)
FROM (
  SELECT ci.consignment_id, SUM(COALESCE(ci.gross_weight_snap, 0)) AS tot_gross
  FROM consignment_items ci
  GROUP BY ci.consignment_id
) sub
WHERE sub.consignment_id = c.id
  AND c.total_gross_wt IS NULL;
