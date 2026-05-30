-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — return 5 TUMKUR bills (consignment WG000325) to at_branch
-- ─────────────────────────────────────────────────────────────────────────────
-- The cancellation request for WG000325 (TUMKUR → HO, "Due to weight
-- mismatch") was filed in Approvals, but the NIC E-Way Bill cancel call
-- failed — so the standard cancel_consignment flow never released the
-- bills. This sweep manually flips them back to at_branch + clears
-- dispatched_at so they re-appear in Branch Stock and can be acted on
-- (re-consigned cleanly once the dispute is resolved).
--
-- The consignment row + EWB record are NOT touched here — the operator
-- can either retry the NIC cancellation later (now that nothing's at
-- stake at the bill level) or escalate to NIC for a manual cancel.
-- The Approvals cancellation request also stays open until handled
-- separately.
--
-- Bills:
--   WGKA100982 — Latha       (28-May-2026)
--   WGKA100974 — GNANESH      (28-May-2026)
--   WGKA101048 — GIRISH KUMAR (29-May-2026)
--   WGKA101062 — PRAMEELA     (29-May-2026)
--   WGKA101369 — HEMALATHA    (30-May-2026)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — confirm we have the right 5 rows ────────────────────────
SELECT application_id, branch_name, customer_name,
       stock_status, dispatched_at, booking_id
  FROM purchases
 WHERE application_id IN (
   'WGKA100982','WGKA100974','WGKA101048','WGKA101062','WGKA101369'
 )
 ORDER BY application_id;

-- ── 2) Apply — flip back to at_branch + clear dispatched_at ─────────────
UPDATE purchases
   SET stock_status  = 'at_branch',
       dispatched_at = NULL
 WHERE application_id IN (
   'WGKA100982','WGKA100974','WGKA101048','WGKA101062','WGKA101369'
 )
   AND stock_status = 'in_consignment';

-- ── 3) Verify — all 5 should now read at_branch with dispatched_at NULL ─
SELECT application_id, stock_status, dispatched_at
  FROM purchases
 WHERE application_id IN (
   'WGKA100982','WGKA100974','WGKA101048','WGKA101062','WGKA101369'
 )
 ORDER BY application_id;

COMMIT;
