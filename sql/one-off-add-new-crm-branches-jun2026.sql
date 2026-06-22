-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: add 7 NEW-CRM branches that don't yet exist in GoldApp's branches
-- table, so their bills can map (otherwise they resolve to region 'Unknown' and
-- drop out of the region roll-ups). Names match what aliasBranchName() produces
-- for each new-CRM branch, so bills attach automatically:
--   • KA-* pass through uppercased and match these rows directly.
--   • "Mavoor road" / "Alappuzha" are aliased to KL-MAVOOR-ROAD / KL-ALAPPUZHA
--     in lib/crmBranchAlias.js (deploy that alongside this).
--
-- Region split (per ops):
--   • KA-KANAKAPURA, KA-NELAMANGALA → Bangalore (model_type 'bangalore', TE pickup)
--   • KA-RAICHUR, KA-BAGALKOT, KA-DHARWAD → Rest of Karnataka (outside_bangalore)
--   • KL-MAVOOR-ROAD, KL-ALAPPUZHA → Kerala (outside_bangalore)
--
-- ⚠ delivery_tat_hours / logistics_partner / pickup_time / pickup_days are
-- sensible regional defaults — have logistics confirm/adjust the real pickup
-- schedule. Everything else (name/region/state/model_type) is what makes the
-- bills map correctly, so those are the values that matter most.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO branches
  (name, city, state, region, cluster, model_type, is_active,
   delivery_tat_hours, logistics_partner, pickup_time, pickup_days, is_hub,
   address, pin_code, contact_person, contact_phone, branch_code, crm_branch_id,
   address_source, address_verified)
VALUES
  -- ── Bangalore region (model_type 'bangalore', TE pickup, same-day) ──────────
  ('KA-KANAKAPURA', 'Kanakapura', 'Karnataka', 'Bangalore', 'Bangalore South',
   'bangalore', true, 0, 'Transaction Executives', NULL,
   ARRAY['Mon','Tue','Wed','Thu','Fri','Sat']::text[], false,
   'Transform Beedi, Lakshmipura, Kanakapura, Ramanagara, Bangalore - 562117',
   '562117', NULL, '7353328333', 'WG-2126', NULL, 'manual', false),

  ('KA-NELAMANGALA', 'Nelamangala', 'Karnataka', 'Bangalore', 'Bangalore North & West',
   'bangalore', true, 0, 'Transaction Executives', NULL,
   ARRAY['Mon','Tue','Wed','Thu','Fri','Sat']::text[], false,
   'KMRP Ward, 2nd block, Bangalore Honnavara road, Nelamangala, Bangalore - 562123',
   '562123', NULL, '9187046123', 'WG-2127', NULL, 'manual', false),

  -- ── Rest of Karnataka (outside_bangalore, BVC) — ⚠ confirm TAT/pickup ───────
  ('KA-RAICHUR', 'Raichur', 'Karnataka', 'Rest of Karnataka', 'Rest of Karnataka',
   'outside_bangalore', true, 72, 'BVC', '11:00',
   ARRAY['Tue','Sat']::text[], false,
   '1st floor, 1-10-53 Station road, Opp to Ram Mandir, Udaya nagar, Raichur, Karnataka - 584101',
   '584101', NULL, '8884303333', 'WG-2128', NULL, 'manual', false),

  ('KA-BAGALKOT', 'Bagalkote', 'Karnataka', 'Rest of Karnataka', 'Rest of Karnataka',
   'outside_bangalore', true, 72, 'BVC', '11:00',
   ARRAY['Tue','Sat']::text[], false,
   '#32, Bus stand road, Above ICICI Bank, Near Ardhana Lodge, Bagalkote - 587101',
   '587101', NULL, '8884303333', 'WG-2129', NULL, 'manual', false),

  ('KA-DHARWAD', 'Dharwad', 'Karnataka', 'Rest of Karnataka', 'Rest of Karnataka',
   'outside_bangalore', true, 72, 'BVC', '11:00',
   ARRAY['Tue','Sat']::text[], false,
   'Shradha Complex, Jubilee circle, Beside RBL Bank, Dharwad - 580001',
   '580001', NULL, '8884303333', 'WG-2130', NULL, 'manual', false),

  -- ── Kerala (outside_bangalore, BVC) ─────────────────────────────────────────
  ('KL-MAVOOR-ROAD', 'Kozhikode', 'Kerala', 'Kerala', 'Kerala - North',
   'outside_bangalore', true, 24, 'BVC', NULL,
   ARRAY['Mon','Tue','Wed','Thu','Fri','Sat']::text[], false,
   'KP Tower, Mavoor Rd, near New Bus Stand, EMS Stadium, Tazhekkod, Kozhikode',
   '673016', NULL, NULL, 'WG-20265', NULL, 'manual', false),

  ('KL-ALAPPUZHA', 'Alappuzha', 'Kerala', 'Kerala', 'Kerala - South',
   'outside_bangalore', true, 24, 'BVC', NULL,
   ARRAY['Mon','Tue','Wed','Thu','Fri','Sat']::text[], false,
   NULL, NULL, NULL, NULL, NULL, NULL, 'manual', false)
ON CONFLICT (name) DO NOTHING;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
SELECT name, region, state, cluster, model_type, is_active, delivery_tat_hours, pickup_days
  FROM branches
 WHERE name IN ('KA-KANAKAPURA','KA-NELAMANGALA','KA-RAICHUR','KA-BAGALKOT','KA-DHARWAD','KL-MAVOOR-ROAD','KL-ALAPPUZHA')
 ORDER BY region, name;
