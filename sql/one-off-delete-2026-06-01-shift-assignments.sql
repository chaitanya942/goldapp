-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — delete every audit_shift_assignment for shift_date 2026-06-01
-- ─────────────────────────────────────────────────────────────────────────────
-- Test data from when the roster module first went live. The Audit History
-- view picks it up as YESTERDAY which clutters the real schedule.
--
-- Cascade-safe: audit_shift_assignments has no FKs pointing into it; only
-- the row itself goes.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Preview — show what we're about to delete.
SELECT id, shift_date, shift_type, auditor_id, assigned_at
  FROM audit_shift_assignments
 WHERE shift_date = DATE '2026-06-01';

-- Apply.
DELETE FROM audit_shift_assignments
 WHERE shift_date = DATE '2026-06-01';

-- Verify — should return 0.
SELECT COUNT(*) AS remaining_2026_06_01
  FROM audit_shift_assignments
 WHERE shift_date = DATE '2026-06-01';

COMMIT;
