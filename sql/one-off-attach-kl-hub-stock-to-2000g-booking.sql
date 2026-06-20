-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — attach all unbooked KL hub-stock bills to Augmont 2000g booking
-- ─────────────────────────────────────────────────────────────────────────────
-- Target booking (from diagnose-kl-hub-stock-and-booking.sql block 3):
--   050086f2-f115-4302-b67b-2e690c7cf597
--   Augmont · 04-Jun-2026 · 2000g · gain_rate 0 (KL booking)
--   Current: 1670.28g attached / 329.72g pipeline owed.
--
-- Bills to attach: every unbooked at_branch + crm_approved bill currently
-- sitting at one of the two KL hubs (KL-THRISSUR or KL-VENNALA-BY-PASS).
-- Per the bidding UI: 9 bills totalling 168.75g.
--
-- After attach (expected):
--   attached_net = 1670.28 + 168.75 = 1839.03g (effective same — KL gain 0)
--   pipeline_remaining_g = 2000 - 1839.03 = 160.97g
--   (Bidding UI's "Pipeline Over: -160.97g" warning becomes the actual
--    remaining gap, which closes when more bills reach the hubs or
--    pipeline gets manually closed at EOD.)
--
-- Also refreshes cal_quotas.pipeline_remaining_g so the UI reads the
-- same number without waiting for the auto-attacher to recompute.
--
-- Wrapped in BEGIN/COMMIT. Preview block first.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — exact bills that will move + target booking snapshot ───
SELECT 'BILLS TO ATTACH' AS section,
       p.application_id,
       p.branch_name           AS leaf_branch,
       p.current_branch        AS hub_branch,
       ROUND(p.net_weight::numeric, 3) AS net_g
  FROM purchases p
 WHERE COALESCE(p.current_branch, p.branch_name) IN ('KL-THRISSUR', 'KL-VENNALA-BY-PASS')
   AND p.is_deleted   = false
   AND p.crm_status   = 'approved'
   AND p.stock_status = 'at_branch'
   AND p.booking_id   IS NULL
 ORDER BY p.net_weight DESC;
-- Expected: 9 rows summing to ~168.75g.

SELECT q.id, q.party, q.weight, q.gain_rate, q.pipeline_remaining_g,
       (SELECT COUNT(*)                            FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric,3) FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g
  FROM cal_quotas q
 WHERE q.id = '050086f2-f115-4302-b67b-2e690c7cf597'::uuid;
-- Expected: 1670.28g attached, 329.72g pipeline_remaining_g.

-- ── 2a) Apply — attach the bills ─────────────────────────────────────────
UPDATE purchases
   SET booking_id = '050086f2-f115-4302-b67b-2e690c7cf597'::uuid,
       booked_at  = NOW()
 WHERE COALESCE(current_branch, branch_name) IN ('KL-THRISSUR', 'KL-VENNALA-BY-PASS')
   AND is_deleted   = false
   AND crm_status   = 'approved'
   AND stock_status = 'at_branch'
   AND booking_id   IS NULL;

-- ── 2b) Refresh cal_quotas.pipeline_remaining_g from the new totals ─────
-- gain_rate is 0 for KL bookings so effective = net.
UPDATE cal_quotas
   SET pipeline_remaining_g = GREATEST(
         0,
         weight - (SELECT COALESCE(SUM(p.net_weight), 0)
                     FROM purchases p
                    WHERE p.booking_id = cal_quotas.id) * (1 + COALESCE(gain_rate, 0))
       )
 WHERE id = '050086f2-f115-4302-b67b-2e690c7cf597'::uuid;

-- ── 3) Verify — booking should now show ~160.97g pipeline still owed ────
SELECT q.id,
       q.weight                                     AS committed_g,
       q.gain_rate,
       q.pipeline_remaining_g,
       (SELECT COUNT(*)                            FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric,3) FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g
  FROM cal_quotas q
 WHERE q.id = '050086f2-f115-4302-b67b-2e690c7cf597'::uuid;
-- Expected: attached_bills 68, attached_net_g ≈ 1839.03, pipeline ≈ 160.97g.

COMMIT;
