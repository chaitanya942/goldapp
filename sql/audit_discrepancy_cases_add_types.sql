-- ─────────────────────────────────────────────────────────────────────────────
-- Extend audit_discrepancy_cases for the two COUNT-mismatch reports the auditor
-- raises straight to ops (no Audit-Head review), alongside the existing WEIGHT
-- discrepancies (which still route via the Audit Report → Send to Ops).
--
--   case_type = 'weight'        — existing: audit gross < CRM gross (head-routed)
--             = 'not_received'  — bill IS in the consignment/audit data but no
--                                 physical gold arrived (auditor one-click)
--             = 'extra_received'— physical bill received that is NOT in the audit
--                                 data (the 5th of 5 vs 4 consigned). May or may
--                                 not carry an App ID, so purchase_id is nullable.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_discrepancy_cases
  ADD COLUMN IF NOT EXISTS case_type      text NOT NULL DEFAULT 'weight'
                           CHECK (case_type IN ('weight', 'not_received', 'extra_received')),
  ADD COLUMN IF NOT EXISTS auditor_note   text,        -- auditor's free note on the exception
  ADD COLUMN IF NOT EXISTS consignment_id uuid,        -- consignment the exception was reported against
  ADD COLUMN IF NOT EXISTS extra_app_id   text,        -- extra bill's App ID (if the auditor had it)
  ADD COLUMN IF NOT EXISTS extra_branch   text,        -- extra bill's branch (auto-filled if App ID matched)
  ADD COLUMN IF NOT EXISTS extra_gross_g  numeric;     -- extra bill's weighed gross

-- An extra-received bill with no App ID has no purchase to point at.
ALTER TABLE audit_discrepancy_cases ALTER COLUMN purchase_id DROP NOT NULL;

-- The "one open case per bill" guard still holds for cases that DO carry a
-- purchase_id (NULLs are distinct in a unique index, so multiple no-App-ID
-- extra-received cases coexist fine).
