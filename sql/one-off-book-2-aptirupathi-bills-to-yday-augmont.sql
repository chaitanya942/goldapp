-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — attach 2 AP-TIRUPATHI bills to yesterday's (17-Jun) Augmont booking
-- ─────────────────────────────────────────────────────────────────────────────
-- Bills (Section 5 — consignment created, bidding passed, not booked):
--   WGKA-56235  Roja Yanamala       net 40.80 g   (new_crm, in_consignment)
--   WGKA-56301  Sankranthi Ankaiah  net  1.03 g   (new_crm, in_consignment)
--   → 41.83 g net  (43.29 g effective at the 3.5% gain rate)
--
-- Target booking (the only open pipeline from 17-Jun):
--   cal_quotas.id = 3849a515-b6ee-42f2-956a-ce8eb6f8ee43
--   Augmont · 700 g · gain 3.5% · pipeline_remaining_g 259.27 (closed_at NULL)
--
-- Mirrors process_pipeline_attachments() exactly: set booking_id/booked_at on the
-- bills, then LIVE-recompute pipeline_remaining_g from the real attached net so the
-- booking math stays consistent (NET + GAIN + PIPELINE = booked weight).
--   new attached_net = 425.83 + 41.83 = 467.66 g
--   new pipeline_remaining_g = 700 − 467.66 × 1.035 ≈ 215.97 g
-- 41.83 g fits inside the 259.27 g gap → no overshoot.
--
-- These bills are AP (not Bangalore) + in_consignment, so the Bangalore-only
-- auto-attacher and the Bangalore-only reconcile will never move them.
--
-- Wrapped in BEGIN/COMMIT. Run STEP 1 preview; swap COMMIT for ROLLBACK if wrong.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — booking + the 2 bills (and current attached net) ────────────
SELECT 'booking' AS what, q.id::text, q.party, q.weight, q.gain_rate,
       q.pipeline_remaining_g, q.status,
       (SELECT ROUND(COALESCE(SUM(p.net_weight),0)::numeric,2)
          FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted=false) AS attached_net_now
  FROM cal_quotas q
 WHERE q.id = '3849a515-b6ee-42f2-956a-ce8eb6f8ee43';

SELECT 'bill' AS what, application_id, crm_source, customer_name, net_weight,
       stock_status, booking_id, current_branch
  FROM purchases
 WHERE application_id IN ('WGKA-56235','WGKA-56301') AND crm_source = 'new_crm'
 ORDER BY application_id;

-- ── 2) Attach the 2 bills to the booking (only if currently unbooked) ────────
UPDATE purchases
   SET booking_id = '3849a515-b6ee-42f2-956a-ce8eb6f8ee43',
       booked_at  = now()
 WHERE application_id IN ('WGKA-56235','WGKA-56301')
   AND crm_source  = 'new_crm'
   AND is_deleted  = false
   AND booking_id  IS NULL;

-- ── 3) Live-recompute the booking's pipeline gap from real attached net ──────
UPDATE cal_quotas q
   SET pipeline_remaining_g = GREATEST(0, q.weight - (
         SELECT COALESCE(SUM(p.net_weight),0)
           FROM purchases p
          WHERE p.booking_id = q.id AND p.is_deleted = false
       ) * (1 + COALESCE(q.gain_rate,0))),
       pipeline_attached_at = now()
 WHERE q.id = '3849a515-b6ee-42f2-956a-ce8eb6f8ee43';

-- ── 4) Verify — booking gap should drop ~259.27 → ~215.97; 2 bills attached ─
SELECT q.id::text, q.party, q.weight, q.gain_rate,
       ROUND(q.pipeline_remaining_g::numeric,2) AS pipeline_remaining_g,
       (SELECT ROUND(COALESCE(SUM(p.net_weight),0)::numeric,2)
          FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted=false) AS attached_net,
       (SELECT COUNT(*) FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted=false) AS attached_bills
  FROM cal_quotas q
 WHERE q.id = '3849a515-b6ee-42f2-956a-ce8eb6f8ee43';

SELECT application_id, booking_id, to_char(booked_at,'YYYY-MM-DD HH24:MI') booked_at
  FROM purchases
 WHERE application_id IN ('WGKA-56235','WGKA-56301') AND crm_source='new_crm';

COMMIT;
