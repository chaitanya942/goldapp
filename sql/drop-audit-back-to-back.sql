-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the back-to-back constraint on audit_shift_assignments.
--
-- Background:
--   The original sql/audit_shift_assignments.sql installed a BEFORE INSERT/
--   UPDATE trigger (trg_audit_shift_no_back_to_back) that blocked the same
--   auditor from being assigned to night N and morning N+1 of the same
--   pair. Ops asked to remove this rule — same auditor running both
--   halves of a back-to-back pair is now allowed.
--
-- This script:
--   - Drops the trigger and its function so future INSERT/UPDATE no longer
--     fires the rule.
--   - Leaves the rest of the schema (UNIQUE constraint per (date, type,
--     auditor), the two-per-slot trigger, indexes, RLS) untouched.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TRIGGER  IF EXISTS trg_audit_shift_no_back_to_back ON audit_shift_assignments;
DROP FUNCTION IF EXISTS audit_shift_no_back_to_back();

COMMIT;
