-- Diagnostic — find KL hub-stock bills (Section 1 in the KL pool) and the
-- active booking with pipeline owed, so we can write a clean attach SQL.

-- 1) Identify KL hub branches (the ones bills physically sit at before HO).
SELECT name, region, is_hub, hub_branch_name, is_active, model_type
  FROM branches
 WHERE region IN ('Kerala', 'KL')
 ORDER BY is_hub DESC, name;

-- 2) Unbooked at_branch bills currently sitting at any KL hub (or at any
--    KL branch — both candidates surfaced so we can verify which slice the
--    UI's Section 1 actually counts).
SELECT p.application_id,
       p.branch_name           AS leaf_branch,
       p.current_branch,
       p.stock_status,
       p.crm_status,
       p.booking_id,
       p.purchase_date,
       ROUND(p.net_weight::numeric, 3)   AS net_g,
       ROUND(p.gross_weight::numeric, 3) AS gross_g
  FROM purchases p
  JOIN branches br ON br.name = COALESCE(p.current_branch, p.branch_name)
 WHERE br.region IN ('Kerala', 'KL')
   AND p.is_deleted = false
   AND p.crm_status = 'approved'
   AND p.booking_id IS NULL
   AND p.stock_status = 'at_branch'
 ORDER BY net_g DESC;

-- 3) Active KL bookings with pipeline_remaining_g > 0.
SELECT q.id, q.party, q.date, q.weight, q.gain_rate,
       q.pending_g, q.pipeline_remaining_g, q.is_kl,
       q.status, q.created_at,
       (SELECT COUNT(*)                            FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric,3) FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g
  FROM cal_quotas q
 WHERE q.is_kl = true
   AND q.status NOT IN ('cancelled', 'fulfilled')
   AND q.pipeline_remaining_g > 0
 ORDER BY q.created_at DESC;
