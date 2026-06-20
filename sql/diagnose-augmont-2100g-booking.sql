-- Diagnostic — find the Augmont 2100g booking the bidding UI shows but the
-- previous query didn't surface.

-- 1) ALL Augmont bookings, any date, any status — see if 2100g lives elsewhere.
SELECT id, weight, party, date, status, created_at, pipeline_remaining_g, is_kl,
       (SELECT COUNT(*)                            FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric,3) FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g
  FROM cal_quotas q
 WHERE q.party = 'Augmont'
 ORDER BY q.created_at DESC
 LIMIT 30;

-- 2) Any booking with weight=2100 (any party) on 03 Jun.
SELECT id, weight, party, date, status, is_kl, created_at,
       (SELECT COUNT(*) FROM purchases p WHERE p.booking_id = q.id) AS attached_bills
  FROM cal_quotas q
 WHERE q.weight = 2100
   AND q.date  = DATE '2026-06-03'
 ORDER BY q.created_at DESC;

-- 3) Backwards from the bill list — what booking_id is sitting on bills from
--    the source branches the screenshot mentioned (HASSAN, MANDYA, MYSURU)?
SELECT q.id, q.weight, q.party, q.date, q.status, q.is_kl,
       COUNT(*) AS bills_from_those_sources
  FROM purchases p
  JOIN cal_quotas q ON q.id = p.booking_id
 WHERE p.branch_name IN ('HASSAN', 'MANDYA', 'MYSURU')
   AND p.is_deleted = false
   AND q.status <> 'cancelled'
   AND p.booked_at >= '2026-06-03'::timestamptz
   AND p.booked_at <  '2026-06-04'::timestamptz
 GROUP BY q.id, q.weight, q.party, q.date, q.status, q.is_kl
 ORDER BY bills_from_those_sources DESC
 LIMIT 20;

-- 4) Cancelled bookings on 03 Jun — was the 2100g cancelled since the screenshot?
SELECT id, weight, party, date, status, is_kl, created_at,
       (SELECT COUNT(*) FROM purchases p WHERE p.booking_id = q.id) AS attached_bills
  FROM cal_quotas q
 WHERE q.date = DATE '2026-06-03'
   AND q.status = 'cancelled'
 ORDER BY q.created_at DESC;
