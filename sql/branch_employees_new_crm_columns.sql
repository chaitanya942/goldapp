-- ─────────────────────────────────────────────────────────────────────────────
-- branch_employees — richer columns to hold the full NEW-CRM Employee profile.
-- Run once in the Supabase SQL editor, then hit "Sync from CRM" on the Branch
-- Employees page (which now pulls from the NEW CRM "Employee" table).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS emp_id          text,
  ADD COLUMN IF NOT EXISTS email           text,
  ADD COLUMN IF NOT EXISTS pan_number      text,
  ADD COLUMN IF NOT EXISTS role            text,
  ADD COLUMN IF NOT EXISTS access_level    text,
  ADD COLUMN IF NOT EXISTS date_of_joining text;

CREATE INDEX IF NOT EXISTS idx_branch_employees_emp_id ON branch_employees (emp_id);
CREATE INDEX IF NOT EXISTS idx_branch_employees_role   ON branch_employees (role);
