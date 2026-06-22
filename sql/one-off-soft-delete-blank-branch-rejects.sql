-- ─────────────────────────────────────────────────────────────────────────────
-- One-off (applied 22-Jun-2026 via service-role script): soft-delete the 14
-- branch-less master rows. AUDIT FINDING: all 14 are crm_status='rejected'
-- data-entry mistakes in the OLD CRM (branch_id NULL — "wrong entry" / "test" /
-- "network issue" / "branch name missing" / duplicate "2bills"), spanning
-- 2021-04 → 2025-05. 13 were immediately re-billed correctly for the same
-- customer at a real branch (approved twin = next bill no); 1 (WGKA1700) was a
-- pure test entry. None are real purchases → no stock / no money exposure.
-- Soft-deleted so they stop showing as branch-less anomalies in reports; they
-- remain in the OLD CRM as rejected for history.
--
-- App ids: WGKA383, WGKA1700, WGKA1747, WGKA1947, WGKA2056, WGKA3443, WGKA3923,
--          WGKA4121, WGKA10180, WGKA11225, WGKA15201, WGKA35632, WGKA40136, WGKA52955
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE purchases
   SET is_deleted = true
 WHERE (branch_name IS NULL OR branch_name = '')
   AND crm_status = 'rejected';

-- VERIFY — expect 0 live blank-branch rows
SELECT count(*) AS live_blank_branch
  FROM purchases
 WHERE (branch_name IS NULL OR branch_name = '')
   AND is_deleted = false;
