-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — release outstation at_branch bills that are stuck on a booking
-- ─────────────────────────────────────────────────────────────────────────────
-- Symptom (caught on the Telangana cards): bills visible in Branch Stock
-- but missing from Section 4 on Bidding Volume. Section 4 filters
-- booking_id IS NULL, so a bill that's still at_branch AND attached to a
-- booking quietly drops off the picker even though the consignment for
-- it never went out.
--
-- This sweep releases every outstation (non-Bangalore) bill that is:
--   - still at_branch (the consignment never fired)
--   - currently linked to a booking (booking_id IS NOT NULL)
--   - not deleted, not audit-consumed
--
-- Bills go back to booking_id = NULL, booked_at = NULL. The cal_quotas
-- rows they were attached to stay alive — their pipeline_remaining_g
-- will simply reflect the released weight, and the auto-attacher will
-- repopulate them from genuinely incoming bills going forward.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — affected bills grouped by branch ──────────────────────────
SELECT p.branch_name,
       br.region,
       COUNT(*)                                AS bills,
       ROUND(SUM(p.net_weight)::numeric, 3)    AS net_wt_g,
       ROUND(SUM(p.gross_weight)::numeric, 3)  AS gross_wt_g
  FROM purchases p
  JOIN branches  br ON br.name = p.branch_name
 WHERE p.is_deleted        = false
   AND p.stock_status      = 'at_branch'
   AND p.booking_id        IS NOT NULL
   AND p.audit_consumed_at IS NULL
   AND br.region <> 'Bangalore'
 GROUP BY p.branch_name, br.region
 ORDER BY br.region, p.branch_name;

-- Per-region rollup so the scope is obvious before the UPDATE fires.
SELECT br.region,
       COUNT(*)                              AS bills,
       ROUND(SUM(p.net_weight)::numeric, 3)  AS net_wt_g
  FROM purchases p
  JOIN branches  br ON br.name = p.branch_name
 WHERE p.is_deleted        = false
   AND p.stock_status      = 'at_branch'
   AND p.booking_id        IS NOT NULL
   AND p.audit_consumed_at IS NULL
   AND br.region <> 'Bangalore'
 GROUP BY br.region
 ORDER BY bills DESC;

-- ── 2) Affected bookings — surface BEFORE we cut the link so accounts has
-- visibility on which cal_quotas rows are about to lose attached weight.
SELECT q.id, q.party, q.date AS arrival_date, q.status,
       q.weight                              AS committed_g,
       COUNT(p.id)                           AS bills_about_to_release,
       ROUND(SUM(p.net_weight)::numeric, 3)  AS releasing_net_wt_g
  FROM cal_quotas q
  JOIN purchases p ON p.booking_id = q.id
  JOIN branches  br ON br.name = p.branch_name
 WHERE p.is_deleted        = false
   AND p.stock_status      = 'at_branch'
   AND p.audit_consumed_at IS NULL
   AND br.region <> 'Bangalore'
 GROUP BY q.id, q.party, q.date, q.status, q.weight
 ORDER BY releasing_net_wt_g DESC;

-- ── 3) Apply — release the bills ──────────────────────────────────────────
UPDATE purchases
   SET booking_id = NULL,
       booked_at  = NULL
 WHERE id IN (
   SELECT p.id
     FROM purchases p
     JOIN branches  br ON br.name = p.branch_name
    WHERE p.is_deleted        = false
      AND p.stock_status      = 'at_branch'
      AND p.booking_id        IS NOT NULL
      AND p.audit_consumed_at IS NULL
      AND br.region <> 'Bangalore'
 );

-- ── 4) Verify — should return 0 ───────────────────────────────────────────
SELECT COUNT(*) AS outstation_at_branch_still_booked
  FROM purchases p
  JOIN branches  br ON br.name = p.branch_name
 WHERE p.is_deleted        = false
   AND p.stock_status      = 'at_branch'
   AND p.booking_id        IS NOT NULL
   AND p.audit_consumed_at IS NULL
   AND br.region <> 'Bangalore';
-- Expected: 0

COMMIT;
