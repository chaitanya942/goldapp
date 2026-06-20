-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — rebalance Augmont 04-Jun-2026 bookings after auto-attacher drift
-- ─────────────────────────────────────────────────────────────────────────────
-- After the earlier move, the auto-attacher kept adding bills to the
-- 2100g booking, pushing it 190g over its effective target. Current
-- state:
--   1500g booking (6da7d11f-…): 1407.57g net → 1456.84g eff → 43.17g short
--   2100g booking (7883f6eb-…): 2212.85g net → 2290.30g eff → 190.30g over
--
-- Cleanup (two steps in one txn):
--   Step A : Move ~41.70g (net) of the SMALLEST bills from 2100g booking
--            → 1500g booking. Closes the 43g effective gap on booking 1.
--   Step B : Unbook the NEXT ~142g (net) worth of smallest bills from
--            the 2100g booking. Releases them back to the pool.
--   Total detached from 2100g: ~184g (the over-attached portion).
--
-- End state target:
--   1500g: ~1449g net → 1500g effective → pipeline 0
--   2100g: ~2029g net → 2100g effective → pipeline 0
--   Pool : ~142g net of bills returned for next-round bookings
--
-- "Smallest first" so the move keeps high-weight bills in the destination
-- (less churn in the bill-to-booking mapping for the larger, more
-- meaningful weights).
--
-- Wrapped in BEGIN/COMMIT. Run the preview first; flip COMMIT → ROLLBACK
-- if the picker classification looks wrong.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — every bill on the 2100g booking, classified by action ───
WITH ranked AS (
  SELECT p.id,
         p.application_id,
         p.branch_name,
         p.customer_name,
         p.stock_status,
         p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight ASC, p.id) AS running_net
    FROM purchases p
   WHERE p.booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
     AND p.is_deleted = false
),
picks AS (
  SELECT *,
         CASE
           WHEN (running_net - net_weight) < 41.70                THEN 'MOVE_TO_1500g'
           WHEN (running_net - net_weight) < (41.70 + 142.16)     THEN 'UNBOOK'
           ELSE                                                        NULL
         END AS action
    FROM ranked
)
SELECT application_id, branch_name, customer_name, stock_status,
       ROUND(net_weight::numeric, 3)  AS net_g,
       ROUND(running_net::numeric, 3) AS running_net_g,
       action
  FROM picks
 WHERE action IS NOT NULL
 ORDER BY net_weight ASC;
-- Expect ~5–10 MOVE_TO_1500g rows summing to ~42g, then ~20–30 UNBOOK
-- rows summing to ~142g. The rest of the 2100g booking's bills (the
-- larger ones) stay attached.

-- ── 2a) Apply — move the MOVE_TO_1500g batch to the 1500g booking ────────
WITH ranked AS (
  SELECT p.id, p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight ASC, p.id) AS running_net
    FROM purchases p
   WHERE p.booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
     AND p.is_deleted = false
),
to_move AS (
  SELECT id FROM ranked WHERE (running_net - net_weight) < 41.70
)
UPDATE purchases p
   SET booking_id = '6da7d11f-0b0f-495f-aba8-74acace4e106'::uuid,
       booked_at  = NOW()
  FROM to_move
 WHERE p.id = to_move.id;

-- ── 2b) Apply — unbook the UNBOOK batch back to the pool ─────────────────
-- Re-run the picker on what's LEFT in the 2100g booking after step 2a.
WITH ranked AS (
  SELECT p.id, p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight ASC, p.id) AS running_net
    FROM purchases p
   WHERE p.booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
     AND p.is_deleted = false
),
to_unbook AS (
  SELECT id FROM ranked WHERE (running_net - net_weight) < 142.16
)
UPDATE purchases p
   SET booking_id = NULL,
       booked_at  = NULL
  FROM to_unbook
 WHERE p.id = to_unbook.id;

-- ── 3) Verify — both bookings should now be exactly at target ────────────
SELECT q.id,
       q.weight                                                                                        AS committed_g,
       q.gain_rate,
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
-- Expected: both pipelines ≈ 0, both effective ≈ committed weight.

COMMIT;
