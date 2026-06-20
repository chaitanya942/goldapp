-- Diagnostic — which Bangalore branches are missing PIN (will block EWB)
--
-- EWB pre-flight validation requires the source branch to carry a PIN code,
-- because the ClearTax / NIC E-Way Bill payload includes "fromPincode".
-- Any branch with NULL / empty PIN will fail pre-flight at EWB generation
-- AFTER the consignment + delivery challan are already created — wasteful.
-- This query lists every Bangalore branch that needs one before its next
-- hub dispatch.

SELECT name,
       region,
       hub_branch_name,
       is_active,
       pin,
       branch_gstin,
       address,
       phone
  FROM branches
 WHERE region = 'Bangalore'
   AND is_active = true
   AND (pin IS NULL OR TRIM(pin) = '')
 ORDER BY name;

-- For context — Bangalore branches WITH a PIN (sanity check the column).
SELECT COUNT(*) AS bangalore_branches_with_pin
  FROM branches
 WHERE region = 'Bangalore'
   AND is_active = true
   AND pin IS NOT NULL
   AND TRIM(pin) <> '';
