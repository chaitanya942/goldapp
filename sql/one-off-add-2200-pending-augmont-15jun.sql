-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: add the forgotten 2200 g Pending Delivery to today's first Augmont
-- booking, so Booked Wt goes 1000 → 3200 with Net and Gain UNCHANGED.
--
-- Target booking (identified by its numbers — 23 bills, net 965.43, wt 1000):
--   id = 9690a47e-08d2-498c-a1de-3231df7a7009   (Augmont, created 15 Jun 01:41 pm)
--
-- How the Bookings columns are derived (settled booking — pipeline_closed_at set):
--   NET      = live attached bill weight        = 965.43 g
--   PENDING  = pending_g                         = 0      → set to 2200
--   GAIN     = (weight − attached − pending_g) + additional_gain_g
--   BOOKED   = weight                            = 1000   → set to 3200
--
-- Adding the SAME 2200 to BOTH weight and pending_g keeps (weight − sourced)
-- constant (34.57 g), so the derived GAIN stays 35.35 g and NET stays 965.43 g.
-- Only PENDING (+2200) and BOOKED WT (→3200, and VALUE → 3200×rate) change.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW (confirm it's the right row) ────────────────────────────
SELECT id, date, party, status, weight, pending_g, bills_net_weight_g,
       additional_gain_g, gain_rate, pipeline_closed_at, rate,
       round((weight * rate)::numeric, 0) AS value_now
  FROM cal_quotas
 WHERE id = '9690a47e-08d2-498c-a1de-3231df7a7009';
-- Expect: weight=1000, pending_g=0, bills_net_weight_g≈965.43, status=booked.

-- ── STEP 2 · APPLY ───────────────────────────────────────────────────────────
BEGIN;

UPDATE cal_quotas
   SET weight    = weight + 2200,             -- 1000 → 3200 (committed booked wt)
       pending_g = COALESCE(pending_g, 0) + 2200   -- 0 → 2200 (the forgotten pending)
 WHERE id = '9690a47e-08d2-498c-a1de-3231df7a7009'
   AND status <> 'cancelled';

COMMIT;

-- ── STEP 3 · VERIFY ───────────────────────────────────────────────────────────
SELECT id, weight AS booked_wt, pending_g,
       bills_net_weight_g AS net,
       round((weight - bills_net_weight_g - pending_g + COALESCE(additional_gain_g,0))::numeric, 2) AS gain_shown,
       round((weight * rate)::numeric, 0) AS value_new
  FROM cal_quotas
 WHERE id = '9690a47e-08d2-498c-a1de-3231df7a7009';
-- Expect: booked_wt=3200, pending_g=2200, net≈965.43, gain_shown≈35.35.
-- Refresh Bookings → row shows Net 965.43 · Gain 35.35 · Pending 2200 · Booked 3200.
