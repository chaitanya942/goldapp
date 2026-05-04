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
--
-- The backfill is wrapped in DO blocks that introspect information_schema before
-- referencing each source column. Reasons:
--   1. `purchases.hsn_code` does not exist on this deployment (HSN lives on
--      company_settings). Other deployments may have it per-bill — both work.
--   2. `purchases.sl_no` may be INTEGER on some rows (legacy) or TEXT on others.
--      A blind COALESCE(ci.bill_no_snap, p.sl_no) fails on the type mismatch.
--      The dynamic-SQL form casts to TEXT only if needed.
--   3. `purchases.purchase_date` is DATE in the seed but may be TIMESTAMP in
--      some deployments — explicit cast handles both.
--
-- This is intentionally over-defensive so the migration runs cleanly on every
-- branch of the schema family, and so future column additions/renames don't
-- silently corrupt the snapshot.

-- consignments.source_* from branches.* (branches schema is stable across deployments)
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

-- ── consignment_items per-bill snapshot — defensive, column-by-column ──────
-- A small helper: detect column data type. Returns NULL when the column is
-- absent so the caller knows to skip that field entirely.
DO $$
DECLARE
  has_sl_no         BOOLEAN;
  sl_no_type        TEXT;
  has_gross_weight  BOOLEAN;
  has_net_weight    BOOLEAN;
  has_total_amount  BOOLEAN;
  has_customer_name BOOLEAN;
  has_purchase_date BOOLEAN;
  has_hsn_code      BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='sl_no'),
         (SELECT data_type FROM information_schema.columns WHERE table_name='purchases' AND column_name='sl_no')
    INTO has_sl_no, sl_no_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='gross_weight')  INTO has_gross_weight;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='net_weight')    INTO has_net_weight;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='total_amount')  INTO has_total_amount;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='customer_name') INTO has_customer_name;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='purchase_date') INTO has_purchase_date;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='hsn_code')      INTO has_hsn_code;

  -- bill_no_snap ← sl_no (cast to TEXT regardless of source type)
  IF has_sl_no THEN
    EXECUTE format(
      'UPDATE consignment_items ci SET bill_no_snap = COALESCE(ci.bill_no_snap, p.sl_no::TEXT) FROM purchases p WHERE p.id = ci.purchase_id AND ci.bill_no_snap IS NULL'
    );
  END IF;

  IF has_gross_weight THEN
    EXECUTE 'UPDATE consignment_items ci SET gross_weight_snap = COALESCE(ci.gross_weight_snap, p.gross_weight) FROM purchases p WHERE p.id = ci.purchase_id AND ci.gross_weight_snap IS NULL';
  END IF;

  IF has_net_weight THEN
    EXECUTE 'UPDATE consignment_items ci SET net_weight_snap = COALESCE(ci.net_weight_snap, p.net_weight) FROM purchases p WHERE p.id = ci.purchase_id AND ci.net_weight_snap IS NULL';
  END IF;

  IF has_total_amount THEN
    EXECUTE 'UPDATE consignment_items ci SET total_amount_snap = COALESCE(ci.total_amount_snap, p.total_amount) FROM purchases p WHERE p.id = ci.purchase_id AND ci.total_amount_snap IS NULL';
  END IF;

  IF has_customer_name THEN
    EXECUTE 'UPDATE consignment_items ci SET customer_name_snap = COALESCE(ci.customer_name_snap, p.customer_name) FROM purchases p WHERE p.id = ci.purchase_id AND ci.customer_name_snap IS NULL';
  END IF;

  -- purchase_date may be DATE or TIMESTAMP depending on deployment — explicit cast handles both
  IF has_purchase_date THEN
    EXECUTE 'UPDATE consignment_items ci SET purchase_date_snap = COALESCE(ci.purchase_date_snap, p.purchase_date::DATE) FROM purchases p WHERE p.id = ci.purchase_id AND ci.purchase_date_snap IS NULL';
  END IF;

  -- hsn_code is present on some deployments, absent on others (HSN lives on company_settings here).
  -- Skip silently when absent — generators fall back to companySettings.hsn_code.
  IF has_hsn_code THEN
    EXECUTE 'UPDATE consignment_items ci SET hsn_code_snap = COALESCE(ci.hsn_code_snap, p.hsn_code) FROM purchases p WHERE p.id = ci.purchase_id AND ci.hsn_code_snap IS NULL';
  END IF;
END $$;

-- consignments.total_gross_wt ← sum of consignment_items.gross_weight_snap
UPDATE consignments c
SET total_gross_wt = COALESCE(c.total_gross_wt, sub.tot_gross)
FROM (
  SELECT ci.consignment_id, SUM(COALESCE(ci.gross_weight_snap, 0)) AS tot_gross
  FROM consignment_items ci
  GROUP BY ci.consignment_id
) sub
WHERE sub.consignment_id = c.id
  AND c.total_gross_wt IS NULL;
