-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — revert today's KL leaf→hub consignments that were auto-received
-- at creation by the old create_consignment_atomic behaviour.
-- ─────────────────────────────────────────────────────────────────────────────
-- create_consignment_atomic unconditionally sets status='received' +
-- received_at=NOW() for every INTERNAL consignment. That's correct for the
-- Bangalore hub-create flow (TE walks bills across the same building, instant
-- transfer), but wrong for KL where the BVC truck physically moves goods
-- from a leaf to a hub — there's real transit time.
--
-- The KL Bidding Volume "Section 2 — In Movement · Leaf → Hub" filters
-- consignments NOT IN ('cancelled','received','seed','completed'), so today's
-- leaf→hub consignments disappeared from S2 even though the bills hadn't
-- physically arrived yet.
--
-- The route-level fix landed in this commit will set status='dispatched' on
-- new KL INTERNAL consignments. This sweep cleans up the rows already
-- created today under the old behaviour.
--
-- Scope: INTERNAL, source branch in Kerala, created today (IST), still
-- visible as 'received' with received_at within a couple of seconds of
-- created_at (the tell-tale of the auto-receive). The proximity check
-- protects manually-received rows from being reverted.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — which consignments are about to flip ────────────────────
SELECT c.id, c.tmp_prf_no, c.consignment_no AS challan_no,
       c.branch_name        AS source_branch,
       c.dest_branch        AS dest_hub,
       c.status, c.created_at, c.received_at,
       ROUND(EXTRACT(EPOCH FROM (c.received_at - c.created_at))::numeric, 3) AS auto_receive_delta_seconds
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE c.movement_type   = 'INTERNAL'
   AND b.region          = 'Kerala'
   AND c.status          = 'received'
   AND c.created_at     >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
   AND c.received_at IS NOT NULL
   AND EXTRACT(EPOCH FROM (c.received_at - c.created_at)) < 5
 ORDER BY c.created_at;

-- ── 2) Apply — flip status back to dispatched + null received_at ─────────
UPDATE consignments c
   SET status      = 'dispatched',
       received_at = NULL
  FROM branches b
 WHERE b.name = c.branch_name
   AND c.movement_type   = 'INTERNAL'
   AND b.region          = 'Kerala'
   AND c.status          = 'received'
   AND c.created_at     >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
   AND c.received_at IS NOT NULL
   AND EXTRACT(EPOCH FROM (c.received_at - c.created_at)) < 5;

-- ── 3) Verify — should now show as dispatched, received_at NULL ──────────
SELECT c.id, c.tmp_prf_no, c.branch_name AS source, c.dest_branch AS dest,
       c.status, c.received_at
  FROM consignments c
  JOIN branches      b ON b.name = c.branch_name
 WHERE c.movement_type = 'INTERNAL'
   AND b.region        = 'Kerala'
   AND c.created_at   >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
 ORDER BY c.created_at;

COMMIT;
