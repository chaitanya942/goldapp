-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — release ~176g (net) of excess from Augmont 2100g booking
-- (7883f6eb-9eaf-419f-b9c2-1c59e394c5ff)
-- ─────────────────────────────────────────────────────────────────────────────
-- Current state per the bidding UI:
--   2100g booking: 2205.35g net → 2282.54g effective → over by 182.54g eff
--                                                       → 176.37g net to release
--
-- Picker: smallest-first cumulative. Picks bills until cumulative is just
-- enough to cover 176.37g; includes the bill that crosses the threshold
-- so the release is at-or-just-above the target (rather than under).
--
-- Releases set booking_id = NULL and booked_at = NULL. Bills return to
-- the unbooked pool. Booking 1 (1500g) is now ✓ settled — leaving alone.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — which bills the picker will unbook ──────────────────────
WITH ranked AS (
  SELECT p.id, p.application_id, p.branch_name, p.customer_name, p.stock_status,
         p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight ASC, p.id) - p.net_weight AS cumulative_before
    FROM purchases p
   WHERE p.booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
     AND p.is_deleted = false
)
SELECT application_id, branch_name, customer_name, stock_status,
       ROUND(net_weight::numeric, 3)        AS net_g,
       ROUND(cumulative_before::numeric, 3) AS cumulative_before_g,
       ROUND((cumulative_before + net_weight)::numeric, 3) AS cumulative_after_g
  FROM ranked
 WHERE cumulative_before < 176.37
 ORDER BY net_weight ASC;
-- Confirm the picked rows sum to ~176g (or slightly more).

-- ── 2) Apply — unbook the picked bills ───────────────────────────────────
WITH ranked AS (
  SELECT p.id, p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight ASC, p.id) - p.net_weight AS cumulative_before
    FROM purchases p
   WHERE p.booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
     AND p.is_deleted = false
),
to_release AS (
  SELECT id FROM ranked WHERE cumulative_before < 176.37
)
UPDATE purchases p
   SET booking_id = NULL,
       booked_at  = NULL
  FROM to_release
 WHERE p.id = to_release.id;

-- ── 3) Verify — booking 2 should now be at-or-just-below target ──────────
SELECT q.id,
       q.weight       AS committed_g,
       (SELECT COUNT(*)                                                                              FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric, 3)                                                  FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g,
       ROUND(((SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS attached_effective_g,
       ROUND(GREATEST(0, q.weight - (SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS pipeline_remaining_should_be
  FROM cal_quotas q
 WHERE q.id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid;
-- Expected: attached_effective_g ≈ 2100, pipeline ≈ 0.

COMMIT;
