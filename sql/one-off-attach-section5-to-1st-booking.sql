-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: move the 25 Section-5 bills (540.27 g) INTO today's 1st Augmont
-- booking, replacing 540.27 g of its placeholder Pending.
--
-- Booking: 9690a47e-08d2-498c-a1de-3231df7a7009  (Augmont, 23 bills, net 965.43,
--          weight 3200, pending 2200 — the 2200 we added earlier).
--
-- Section-5 set (the bills to attach) = the exact same filter the bidding screen
-- uses for "Consignment created · not booked":
--   stock_status='in_consignment' · booking_id IS NULL · dispatched_at NOT NULL
--   · branch region <> 'Kerala' · is_deleted=false      → 25 bills / 540.27 g
--
-- Effect on the booking (it's settled — gain = weight − attached − pending + add):
--   attached  965.43 → 1505.70   (+540.27, the real bills now sourced)
--   pending   2200   → 1659.73   (−540.27, placeholder reduced by what arrived)
--   weight    3200   → 3200       (unchanged — committed booked wt)
--   gain      35.35  → 35.35      (unchanged — attached+pending is constant)
-- The attached bills are also flipped in_consignment → at_ho (received) so they
-- leave Section 5 and the in-flight pool entirely.
--
-- ORDER MATTERS: reduce pending FIRST (its subquery reads the still-unbooked
-- set to size the reduction), THEN attach. Both run in one transaction.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW ──────────────────────────────────────────────────────────
-- 1a) the booking as it stands
SELECT id, party, status, weight, pending_g, bills_net_weight_g, additional_gain_g
  FROM cal_quotas
 WHERE id = '9690a47e-08d2-498c-a1de-3231df7a7009';

-- 1b) the Section-5 set being attached (expect 25 bills / 540.27 g)
SELECT count(*) AS bills, round(sum(p.net_weight)::numeric, 2) AS net_g
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE p.stock_status='in_consignment' AND p.booking_id IS NULL
   AND p.dispatched_at IS NOT NULL AND p.is_deleted=false
   AND b.region <> 'Kerala';

-- ── STEP 2 · APPLY (one transaction) ─────────────────────────────────────────
BEGIN;

-- a) reduce pending by the net weight of the bills about to be attached.
--    Subquery reads the set while it is STILL unbooked/in_consignment.
UPDATE cal_quotas q
   SET pending_g = GREATEST(0, COALESCE(q.pending_g, 0) - (
         SELECT COALESCE(SUM(p.net_weight), 0)
           FROM purchases p
           JOIN branches  b ON b.name = p.branch_name
          WHERE p.stock_status='in_consignment' AND p.booking_id IS NULL
            AND p.dispatched_at IS NOT NULL AND p.is_deleted=false
            AND b.region <> 'Kerala'
       ))
 WHERE q.id = '9690a47e-08d2-498c-a1de-3231df7a7009';

-- b) attach those bills to the booking + receive them at HO.
UPDATE purchases p
   SET booking_id     = '9690a47e-08d2-498c-a1de-3231df7a7009',
       booked_at      = now(),
       stock_status   = 'at_ho',
       current_branch = NULL
  FROM branches b
 WHERE b.name = p.branch_name
   AND p.stock_status='in_consignment' AND p.booking_id IS NULL
   AND p.dispatched_at IS NOT NULL AND p.is_deleted=false
   AND b.region <> 'Kerala';

COMMIT;

-- ── STEP 3 · VERIFY ───────────────────────────────────────────────────────────
-- Booking: pending ≈ 1659.73, weight 3200 unchanged.
SELECT q.id, q.weight AS booked_wt, q.pending_g,
       round(att.net::numeric, 2) AS attached_net,
       att.bills AS attached_bills,
       round((q.weight - att.net - q.pending_g + COALESCE(q.additional_gain_g,0))::numeric, 2) AS gain_shown
  FROM cal_quotas q
  CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(net_weight),0) AS net, count(*) AS bills
          FROM purchases WHERE booking_id = q.id
       ) att
 WHERE q.id = '9690a47e-08d2-498c-a1de-3231df7a7009';
-- Expect: booked_wt 3200 · pending ≈1659.73 · attached_net ≈1505.70 · bills 48
--         · gain ≈35.35.  Section 5 → 0 bills on refresh.
