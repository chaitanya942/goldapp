-- ── One-time backfill: rescue stock_status across historical CRM ──────────────
--    delete-and-recreate events
--
-- The sync now carries stock_status forward automatically for FUTURE
-- delete-recreates (see app/api/sync-purchases/route.js, "Carry-forward"
-- block). This script does the same for rows already orphaned BEFORE that
-- shipped: a row that ops had moved (in_consignment / at_ho), then CRM
-- deleted + recreated as a new txn_id, leaving the work stranded on a now-
-- deleted row while the fresh row sits at the at_branch default.
--
-- Safety: only UNAMBIGUOUS 1:1 pairs are touched —
--   • the lost row had real ops state (stock_status <> 'at_branch')
--   • it has all strong match keys (no NULLs — NULL-heavy fuzzy matching is
--     exactly what caused the original 25-bill over-merge; do NOT relax)
--   • exactly one fresh at_branch lookalike (same customer + branch +
--     purchase_date + net_weight ±0.001 g, different application_id)
--   • that lookalike is claimed by exactly one lost row
-- Anything ambiguous is left for manual review (PREVIEW #2 lists it).
--
-- Run order (the standard PREVIEW → UPDATE → VERIFY ritual):
--   1. PREVIEW #1 — eyeball exactly what will change.
--   2. PREVIEW #2 — see what's being skipped as ambiguous (manual review).
--   3. UPDATE.
--   4. VERIFY.
-- Idempotent: re-running finds nothing (carried rows are no longer
-- at_branch, so they stop matching).

-- Shared CTE chain (paste the WITH block before each query below, or run as
-- one script section at a time).

-- ===== PREVIEW #1 — the safe 1:1 pairs that WILL be carried forward =====
WITH lost AS (
  SELECT id, application_id, stock_status, booking_id,
         customer_name, branch_name, purchase_date, net_weight
  FROM purchases
  WHERE crm_source   = 'old_crm'
    AND crm_status   = 'deleted'
    AND stock_status IS NOT NULL
    AND stock_status <> 'at_branch'
    AND customer_name IS NOT NULL
    AND branch_name   IS NOT NULL
    AND purchase_date IS NOT NULL
    AND net_weight    IS NOT NULL
),
pair AS (
  SELECT
    l.id  AS lost_id,  l.application_id AS lost_app,
    l.stock_status AS carry_status, l.booking_id AS carry_booking,
    l.net_weight AS lost_wt, l.customer_name, l.branch_name, l.purchase_date,
    p.id  AS new_id,   p.application_id AS new_app
  FROM lost l
  JOIN purchases p
    ON  p.crm_source    = 'old_crm'
    AND p.crm_status    = 'approved'
    AND p.stock_status  = 'at_branch'
    AND p.customer_name = l.customer_name
    AND p.branch_name   = l.branch_name
    AND p.purchase_date = l.purchase_date
    AND abs(p.net_weight - l.net_weight) < 0.001
    AND p.application_id <> l.application_id
),
counts AS (
  SELECT *,
    COUNT(*) OVER (PARTITION BY lost_id) AS per_lost,
    COUNT(*) OVER (PARTITION BY new_id)  AS per_new
  FROM pair
)
SELECT lost_app, new_app, carry_status, carry_booking,
       customer_name, branch_name, purchase_date, lost_wt
FROM counts
WHERE per_lost = 1 AND per_new = 1
ORDER BY purchase_date, new_app;

-- ===== PREVIEW #2 — ambiguous, will be SKIPPED (manual review) =====
WITH lost AS (
  SELECT id, application_id, stock_status, booking_id,
         customer_name, branch_name, purchase_date, net_weight
  FROM purchases
  WHERE crm_source   = 'old_crm'
    AND crm_status   = 'deleted'
    AND stock_status IS NOT NULL
    AND stock_status <> 'at_branch'
    AND customer_name IS NOT NULL
    AND branch_name   IS NOT NULL
    AND purchase_date IS NOT NULL
    AND net_weight    IS NOT NULL
),
pair AS (
  SELECT
    l.id AS lost_id, l.application_id AS lost_app,
    l.customer_name, l.branch_name, l.purchase_date,
    p.id AS new_id, p.application_id AS new_app
  FROM lost l
  JOIN purchases p
    ON  p.crm_source    = 'old_crm'
    AND p.crm_status    = 'approved'
    AND p.stock_status  = 'at_branch'
    AND p.customer_name = l.customer_name
    AND p.branch_name   = l.branch_name
    AND p.purchase_date = l.purchase_date
    AND abs(p.net_weight - l.net_weight) < 0.001
    AND p.application_id <> l.application_id
),
counts AS (
  SELECT *,
    COUNT(*) OVER (PARTITION BY lost_id) AS per_lost,
    COUNT(*) OVER (PARTITION BY new_id)  AS per_new
  FROM pair
)
SELECT lost_app, new_app, per_lost, per_new,
       customer_name, branch_name, purchase_date
FROM counts
WHERE per_lost > 1 OR per_new > 1
ORDER BY purchase_date, lost_app;

-- ===== UPDATE — carry stock_status (and booking_id) onto the fresh row =====
WITH lost AS (
  SELECT id, application_id, stock_status, booking_id,
         customer_name, branch_name, purchase_date, net_weight
  FROM purchases
  WHERE crm_source   = 'old_crm'
    AND crm_status   = 'deleted'
    AND stock_status IS NOT NULL
    AND stock_status <> 'at_branch'
    AND customer_name IS NOT NULL
    AND branch_name   IS NOT NULL
    AND purchase_date IS NOT NULL
    AND net_weight    IS NOT NULL
),
pair AS (
  SELECT
    l.id AS lost_id, l.stock_status AS carry_status, l.booking_id AS carry_booking,
    p.id AS new_id
  FROM lost l
  JOIN purchases p
    ON  p.crm_source    = 'old_crm'
    AND p.crm_status    = 'approved'
    AND p.stock_status  = 'at_branch'
    AND p.customer_name = l.customer_name
    AND p.branch_name   = l.branch_name
    AND p.purchase_date = l.purchase_date
    AND abs(p.net_weight - l.net_weight) < 0.001
    AND p.application_id <> l.application_id
),
counts AS (
  SELECT *,
    COUNT(*) OVER (PARTITION BY lost_id) AS per_lost,
    COUNT(*) OVER (PARTITION BY new_id)  AS per_new
  FROM pair
),
safe AS (
  SELECT lost_id, new_id, carry_status, carry_booking
  FROM counts WHERE per_lost = 1 AND per_new = 1
)
UPDATE purchases tgt
SET stock_status = s.carry_status,
    booking_id   = COALESCE(s.carry_booking, tgt.booking_id)
FROM safe s
WHERE tgt.id = s.new_id;

-- ===== VERIFY — no safe pairs should remain (all carried) =====
-- Re-run PREVIEW #1; it should return zero rows. Any remaining rows mean
-- a UPDATE/PREVIEW mismatch worth investigating before trusting the result.
