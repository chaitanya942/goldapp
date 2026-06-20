-- Diagnostic — why does Hub Dispatch for BOMMANAHALLI say "no eligible bills"
-- while the panel shows 5 HOSA ROAD + 1 BOMMANAHALLI?
--
-- Hub dispatch eligibility (app/api/consignments/route.js):
--   stock_status='at_branch' AND crm_status='approved' AND is_deleted=false
--   AND booking_id IS NULL AND audit_consumed_at IS NULL
--
-- Branch overview panel filters far less, so a count mismatch usually means
-- one of the eligibility predicates is excluding everything. Most likely
-- culprit on freshly-booked Bangalore stock: booking_id IS NOT NULL from
-- Section 4 bookings made today.

WITH members AS (
  SELECT name FROM branches WHERE name IN ('BOMMANAHALLI', 'HOSA ROAD')
),
candidates AS (
  SELECT p.id, p.application_id, p.branch_name, p.purchase_date,
         p.stock_status, p.crm_status, p.is_deleted,
         p.booking_id, p.booked_at,
         p.audit_consumed_at,
         p.gross_weight
    FROM purchases p
   WHERE p.branch_name IN (SELECT name FROM members)
     AND p.stock_status = 'at_branch'
)
SELECT
  branch_name,
  COUNT(*)                                                       AS total_at_branch,
  COUNT(*) FILTER (WHERE crm_status        != 'approved')        AS not_crm_approved,
  COUNT(*) FILTER (WHERE is_deleted        = true)               AS deleted,
  COUNT(*) FILTER (WHERE booking_id        IS NOT NULL)          AS booked,
  COUNT(*) FILTER (WHERE audit_consumed_at IS NOT NULL)          AS audit_consumed,
  COUNT(*) FILTER (
    WHERE crm_status='approved' AND is_deleted=false
      AND booking_id IS NULL AND audit_consumed_at IS NULL
  )                                                              AS eligible_for_dispatch
FROM candidates
GROUP BY branch_name
ORDER BY branch_name;

-- Per-bill detail so the exact culprits are visible.
SELECT p.branch_name,
       p.application_id,
       p.purchase_date,
       p.crm_status,
       p.is_deleted,
       p.booking_id,
       p.booked_at,
       p.audit_consumed_at,
       ROUND(p.gross_weight::numeric, 3) AS gross_g
  FROM purchases p
 WHERE p.branch_name IN ('BOMMANAHALLI', 'HOSA ROAD')
   AND p.stock_status = 'at_branch'
   AND p.is_deleted   = false
 ORDER BY p.branch_name, p.purchase_date DESC, p.application_id;
