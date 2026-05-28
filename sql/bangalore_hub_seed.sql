-- ─────────────────────────────────────────────────────────────────────────────
-- Bangalore HUB model — seed hubs, leaf-branch hub assignments, partner
-- ─────────────────────────────────────────────────────────────────────────────
-- Bangalore operates differently from outstation: each branch hands its day's
-- bills to one of 6 HUBs, and our in-house Transaction Executives sweep the
-- hubs and bring everything back to HO. HUB → HO movement creates an EWB.
--
-- This migration does three things, all scoped to region='Bangalore' so a
-- mis-typed leaf name elsewhere can't accidentally get a hub assignment:
--
--   1) Flips is_hub=true on the 6 hubs.
--   2) Assigns hub_branch_name on every leaf branch (per the ops mapping).
--   3) Forces logistics_partner='Transaction Executives' on every Bangalore
--      branch (hubs + leaves). The Logistics admin UI also locks this field
--      for Bangalore branches.
--
-- Idempotent — re-running just re-stamps the same values.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Mark the 6 hubs ──────────────────────────────────────────────────────
UPDATE branches
   SET is_hub = true,
       hub_branch_name = NULL          -- a hub has no parent hub
 WHERE region = 'Bangalore'
   AND name IN (
     'BASAWESHWARANAGAR',
     'K R PURAM',
     'KAIKONDRAHALLI',
     'KATRIGUPPE',
     'BOMMANAHALLI',
     'ADUGODI'
   );

-- ── 2) Assign each leaf branch to its hub ───────────────────────────────────
-- BASAWESHWARANAGAR hub
UPDATE branches SET hub_branch_name = 'BASAWESHWARANAGAR', is_hub = false
 WHERE region = 'Bangalore'
   AND name IN ('NAGARBHAVI','SUNKADAKATTE','ULLAL','JALAHALLI','YELAHANKA',
                'KODIGEHALLI','MATHIKERE','SADASHIVA NAGAR','MALLESHWARAM');

-- K R PURAM hub
UPDATE branches SET hub_branch_name = 'K R PURAM', is_hub = false
 WHERE region = 'Bangalore'
   AND name IN ('TC PALYA','HOSAKOTE','KOLAR','WHITE FIELD','LINGARAJPURAM',
                'INDIRANAGAR','THANISANDRA','MARATHAHALLI');

-- KATRIGUPPE hub
UPDATE branches SET hub_branch_name = 'KATRIGUPPE', is_hub = false
 WHERE region = 'Bangalore'
   AND name IN ('VAJRAHALLI','UTTARAHALLI','JAYANAGAR','JP NAGAR','KENGERI',
                'BANNERGHATTA');

-- KAIKONDRAHALLI hub
UPDATE branches SET hub_branch_name = 'KAIKONDRAHALLI', is_hub = false
 WHERE region = 'Bangalore'
   AND name IN ('SARJAPURA');

-- BOMMANAHALLI hub
UPDATE branches SET hub_branch_name = 'BOMMANAHALLI', is_hub = false
 WHERE region = 'Bangalore'
   AND name IN ('HOSA ROAD');

-- ADUGODI hub
UPDATE branches SET hub_branch_name = 'ADUGODI', is_hub = false
 WHERE region = 'Bangalore'
   AND name IN ('VELLARA JUNCTION');

-- ── 3) Lock partner = Transaction Executives for every Bangalore branch ─────
UPDATE branches
   SET logistics_partner = 'Transaction Executives'
 WHERE region = 'Bangalore';

-- ── Sanity check — should print 6 hubs + 26 leaves grouped by hub ──────────
SELECT
  COALESCE(hub_branch_name, name) AS hub,
  is_hub,
  COUNT(*) FILTER (WHERE is_hub = false) AS leaves
  FROM branches
 WHERE region = 'Bangalore'
 GROUP BY hub_branch_name, name, is_hub
 ORDER BY hub, is_hub DESC;

-- Verify every Bangalore branch now has the right partner.
SELECT logistics_partner, COUNT(*)
  FROM branches
 WHERE region = 'Bangalore'
 GROUP BY logistics_partner;

-- Show any Bangalore leaf that's still without a hub (typo in DB vs ops mapping).
SELECT name
  FROM branches
 WHERE region = 'Bangalore'
   AND is_hub = false
   AND hub_branch_name IS NULL
 ORDER BY name;

COMMIT;
