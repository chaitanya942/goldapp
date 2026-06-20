-- ─────────────────────────────────────────────────────────────────────────────
-- One-off backfill — mark all historical unbooked Bangalore bills as
-- audit-consumed (attributed to gain).
-- ─────────────────────────────────────────────────────────────────────────────
-- Brings legacy data in line with the new 23:30 IST EOD audit pipeline
-- introduced by sql/bangalore_section1_audit.sql. Run once; from tomorrow
-- onwards the cron-driven audit handles the daily flow.
--
-- Targets bills that are:
--   - At a Bangalore branch (branches.region = 'Bangalore')
--   - Never booked              (booking_id IS NULL)
--   - Not already audit-consumed (audit_consumed_at IS NULL)
--   - Not deleted               (is_deleted = false)
--   - stock_status = 'at_branch' (default — narrowest, matches the EOD audit)
--
-- Why 'at_branch' only by default: these are stuck-at-branch bills that
-- never moved to HO, so they're the cleanest candidates for "implicit gain".
-- Bills already in_consignment / at_ho are mid-flow or sitting in HO
-- inventory — they shouldn't be retroactively attributed to gain without
-- accounting's say-so.
--
-- If you want to broaden the sweep to include in_consignment / at_ho, see
-- the commented-out OPTIONAL block at the end.
--
-- audit_attributed_to = 'gain_backfill' (not 'gain') so we can tell apart
-- this one-off historical sweep from the daily ongoing audit. Both end up
-- in the gain pool, but the label preserves the audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — how many bills will be touched, what's the weight ─────────
SELECT COUNT(*)                                  AS affected_bills,
       ROUND(SUM(net_weight)::numeric, 3)        AS affected_net_wt_g,
       MIN(purchase_date)                        AS oldest_purchase_date,
       MAX(purchase_date)                        AS newest_purchase_date
  FROM purchases p
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.stock_status      = 'at_branch'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

-- Per-branch breakdown so you can spot anomalies before committing.
SELECT p.branch_name,
       COUNT(*)                            AS bills,
       ROUND(SUM(p.net_weight)::numeric, 3) AS net_wt_g
  FROM purchases p
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.stock_status      = 'at_branch'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY p.branch_name
 ORDER BY bills DESC;

-- ── 2) Apply the backfill ──────────────────────────────────────────────────
UPDATE purchases
   SET audit_consumed_at   = NOW(),
       audit_attributed_to = 'gain_backfill'
 WHERE is_deleted        = false
   AND booking_id        IS NULL
   AND audit_consumed_at IS NULL
   AND stock_status      = 'at_branch'
   AND branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

-- ── 3) Verify — there should be zero unaudited Bangalore at_branch bills ──
SELECT COUNT(*) AS unaudited_bangalore_at_branch_bills_remaining
  FROM purchases p
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.stock_status      = 'at_branch'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );
-- Expected: 0

-- ── 4) Log a synthetic audit row so the daily history shows the backfill ──
-- Optional but recommended — gives bidding_audit_log a single big "Day 0"
-- row so the report doesn't suddenly jump from zero to ongoing values.
-- Comment out if you'd rather keep the log purely cron-generated.
INSERT INTO bidding_audit_log (
  audit_date, ran_at, swept_count, swept_net_wt,
  attributed_count, attributed_net_wt, held_count, held_net_wt, details
)
SELECT
  CURRENT_DATE,
  NOW(),
  0, 0,
  COUNT(*),
  ROUND(COALESCE(SUM(net_weight), 0)::numeric, 3),
  0, 0,
  jsonb_build_object('source', 'one_off_backfill', 'scope', 'at_branch')
  FROM purchases
 WHERE audit_attributed_to = 'gain_backfill'
ON CONFLICT (audit_date) DO UPDATE
  SET attributed_count  = EXCLUDED.attributed_count,
      attributed_net_wt = EXCLUDED.attributed_net_wt,
      details           = bidding_audit_log.details || EXCLUDED.details;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL — Broader sweep (run separately if you want it)
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this only if you also want to attribute in_consignment Bangalore bills
-- (mid-flight, never made it to HO). Skip at_ho — those are real HO inventory
-- that should not be quietly converted to gain.
--
-- BEGIN;
-- UPDATE purchases
--    SET audit_consumed_at   = NOW(),
--        audit_attributed_to = 'gain_backfill'
--  WHERE is_deleted        = false
--    AND booking_id        IS NULL
--    AND audit_consumed_at IS NULL
--    AND stock_status      = 'in_consignment'
--    AND branch_name IN (
--      SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
--    );
-- COMMIT;
