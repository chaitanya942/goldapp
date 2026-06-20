-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: set the 1st Augmont booking's Pending to exactly 1658.95 g so the
-- columns sum cleanly to the 3200 g booked weight.
--
-- Booking 9690a47e-... currently: weight 3200 · attached 1505.70 · pending 1659.73
-- · additional_gain_g 0.78 (an old floored-remainder crumb). Displayed gain =
-- (weight − attached − pending) + additional_gain_g, so the 0.78 makes the
-- columns total 3200.78.
--
-- Target: pending = 1658.95, gain stays 35.35, weight stays 3200.
--   gain = 3200 − 1505.70 − 1658.95 = 35.35  → needs additional_gain_g = 0.
--   1505.70 + 35.35 + 1658.95 = 3200.00 exactly.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE cal_quotas
   SET pending_g         = 1658.95,
       additional_gain_g = 0
 WHERE id = '9690a47e-08d2-498c-a1de-3231df7a7009';

COMMIT;

-- VERIFY — expect booked_wt 3200 · pending 1658.95 · attached ≈1505.70 · gain ≈35.35
SELECT q.weight AS booked_wt, q.pending_g,
       round(att.net::numeric, 2) AS attached_net,
       round((q.weight - att.net - q.pending_g + COALESCE(q.additional_gain_g,0))::numeric, 2) AS gain_shown
  FROM cal_quotas q
  CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(net_weight),0) AS net FROM purchases WHERE booking_id = q.id
       ) att
 WHERE q.id = '9690a47e-08d2-498c-a1de-3231df7a7009';
