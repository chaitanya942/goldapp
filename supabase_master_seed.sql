-- ============================================================================
-- GoldApp — Master Database Setup + Seed
-- Run this entire file in Supabase SQL Editor
-- Safe to re-run anytime (uses IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- ============================================================================


-- ============================================================================
-- 1. COMPANY SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT NOT NULL DEFAULT '',
  pan                   TEXT DEFAULT '',
  -- Head Office / Consignee (right side of delivery challan)
  gstin                 TEXT DEFAULT '',   -- HO GSTIN (Karnataka)
  head_office_building  TEXT DEFAULT '',
  head_office_address   TEXT DEFAULT '',
  head_office_city      TEXT DEFAULT '',
  head_office_state     TEXT DEFAULT '',
  head_office_pin       TEXT DEFAULT '',
  -- State-wise branch GSTINs (bill-from side of challan)
  gstin_ka              TEXT DEFAULT '',
  gstin_ap              TEXT DEFAULT '',
  gstin_kl              TEXT DEFAULT '',
  gstin_ts              TEXT DEFAULT '',
  gstin_tn              TEXT DEFAULT '',
  -- Transport & product
  transporter_name      TEXT DEFAULT 'BVC LOGISTICS PVT. LTD.',
  transportation_mode   TEXT DEFAULT 'BY AIR & ROAD',
  hsn_code              TEXT DEFAULT '711319',
  -- Tax rates
  igst_rate             NUMERIC DEFAULT 3,
  value_uplift_pct      NUMERIC DEFAULT 7.5,
  -- Logo
  logo_url              TEXT DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Add any columns that may be missing in older installs
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS pan                  TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstin_ka             TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstin_ap             TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstin_kl             TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstin_ts             TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstin_tn             TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS head_office_building TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS igst_rate            NUMERIC DEFAULT 3;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS value_uplift_pct     NUMERIC DEFAULT 7.5;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS logo_url             TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();

-- Seed one row — edit values in Admin > Company Settings in the app
-- All GSTINs/PAN/address left blank intentionally (must be set via Company Settings UI)
INSERT INTO company_settings (
  company_name, transporter_name, transportation_mode,
  hsn_code, igst_rate, value_uplift_pct
)
SELECT
  'WHITE GOLD BULLION PVT.LTD', 'BVC LOGISTICS PVT. LTD.', 'BY AIR & ROAD',
  '711319', 3, 7.5
WHERE NOT EXISTS (SELECT 1 FROM company_settings);


-- ============================================================================
-- 2. BRANCHES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS branches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  region       TEXT,
  state        TEXT,
  cluster      TEXT,
  model_type   TEXT,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Extend with columns added over time
ALTER TABLE branches ADD COLUMN IF NOT EXISTS address               TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS city                  TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS state                 TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS pin_code              TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_person        TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_phone         TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_gstin          TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_code           TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS crm_branch_id         TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_employee       TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_employee_phone TEXT;

-- Fix crm_branch_id type if was created as INTEGER
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branches' AND column_name = 'crm_branch_id' AND data_type = 'integer'
  ) THEN
    ALTER TABLE branches ALTER COLUMN crm_branch_id TYPE TEXT USING crm_branch_id::TEXT;
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_crm_id  ON branches (crm_branch_id) WHERE crm_branch_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_branches_name     ON branches (name);
CREATE INDEX        IF NOT EXISTS idx_branches_is_active ON branches (is_active);
CREATE INDEX        IF NOT EXISTS idx_branches_region   ON branches (region);


-- ============================================================================
-- 3. CONSIGNMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS consignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_no TEXT UNIQUE NOT NULL,   -- legacy NOT NULL column (mirrors challan_no)
  tmp_prf_no     TEXT,
  external_no    TEXT,
  internal_no    TEXT,
  challan_no     TEXT UNIQUE,
  branch_name    TEXT NOT NULL,
  branch_code    TEXT,
  state_code     TEXT,
  movement_type  TEXT DEFAULT 'EXTERNAL',
  status         TEXT DEFAULT 'draft',   -- draft → dispatched → received
  total_bills    INTEGER DEFAULT 0,
  total_net_wt   NUMERIC DEFAULT 0,
  total_amount   NUMERIC DEFAULT 0,
  total_gst      NUMERIC DEFAULT 0,
  dispatched_at  TIMESTAMPTZ,
  dispatched_by  TEXT,
  received_at    TIMESTAMPTZ,
  received_by    TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may be missing in older installs
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS dispatched_by TEXT;
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS received_at   TIMESTAMPTZ;
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS received_by   TEXT;

-- Rename old branch_names → branch_name if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consignments' AND column_name = 'branch_names'
  ) THEN
    ALTER TABLE consignments RENAME COLUMN branch_names TO branch_name;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_consignments_external_no  ON consignments (external_no DESC);
CREATE INDEX IF NOT EXISTS idx_consignments_branch_name  ON consignments (branch_name);
CREATE INDEX IF NOT EXISTS idx_consignments_state_code   ON consignments (state_code);
CREATE INDEX IF NOT EXISTS idx_consignments_status       ON consignments (status);
CREATE INDEX IF NOT EXISTS idx_consignments_created_at   ON consignments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consignments_tmp_prf_no   ON consignments (tmp_prf_no DESC);
CREATE INDEX IF NOT EXISTS idx_consignments_branch_code  ON consignments (branch_code);


-- ============================================================================
-- 4. CONSIGNMENT ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS consignment_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID REFERENCES consignments(id) ON DELETE CASCADE,
  purchase_id    UUID NOT NULL,
  added_by       TEXT,
  added_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consignment_items_consignment_id ON consignment_items (consignment_id);
CREATE INDEX IF NOT EXISTS idx_consignment_items_purchase_id    ON consignment_items (purchase_id);


-- ============================================================================
-- 5. PURCHASES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_date DATE,
  customer_name TEXT,
  branch_name   TEXT,
  gross_weight  NUMERIC DEFAULT 0,
  stone_weight  NUMERIC DEFAULT 0,
  wastage       NUMERIC DEFAULT 0,
  net_weight    NUMERIC DEFAULT 0,
  rate          NUMERIC DEFAULT 0,
  total_amount  NUMERIC DEFAULT 0,
  stock_status  TEXT DEFAULT 'at_branch',  -- at_branch | in_consignment | at_ho | sold
  is_deleted    BOOLEAN DEFAULT false,
  dispatched_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may be missing
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS gross_weight  NUMERIC DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stone_weight  NUMERIC DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS wastage       NUMERIC DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_purchases_branch_name   ON purchases (branch_name);
CREATE INDEX IF NOT EXISTS idx_purchases_stock_status  ON purchases (stock_status);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date ON purchases (purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_is_deleted    ON purchases (is_deleted);


-- ============================================================================
-- 6. BRANCH EMPLOYEES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS branch_employees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID REFERENCES branches(id) ON DELETE SET NULL,
  crm_branch_id    TEXT,
  crm_branch_name  TEXT,
  crm_branch_code  TEXT,
  name             TEXT NOT NULL,
  designation      TEXT,
  contact_phone    TEXT,
  mobile_phone     TEXT,
  emp_status       TEXT DEFAULT 'active',
  is_manager       BOOLEAN DEFAULT false,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE branch_employees ADD COLUMN IF NOT EXISTS crm_branch_name TEXT;
ALTER TABLE branch_employees ADD COLUMN IF NOT EXISTS crm_branch_code TEXT;

-- Fix type if crm_branch_id was created as INTEGER
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branch_employees' AND column_name = 'crm_branch_id' AND data_type = 'integer'
  ) THEN
    ALTER TABLE branch_employees ALTER COLUMN crm_branch_id TYPE TEXT USING crm_branch_id::TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_branch_employees_branch_id  ON branch_employees (branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_employees_crm_branch ON branch_employees (crm_branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_employees_status     ON branch_employees (emp_status);
CREATE INDEX IF NOT EXISTS idx_branch_employees_manager    ON branch_employees (is_manager);


-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE consignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_employees  ENABLE ROW LEVEL SECURITY;

-- Service role key (used by all API routes) bypasses RLS automatically.
-- These policies only affect direct browser/anon access.
-- Allow authenticated users to read branches and company_settings (needed for UI dropdowns)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'branches' AND policyname = 'authenticated read branches') THEN
    CREATE POLICY "authenticated read branches"
      ON branches FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_settings' AND policyname = 'authenticated read company_settings') THEN
    CREATE POLICY "authenticated read company_settings"
      ON company_settings FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ============================================================================
-- DONE
-- Next steps after running this:
-- 1. Admin > Company Settings → fill in company name, GSTINs, PAN, address
-- 2. Topbar > Sync CRM → pulls all branches from CRM
-- 3. Admin > Branch Management → verify branches, add addresses
-- ============================================================================
