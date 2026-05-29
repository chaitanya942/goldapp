-- ─────────────────────────────────────────────────────────────────────────────
-- One-off backfill — full sweep, all stock statuses
-- Bangalore bills with purchase_date ≤ 2026-05-29
-- ─────────────────────────────────────────────────────────────────────────────
-- The first backfill (sql/one-off-backfill-bangalore-gain-attribution.sql)
-- only touched at_branch bills. This second sweep extends it to every
-- pre-30-May-2026 Bangalore bill that's still unbooked and unconsumed —
-- in_consignment and at_ho rows too. Today (30 May 2026) hasn't started
-- yet, so this gives the system a clean baseline before today's first bills.
--
-- Targets:
--   - At a Bangalore branch (branches.region = 'Bangalore', is_active=true)
--   - purchase_date ≤ '2026-05-29'  (cutoff: end of yesterday IST)
--   - Never booked              (booking_id IS NULL)
--   - Not already audit-consumed (audit_consumed_at IS NULL — first
--                                 backfill's at_branch rows naturally
--                                 excluded by this clause)
--   - Not deleted               (is_deleted = false)
--   - ANY stock_status          (at_branch + in_consignment + at_ho)
--
-- audit_attributed_to = 'gain_backfill' (same label as the first sweep so
-- both belong to the same historical bucket).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — what we'd touch, sliced by stock_status ───────────────────
SELECT stock_status,
       COUNT(*)                              AS bills,
       ROUND(SUM(net_weight)::numeric, 3)    AS net_wt_g
  FROM purchases p
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.purchase_date    <= DATE '2026-05-29'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY stock_status
 ORDER BY bills DESC;

-- Per-branch breakdown across all statuses — spot anomalies before committing.
SELECT p.branch_name,
       COUNT(*)                            AS bills,
       ROUND(SUM(p.net_weight)::numeric, 3) AS net_wt_g
  FROM purchases p
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.purchase_date    <= DATE '2026-05-29'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   )
 GROUP BY p.branch_name
 ORDER BY bills DESC;

-- ── 2) Apply the sweep ─────────────────────────────────────────────────────
UPDATE purchases
   SET audit_consumed_at   = NOW(),
       audit_attributed_to = 'gain_backfill'
 WHERE is_deleted        = false
   AND booking_id        IS NULL
   AND audit_consumed_at IS NULL
   AND purchase_date    <= DATE '2026-05-29'
   AND branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );

-- ── 3) Verify — should be zero across the board ────────────────────────────
SELECT COUNT(*) AS bangalore_pre_30may_unaudited_remaining
  FROM purchases p
 WHERE p.is_deleted        = false
   AND p.booking_id        IS NULL
   AND p.audit_consumed_at IS NULL
   AND p.purchase_date    <= DATE '2026-05-29'
   AND p.branch_name IN (
     SELECT name FROM branches WHERE region = 'Bangalore' AND is_active = true
   );
-- Expected: 0

-- ── 4) Refresh today's audit log row with the cumulative totals ────────────
-- The earlier backfill already inserted a CURRENT_DATE row labelled
-- source='one_off_backfill'. Update it in place so the daily log reflects
-- the full sweep (both phases combined).
UPDATE bidding_audit_log
   SET attributed_count  = (
         SELECT COUNT(*)
           FROM purchases
          WHERE audit_attributed_to = 'gain_backfill'
       ),
       attributed_net_wt = (
         SELECT ROUND(COALESCE(SUM(net_weight), 0)::numeric, 3)
           FROM purchases
          WHERE audit_attributed_to = 'gain_backfill'
       ),
       details = details || jsonb_build_object(
         'scope_phase2',     'full_sweep_pre_30may_2026',
         'phase2_ran_at',    NOW()
       )
 WHERE audit_date = CURRENT_DATE
   AND details->>'source' = 'one_off_backfill';

-- If for some reason the phase-1 row doesn't exist, insert a fresh one.
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
  jsonb_build_object('source', 'one_off_backfill', 'scope', 'full_sweep_pre_30may_2026')
  FROM purchases
 WHERE audit_attributed_to = 'gain_backfill'
ON CONFLICT (audit_date) DO NOTHING;

COMMIT;
