-- Phase B — Hub model + Branch→Hub flow
-- Adds:
--   branches.is_hub                — does this branch act as a hub for nearby branches?
--   branches.hub_branch_name       — for non-hub branches, which hub do they ship to (null = direct to HO)
--   consignments.dest_branch       — destination of the consignment (hub name for INTERNAL, null/HO for EXTERNAL)
--   purchases.current_branch       — physical location (= branch_name normally, hub name after transfer)
-- Run once in Supabase SQL editor.

-- ─── branches: hub flags ───────────────────────────────────────────────────
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS is_hub          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS hub_branch_name TEXT;

-- ─── consignments: destination branch (used for INTERNAL → hub) ────────────
ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS dest_branch TEXT,
  ADD COLUMN IF NOT EXISTS eway_bill_no TEXT;

-- ─── purchases: track current physical location ───────────────────────────
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS current_branch TEXT;

-- Backfill: existing rows haven't moved → current_branch = branch_name
UPDATE purchases SET current_branch = branch_name WHERE current_branch IS NULL;

-- Helpful indexes for branch-stock + hub queries
CREATE INDEX IF NOT EXISTS idx_purchases_current_branch_status ON purchases (current_branch, stock_status);
CREATE INDEX IF NOT EXISTS idx_branches_hub_branch_name        ON branches (hub_branch_name);
