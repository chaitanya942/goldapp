-- ─────────────────────────────────────────────────────────────────────────────
-- Pull application_ids attached to the BOOKINGS PLACED on 15-Jun-2026 and
-- 16-Jun-2026 (bidding-day basis — the same pivot the Bookings tab uses).
--
-- A "booking" is a cal_quotas row; its bidding day = created_at (IST). This
-- pulls every bill currently attached (purchases.booking_id) to those bookings.
-- Active bookings only (cancelled excluded, matching "Hide cancelled").
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A) The list — one row per attached bill ─────────────────────────────────
SELECT
  (q.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date           AS booking_day,
  p.application_id,
  p.crm_source,
  p.branch_name,
  ROUND(p.gross_weight::numeric, 2)                                             AS gross_wt_g,
  ROUND(p.net_weight::numeric, 2)                                               AS net_wt_g,
  p.stock_status,
  p.booking_id,
  q.party                                                                        AS booking_party,
  ROUND(q.weight::numeric, 2)                                                    AS booking_target_g,
  to_char(q.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS booking_placed_ist
FROM cal_quotas q
JOIN purchases  p ON p.booking_id = q.id
WHERE (q.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date IN ('2026-06-15', '2026-06-16')
  AND q.status <> 'cancelled'
  AND p.is_deleted = false
ORDER BY booking_day, p.booking_id, p.application_id;

-- ── B) Summary — bills + gross + net per booking day ─────────────────────────
SELECT
  (q.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS booking_day,
  COUNT(DISTINCT q.id)                                                AS bookings,
  COUNT(*)                                                            AS bills,
  ROUND(SUM(p.gross_weight)::numeric, 2)                             AS gross_wt_g,
  ROUND(SUM(p.net_weight)::numeric, 2)                               AS net_wt_g
FROM cal_quotas q
JOIN purchases  p ON p.booking_id = q.id
WHERE (q.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date IN ('2026-06-15', '2026-06-16')
  AND q.status <> 'cancelled'
  AND p.is_deleted = false
GROUP BY booking_day
ORDER BY booking_day;
