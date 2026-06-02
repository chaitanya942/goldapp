-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — unbook 4 Section-4 bills picked on 2026-06-01 where the
-- consignment was never created.
-- ─────────────────────────────────────────────────────────────────────────────
-- Context:
--   Section 4 on Bidding Volume surfaces stock that's currently at_branch
--   with the expectation that the consignment will fire later that day —
--   so ops books against it for arrival the same evening. If the
--   consignment never goes out, the booking should be cancelled so the
--   stock returns to the next day's pickable pool.
--
--   On 2026-06-01 four bills below were booked off Section 4 but the
--   consignment never fired. There's no "stale booking" notification
--   yet (separate ask), so ops missed them. This sweep just unbooks
--   the four bills so they're back on the pool today.
--
-- Mirrors sql/one-off-unbook-outstation-at-branch-bills.sql — sets
-- purchases.booking_id = NULL and purchases.booked_at = NULL. The
-- cal_quotas rows the bills were attached to stay alive; their
-- pipeline_remaining_g reflects the released weight automatically.
--
-- Wrapped in BEGIN/COMMIT. Run the preview blocks first; flip COMMIT
-- to ROLLBACK if anything looks off.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — the 4 bills we're about to unbook ─────────────────────────
SELECT p.application_id,
       p.branch_name,
       br.region,
       p.stock_status,
       p.booking_id,
       p.booked_at,
       ROUND(p.net_weight::numeric, 3)   AS net_wt_g,
       ROUND(p.gross_weight::numeric, 3) AS gross_wt_g
  FROM purchases p
  LEFT JOIN branches br ON br.name = p.branch_name
 WHERE p.application_id IN (
   'WGKA101742',
   'WGKA101720',
   'WGKA101649',
   'WGKA101472'
 )
 ORDER BY p.application_id;

-- ── 2) Affected booking(s) — which cal_quotas rows lose attached weight ───
SELECT q.id, q.party, q.date AS arrival_date, q.status,
       q.weight                              AS committed_g,
       COUNT(p.id)                           AS bills_about_to_release,
       ROUND(SUM(p.net_weight)::numeric, 3)  AS releasing_net_wt_g
  FROM cal_quotas q
  JOIN purchases  p ON p.booking_id = q.id
 WHERE p.application_id IN (
   'WGKA101742',
   'WGKA101720',
   'WGKA101649',
   'WGKA101472'
 )
 GROUP BY q.id, q.party, q.date, q.status, q.weight
 ORDER BY releasing_net_wt_g DESC;

-- ── 3) Apply — unbook the four bills ──────────────────────────────────────
UPDATE purchases
   SET booking_id = NULL,
       booked_at  = NULL
 WHERE application_id IN (
   'WGKA101742',
   'WGKA101720',
   'WGKA101649',
   'WGKA101472'
 )
   AND booking_id IS NOT NULL;

-- ── 4) Verify — should return 0 ───────────────────────────────────────────
SELECT COUNT(*) AS still_booked
  FROM purchases
 WHERE application_id IN (
   'WGKA101742',
   'WGKA101720',
   'WGKA101649',
   'WGKA101472'
 )
   AND booking_id IS NOT NULL;
-- Expected: 0

COMMIT;
