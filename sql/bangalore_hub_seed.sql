-- ─────────────────────────────────────────────────────────────────────────────
-- Bangalore HUB model — seed the 6 transaction-executive hubs
-- ─────────────────────────────────────────────────────────────────────────────
-- Bangalore operates differently from outstation: each branch hands its day's
-- bills to one of 6 specific HUBs, and our transaction executives pick up
-- from those hubs (not from each leaf branch). HUB → HO movement creates an
-- EWB.
--
-- This migration flips is_hub=true on the 6 hubs so the Logistics admin
-- module can offer them in the per-branch HUB picker. Existing non-hub
-- branches keep is_hub=false and get assigned a hub via the UI.
--
-- The 6 hubs:
--   BASAWESHWARANAGAR, K R PURAM, KAIKONDRAHALLI, KATRIGUPPE, BOMMANAHALLI, ADUGODI
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE branches
   SET is_hub = true
 WHERE region = 'Bangalore'
   AND name IN (
     'BASAWESHWARANAGAR',
     'K R PURAM',
     'KAIKONDRAHALLI',
     'KATRIGUPPE',
     'BOMMANAHALLI',
     'ADUGODI'
   );

-- Sanity check — should print exactly 6 rows. If you get fewer, the branch
-- name in the DB doesn't match exactly (e.g. extra space, different casing).
SELECT name, region, is_hub
  FROM branches
 WHERE region = 'Bangalore'
   AND is_hub = true
 ORDER BY name;

COMMIT;
