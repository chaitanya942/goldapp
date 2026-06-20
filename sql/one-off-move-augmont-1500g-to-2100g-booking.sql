-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — move ~1060g (net) from Augmont 1500g booking → Augmont 2100g
-- (both arrival 2026-06-04)
-- ─────────────────────────────────────────────────────────────────────────────
-- Ops error: 1500g booking on 04-Jun arrival has 2509.41g attached
-- (1097.24g effective over its 1500g commitment). 2100g booking on the
-- same arrival date owes 1136.79g pipeline. Move the excess from the
-- 1500g to the 2100g, both Augmont, same arrival.
--
-- Booking IDs (confirmed in diagnose-augmont-2100g-booking.sql):
--   Source     : 6da7d11f-0b0f-495f-aba8-74acace4e106  (1500g, 89 bills, 2509.41g net)
--   Destination: 7883f6eb-9eaf-419f-b9c2-1c59e394c5ff  (2100g, 25 bills, 941.12g net)
--
-- Math:
--   1500g effective need = 1500 / 1.035 = 1449.28g net
--   Current net attached = 2509.41g
--   Net to release       = 2509.41 − 1449.28 = 1060.13g
--
-- Picker logic: largest bills first from the 1500g booking until the
-- cumulative net just covers 1060.13g (the bill that crosses the
-- threshold is included so the move slightly over-releases). cal_quotas
-- rows themselves don't change — only purchases.booking_id + booked_at
-- flip. Pipeline numbers recompute from the new totals automatically.
--
-- Wrapped in BEGIN/COMMIT. Preview block first; flip COMMIT → ROLLBACK
-- if the picker output looks wrong.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — which bills the picker will move ──────────────────────────
WITH ranked AS (
  SELECT p.id, p.application_id, p.branch_name, p.customer_name, p.stock_status,
         ROUND(p.net_weight::numeric, 3) AS net_g,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight DESC, p.id) AS running_net
    FROM purchases p
   WHERE p.booking_id = '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid
     AND p.is_deleted = false
)
SELECT application_id, branch_name, customer_name, stock_status,
       net_g,
       ROUND(running_net::numeric, 3) AS running_net_g
  FROM ranked
 WHERE (running_net - net_g) < 1060.13   -- include the bill that crosses the target
 ORDER BY net_g DESC;

-- ── 2) Apply — flip booking_id + stamp booked_at ──────────────────────────
WITH ranked AS (
  SELECT p.id, p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight DESC, p.id) AS running_net
    FROM purchases p
   WHERE p.booking_id = '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid
     AND p.is_deleted = false
),
to_move AS (
  SELECT id FROM ranked WHERE (running_net - net_weight) < 1060.13
)
UPDATE purchases p
   SET booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid,
       booked_at  = NOW()
  FROM to_move
 WHERE p.id = to_move.id;

-- ── 3) Verify — both bookings' new attached totals ────────────────────────
SELECT q.id,
       q.weight                                                                                        AS committed_g,
       q.gain_rate,
       (SELECT COUNT(*)                                                                                FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric, 3)                                                    FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g,
       ROUND(((SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS attached_effective_g,
       ROUND(GREATEST(0, q.weight - (SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS pipeline_remaining_should_be
  FROM cal_quotas q
 WHERE q.id IN (
   '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid,   -- 1500g source
   '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid    -- 2100g destination
 )
 ORDER BY q.weight;
-- Expected after move:
--   1500g row: attached_net_g ≈ 1449, attached_effective_g ≈ 1500, pipeline ≈ 0
--   2100g row: attached_net_g ≈ 2001, attached_effective_g ≈ 2071, pipeline ≈ 30

COMMIT;
