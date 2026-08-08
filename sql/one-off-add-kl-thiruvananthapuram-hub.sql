-- 2026-08-08 · Kerala gains a third hub.
--
-- Kerala runs a leaf → hub → HO flow. Hub membership is data-driven: the
-- Booking Volume / consignment API derives the KL hub set purely from
-- branches.is_hub (region='Kerala' AND is_hub=true) — no hardcoded list.
--
-- Existing hubs: KL-VENNALA-BY-PASS, KL-THRISSUR.
-- New hub:       KL-THIRUVANANTHAPURAM MGROAD (was a leaf).
--
-- Already applied live via the service-role client on 2026-08-08; this file is
-- the record. Idempotent — safe to re-run.
UPDATE branches
   SET is_hub = true
 WHERE region = 'Kerala'
   AND name   = 'KL-THIRUVANANTHAPURAM MGROAD';

-- verify
-- SELECT name, is_hub FROM branches WHERE region='Kerala' AND is_hub=true ORDER BY name;
--   → KL-THIRUVANANTHAPURAM MGROAD, KL-THRISSUR, KL-VENNALA-BY-PASS
