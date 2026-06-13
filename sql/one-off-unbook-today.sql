-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: UNBOOK today's bookings — clean slate to re-test the bidding flow.
--
-- Scope = every booking CREATED today (IST). For each:
--   • detach all its bills  → booking_id = NULL, booked_at = NULL (back to the
--                              biddable pool)
--   • cancel the booking    → status = 'cancelled', pipeline zeroed (so the
--                              auto-attacher won't re-grab on the next sync)
--
-- Bookings created on earlier days (and their bills) are left untouched.
--
-- IST "today" midnight as a timestamptz:
--   date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW (run these two on their own first) ──────────────────────

-- Bookings that will be cancelled:
SELECT id, party, status, weight, pipeline_region, pipeline_remaining_g, created_at
  FROM cal_quotas
 WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
   AND status <> 'cancelled'
 ORDER BY created_at;

-- Bills that will be detached (count + weight per booking):
SELECT q.id AS booking_id, q.party, q.weight,
       count(p.id)                          AS bills_to_detach,
       round(sum(p.net_weight)::numeric, 2) AS net_to_detach
  FROM cal_quotas q
  JOIN purchases  p ON p.booking_id = q.id
 WHERE q.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
   AND q.status <> 'cancelled'
 GROUP BY q.id, q.party, q.weight
 ORDER BY q.created_at;

-- ── STEP 2 · APPLY (run as one transaction once the preview looks right) ─────

BEGIN;

-- a) Detach every bill attached to a booking created today → back to unbooked.
UPDATE purchases p
   SET booking_id = NULL, booked_at = NULL
 WHERE p.booking_id IN (
   SELECT id FROM cal_quotas
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
 );

-- b) Cancel those bookings + zero their pipeline so the attacher skips them.
UPDATE cal_quotas
   SET status = 'cancelled',
       pipeline_remaining_g = 0
 WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
   AND status <> 'cancelled';

COMMIT;

-- ── STEP 3 · VERIFY ──────────────────────────────────────────────────────────
-- Today's Bangalore pool should now be (almost) all unbooked again:
--   SELECT (booking_id IS NOT NULL) AS booked, count(*), round(sum(net_weight)::numeric,2)
--     FROM purchases p JOIN branches b ON b.name = p.branch_name
--    WHERE b.region = 'Bangalore' AND p.purchase_date = '2026-06-13' AND p.is_deleted = false
--    GROUP BY 1;
