-- ============================================================================
-- GoldApp Complete Database Schema
-- Run this entire file in Supabase SQL Editor (safe to re-run anytime)
-- ============================================================================


-- ============================================================================
-- 1. COMPANY SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name         TEXT NOT NULL,
  head_office_address  TEXT,
  head_office_city     TEXT,
  head_office_state    TEXT,
  head_office_pin      TEXT,
  gstin                TEXT,
  pan                  TEXT,
  hsn_code             TEXT DEFAULT '711319',
  transporter_name     TEXT DEFAULT 'BVC LOGISTICS PVT. LTD.',
  transportation_mode  TEXT DEFAULT 'BY AIR & ROAD',
  logo_url             TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO company_settings (company_name, gstin, pan, head_office_address, head_office_city, head_office_state, head_office_pin)
VALUES (
  'WHITE GOLD BULLION PVT.LTD',
  '29AAPCA3170M1Z5',
  'AAPCA3170M',
  'NO-75 FIRST FLOOR HOSUR ROAD KORAMANGALA, INDUSTRIAL AREA',
  'BENGALURU URBAN',
  'KARNATAKA',
  '560095'
) ON CONFLICT DO NOTHING;


-- ============================================================================
-- 2. EXTEND BRANCHES TABLE
-- ============================================================================
ALTER TABLE branches ADD COLUMN IF NOT EXISTS address              TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS city                 TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS state                TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS pin_code             TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_person       TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_phone        TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_gstin         TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_code          TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_employee      TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_employee_phone TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS crm_branch_id        TEXT;

-- Convert INT to TEXT if column was previously created as INT
DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branches' AND column_name = 'crm_branch_id' AND data_type = 'integer'
  ) THEN
    ALTER TABLE branches ALTER COLUMN crm_branch_id TYPE TEXT USING crm_branch_id::TEXT;
  END IF;
END $;

-- Unique index for CRM sync matching
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_crm_id
  ON branches(crm_branch_id)
  WHERE crm_branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branches_name   ON branches(name);
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(is_active);


-- ============================================================================
-- 3. CONSIGNMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS consignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tmp_prf_no    TEXT UNIQUE NOT NULL,
  external_no   TEXT,
  internal_no   TEXT,
  challan_no    TEXT UNIQUE NOT NULL,
  branch_name   TEXT NOT NULL,
  branch_code   TEXT,
  state_code    TEXT,
  movement_type TEXT DEFAULT 'EXTERNAL',
  status        TEXT DEFAULT 'draft',
  total_bills   INTEGER DEFAULT 0,
  total_net_wt  NUMERIC DEFAULT 0,
  total_amount  NUMERIC DEFAULT 0,
  total_gst     NUMERIC DEFAULT 0,
  dispatched_at TIMESTAMPTZ,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- If table was created earlier with column named branch_names (plural), rename it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consignments' AND column_name = 'branch_names'
  ) THEN
    ALTER TABLE consignments RENAME COLUMN branch_names TO branch_name;
  END IF;
END $$;

-- Add branch_code if missing
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS branch_code TEXT;

CREATE INDEX IF NOT EXISTS idx_consignments_branch     ON consignments(branch_name);
CREATE INDEX IF NOT EXISTS idx_consignments_status     ON consignments(status);
CREATE INDEX IF NOT EXISTS idx_consignments_created_at ON consignments(created_at);


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

CREATE INDEX IF NOT EXISTS idx_consignment_items_consignment_id ON consignment_items(consignment_id);
CREATE INDEX IF NOT EXISTS idx_consignment_items_purchase_id    ON consignment_items(purchase_id);


-- ============================================================================
-- 5. BRANCH EMPLOYEES TABLE
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

-- If table already exists, ensure columns are correct types
ALTER TABLE branch_employees ADD COLUMN IF NOT EXISTS crm_branch_name TEXT;
ALTER TABLE branch_employees ADD COLUMN IF NOT EXISTS crm_branch_code TEXT;

-- If crm_branch_id was created as INT, change to TEXT (supports codes like "WG-2051", "HO", etc.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branch_employees'
      AND column_name = 'crm_branch_id'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE branch_employees ALTER COLUMN crm_branch_id TYPE TEXT USING crm_branch_id::TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_branch_employees_branch_id  ON branch_employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_employees_crm_branch ON branch_employees(crm_branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_employees_status     ON branch_employees(emp_status);
CREATE INDEX IF NOT EXISTS idx_branch_employees_manager    ON branch_employees(is_manager);


-- ============================================================================
-- DONE. Next steps:
-- 1. Go to Branch Management → click "↻ Sync CRM"
-- 2. Go to Branch Employees → click "↻ Sync from CRM"
-- 3. Go to Company Settings → fill in company details
-- ============================================================================
