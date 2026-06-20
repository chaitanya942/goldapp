-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — release over-attached bills from Augmont 04-Jun-2026 bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- The previous rebalance left both bookings slightly over (auto-attacher
-- added bills after my SQL read the state). This pass:
--   - Calculates the over-attachment per booking AT RUN TIME (so it
--     can't drift between SQL-generation and execution).
--   - Picks smallest-first bills to unbook back to the pool until each
--     booking lands at-or-below its effective target.
--   - Touches both bookings in one pass.
--
-- Releases set booking_id = NULL and booked_at = NULL. Bills return to
-- the unbooked pool. The auto-attacher will pick them up again only if
-- some OTHER booking has a real pipeline gap.
--
-- Wrapped in BEGIN/COMMIT. Preview block first.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — what's currently over-attached, per booking ─────────────
WITH bookings AS (
  SELECT q.id, q.weight, q.gain_rate,
         (SELECT COALESCE(SUM(p.net_weight), 0) FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted = false) AS attached_net
    FROM cal_quotas q
   WHERE q.id IN (
     '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid,
     '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
   )
)
SELECT id,
       weight AS committed_g,
       attached_net,
       ROUND((attached_net * (1 + gain_rate))::numeric, 3)                                        AS attached_effective_g,
       GREATEST(0, ROUND(((attached_net * (1 + gain_rate) - weight) / (1 + gain_rate))::numeric, 3)) AS net_over_to_release
  FROM bookings;
-- Expected:
--   1500g: net_over_to_release ≈ 5g
--   2100g: net_over_to_release ≈ 146g

-- ── 2) Apply — unbook smallest bills until each booking lands at target ──
WITH bookings AS (
  SELECT q.id AS booking_id, q.weight, q.gain_rate,
         (SELECT COALESCE(SUM(p.net_weight), 0) FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted = false) AS attached_net
    FROM cal_quotas q
   WHERE q.id IN (
     '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid,
     '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
   )
),
targets AS (
  SELECT booking_id,
         GREATEST(0, (attached_net * (1 + gain_rate) - weight) / (1 + gain_rate)) AS net_to_release
    FROM bookings
),
ranked AS (
  SELECT p.id, p.booking_id, p.net_weight,
         SUM(p.net_weight) OVER (PARTITION BY p.booking_id ORDER BY p.net_weight ASC, p.id) - p.net_weight AS cumulative_before
    FROM purchases p
   WHERE p.booking_id IN (SELECT booking_id FROM targets)
     AND p.is_deleted = false
)
UPDATE purchases p
   SET booking_id = NULL,
       booked_at  = NULL
  FROM ranked r, targets t
 WHERE p.id = r.id
   AND r.booking_id = t.booking_id
   AND r.cumulative_before < t.net_to_release
   AND t.net_to_release > 0;

-- ── 3) Verify — both bookings should now be exactly at-or-just-below target
SELECT q.id,
       q.weight                                                                                        AS committed_g,
       (SELECT COUNT(*)                                                                                FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric, 3)                                                    FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g,
       ROUND(((SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS attached_effective_g,
       ROUND(GREATEST(0, q.weight - (SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS pipeline_remaining_should_be
  FROM cal_quotas q
 WHERE q.id IN (
   '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid,
   '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
 )
 ORDER BY q.weight;
-- Expected:
--   1500g: attached_effective_g ≈ 1500, pipeline ≈ 0
--   2100g: attached_effective_g ≈ 2100, pipeline ≈ 0
-- (May land a few grams over because the picker includes the bill that
-- crosses the threshold; that's intentional — better fully-sourced than
-- slightly under-attached.)

COMMIT;
