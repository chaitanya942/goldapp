-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — release bills from Augmont booking #1 → re-attach to booking #2
-- ─────────────────────────────────────────────────────────────────────────────
-- Context (03-Jun-2026 bidding day, Bangalore + outstation pool):
--   Booking #1 (Augmont 1500g):
--     - status: partial dispatch
--     - attached: ~2509.41g (over-sourced — only 1500g committed)
--     - over-attached by ~1060g (need 1500/1.035 = 1449.28g net to cover)
--   Booking #2 (Augmont 2100g):
--     - status: dispatch pending
--     - attached: ~698.58g
--     - pipeline owed: ~1376.97g
--
-- Correction: detach the over-attached bills from booking #1 and re-attach
-- them to booking #2. Pipeline_remaining_g recalculates from triggers (or
-- can be refreshed inline below).
--
-- This file ships in TWO blocks:
--   1. DIAGNOSTIC (read-only) — lists both bookings + their attached bills.
--      Run this first, pick which application_ids to move.
--   2. MOVE TEMPLATE (commented out) — fill the application_ids array
--      with the ones you picked, uncomment, and run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) DIAGNOSTIC — bookings overview ──────────────────────────────────────
SELECT q.id                                                                                           AS booking_id,
       q.party,
       q.date                                                                                         AS arrival_date,
       q.status,
       q.weight                                                                                       AS committed_g,
       q.gain_rate,
       q.pipeline_remaining_g,
       (SELECT COUNT(*)                            FROM purchases p WHERE p.booking_id = q.id)        AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric,3) FROM purchases p WHERE p.booking_id = q.id)        AS attached_net_g,
       ROUND((q.weight / (1 + COALESCE(q.gain_rate, 0.035)))::numeric, 3)                             AS target_net_g_for_full_cover
  FROM cal_quotas q
 WHERE q.party = 'Augmont'
   AND q.date  = DATE '2026-06-03'
   AND q.status <> 'cancelled'
 ORDER BY q.created_at;

-- ── 1b) DIAGNOSTIC — bills attached to BOOKING #1 (1500g, over-attached) ──
-- Pick application_ids from this list whose net_weight totals ~1060g
-- (the over-attached portion). Smallest-first or oldest-first usually
-- gives the cleanest split.
SELECT p.application_id,
       p.branch_name,
       p.customer_name,
       p.purchase_date,
       p.booked_at,
       p.stock_status,
       ROUND(p.net_weight::numeric, 3)   AS net_g,
       ROUND(p.gross_weight::numeric, 3) AS gross_g
  FROM purchases p
  JOIN cal_quotas q ON q.id = p.booking_id
 WHERE q.party  = 'Augmont'
   AND q.date   = DATE '2026-06-03'
   AND q.weight = 1500
   AND q.status <> 'cancelled'
   AND p.is_deleted = false
 ORDER BY p.net_weight ASC, p.purchase_date ASC;

-- ── 1c) DIAGNOSTIC — bills attached to BOOKING #2 (2100g, under-sourced) ──
SELECT p.application_id,
       p.branch_name,
       p.customer_name,
       p.purchase_date,
       p.booked_at,
       p.stock_status,
       ROUND(p.net_weight::numeric, 3) AS net_g
  FROM purchases p
  JOIN cal_quotas q ON q.id = p.booking_id
 WHERE q.party  = 'Augmont'
   AND q.date   = DATE '2026-06-03'
   AND q.weight = 2100
   AND q.status <> 'cancelled'
   AND p.is_deleted = false
 ORDER BY p.net_weight ASC, p.purchase_date ASC;

-- ─────────────────────────────────────────────────────────────────────────────
-- ── 2) MOVE TEMPLATE — RUN AFTER PICKING APPLICATION_IDS ───────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- Steps:
--   a. Replace the BOOKING_2_ID below with the actual booking #2 UUID from
--      the diagnostic (the 2100g row's id).
--   b. Replace the application_id list with the ones you picked from
--      block 1b.
--   c. Uncomment the BEGIN/UPDATE/COMMIT block and run.
--
-- The UPDATE only touches purchases.booking_id (and booked_at to mark the
-- re-attachment time). cal_quotas's pipeline_remaining_g recalculates via
-- the auto-attacher pipeline on next run, OR the frontend's net-from-attached
-- math just reads the new totals. No cal_quotas row is mutated here.

/*
BEGIN;

-- Preview the rows about to move.
SELECT p.application_id, p.booking_id, ROUND(p.net_weight::numeric, 3) AS net_g
  FROM purchases p
 WHERE p.application_id IN (
   'WGKA....',  -- paste IDs here, one per line
   'WGKA....'
 );

UPDATE purchases
   SET booking_id = 'PASTE-BOOKING-2-UUID-HERE'::uuid,
       booked_at  = NOW()
 WHERE application_id IN (
   'WGKA....',
   'WGKA....'
 )
   AND booking_id IS NOT NULL          -- only move currently-booked bills
   AND is_deleted = false;

-- Verify — both bookings' new attached totals.
SELECT q.weight AS committed_g,
       (SELECT COUNT(*)                            FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric,3) FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g
  FROM cal_quotas q
 WHERE q.party = 'Augmont'
   AND q.date  = DATE '2026-06-03'
   AND q.status <> 'cancelled'
 ORDER BY q.weight;

COMMIT;
*/
