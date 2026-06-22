-- ─────────────────────────────────────────────────────────────────────────────
-- One-off (already applied 22-Jun-2026 via service-role script): retro-map the
-- legacy 2021 spelling "T C PALYA" → canonical "TC PALYA" in the purchases
-- master, so the branch reconciles to its Branch Management row.
--   • 65 rows had branch_name   = 'T C PALYA'   → 'TC PALYA'
--   • 56 rows had current_branch = 'T C PALYA'   → 'TC PALYA'
-- Kept here for the audit trail / re-runnability (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE purchases SET branch_name    = 'TC PALYA' WHERE branch_name    = 'T C PALYA';
UPDATE purchases SET current_branch = 'TC PALYA' WHERE current_branch = 'T C PALYA';

-- VERIFY — expect 0 / 0
SELECT
  count(*) FILTER (WHERE branch_name    = 'T C PALYA') AS bn_remaining,
  count(*) FILTER (WHERE current_branch = 'T C PALYA') AS cb_remaining
FROM purchases;
