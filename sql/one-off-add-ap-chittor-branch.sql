-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: add AP-CHITTOR to GoldApp's branches table. It exists in the new CRM
-- but not in GoldApp, so its bills can't map until the branch row exists.
-- Column values mirror a typical Andhra Pradesh branch (AP-ANANTAPUR). Review
-- the ⚠ placeholders (address / contact / pickup logistics / branch_code /
-- crm_branch_id) and fill real values before running — the rest are safe AP
-- defaults so it slots into the AP region pool correctly.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO branches
  (name, city, state, region, cluster, model_type, is_active,
   delivery_tat_hours, logistics_partner, pickup_time, pickup_days, is_hub,
   address, pin_code, contact_person, contact_phone, branch_code, crm_branch_id,
   address_source, address_verified)
VALUES
  ('AP-CHITTOR', 'Chittoor', 'Andhra Pradesh', 'Andhra Pradesh', 'Andhra Pradesh',
   'outside_bangalore', true,
   24, 'BVC', '17:00', ARRAY['Mon','Wed','Fri']::text[], false,
   NULL,            -- ⚠ address
   NULL,            -- ⚠ pin_code
   NULL,            -- ⚠ contact_person
   NULL,            -- ⚠ contact_phone
   NULL,            -- ⚠ branch_code
   NULL,            -- ⚠ crm_branch_id (new-CRM Branch id if known)
   'manual', false)
ON CONFLICT (name) DO NOTHING;

-- VERIFY
SELECT name, region, state, model_type, is_active, delivery_tat_hours, pickup_days
  FROM branches WHERE name = 'AP-CHITTOR';
