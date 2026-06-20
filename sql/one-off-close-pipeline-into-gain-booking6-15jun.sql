-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: close the 20.73 g open pipeline on yesterday's 6th Augmont booking
-- and fold it into gain.
--
-- Booking 96232ae1-2ec8-4362-8e1e-fc9c8e61429d  (Augmont, 15 Jun 8:03 pm,
--   weight 400 · attached net 366.44 · gain 12.83 · pipeline 20.73).
--
-- Setting pipeline_closed_at marks the booking "settled". The bookings API then
-- derives gain as (weight − attached − pending) instead of the rate-based number,
-- so the 20.73 g pipeline rolls into gain:
--   gain     12.83 → 33.56   (= 400 − 366.44)
--   pipeline 20.73 → 0
--   net 366.44 + gain 33.56 = 400 (the booked weight) exactly.
-- weight stays 400; nothing else changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW ─────────────────────────────────────────────────────────
SELECT id, date, party, status, weight, pending_g, additional_gain_g,
       bills_net_weight_g, pipeline_remaining_g, pipeline_closed_at, pipeline_region
  FROM cal_quotas
 WHERE id = '96232ae1-2ec8-4362-8e1e-fc9c8e61429d';

-- ── STEP 2 · APPLY ───────────────────────────────────────────────────────────
BEGIN;

UPDATE cal_quotas
   SET pipeline_closed_at    = now(),
       pipeline_remaining_g  = 0
 WHERE id = '96232ae1-2ec8-4362-8e1e-fc9c8e61429d'
   AND status <> 'cancelled';

COMMIT;

-- ── STEP 3 · VERIFY (gain ≈ 33.56, pipeline 0) ───────────────────────────────
SELECT q.weight AS booked_wt, q.pipeline_remaining_g, q.pipeline_closed_at,
       round(att.net::numeric, 2) AS attached_net,
       round((q.weight - att.net - q.pending_g + COALESCE(q.additional_gain_g,0))::numeric, 2) AS gain_shown
  FROM cal_quotas q
  CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(net_weight),0) AS net FROM purchases WHERE booking_id = q.id
       ) att
 WHERE q.id = '96232ae1-2ec8-4362-8e1e-fc9c8e61429d';
