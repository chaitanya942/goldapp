-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: fix today's (16-Jun-2026) 1st Augmont booking after a wrong reconcile.
--
-- Booking #1  = cal_quotas a1fcde1a-ded8-43ee-bb38-bd4b0ca0f1ed (1500 g, 12:36 IST)
--
-- What happened: a big Bangalore branch was attached to close the pipeline, leaving
-- ~90 g of over-attachment. The "reconcile over-attached" action detaches SMALLEST
-- bills first but does NOT exclude in-transit (section-2, already-dispatched)
-- bills — so it wrongly freed 13 outstation in_consignment bills arriving 17-Jun
-- (TUMKUR / AP-GAJUWAKA / TS-DILSUKH NAGAR / CHITRADURGA / DAVANAGERE, 49.12 g)
-- instead of only section-1 Bangalore bills.
--
-- Fix = a weight-neutral SWAP on Booking #1:
--   • RE-ATTACH the 13 wrongly-freed section-2 bills        (+49.12 g)
--   • DETACH the 5 lowest-weight Bangalore at_branch bills  (-51.35 g, nearest match)
-- Net effect: 1447.66 → 1445.43 g attached (effective ×1.035 = 1496.0 g ≤ 1500,
-- gain ≈ 3.98 g, no over-attach, no pipeline). The freed Bangalore bills return to
-- Section 1 (Bangalore today) as available-to-book.
--
-- Targeted by purchases.id (uuid) because almost every WGKA number here exists in
-- BOTH old_crm and new_crm — matching on application_id alone would hit wrong rows.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) RE-ATTACH the 13 section-2 in_consignment bills (49.12 g) to Booking #1
UPDATE purchases
SET booking_id = 'a1fcde1a-ded8-43ee-bb38-bd4b0ca0f1ed',
    booked_at  = NOW()
WHERE id IN (
  -- old_crm (7): WGKA102386,103217,103801,103825,104053,104153,104165
  '5486383c-1d9c-43e7-8401-316c80433238',
  '96acfa1f-65bb-40a5-a855-0894b1e766b8',
  '5ec4d0f9-a215-41cc-ab17-a02bafb94fb4',
  'e49f515d-6ccc-49f7-91b4-24d861042ebe',
  'a418006b-0349-4d11-890a-00ee8abe7186',
  'e674a8d9-4df6-43ae-be90-c2f22cc7bd55',
  'b91d7b9c-1a7f-464f-96fc-862d5a7b4eb8',
  -- new_crm (6): WGKA55479,55575,55632,55656,55682,55787
  '49c137af-4524-4e79-a07b-fbccf925fe1b',
  '92958927-5079-49d5-b7c2-44bf45f11eae',
  'ba021b5d-c7a0-4011-a181-acc1d8fc0ee8',
  '0eff5d0d-6650-4a02-8ee2-eacaf9ff8389',
  '24f1c0da-b499-4fc5-a111-53f3236b4f34',
  '6370d3a6-b8b5-45fe-98e4-6f4da2e4b962'
);

-- 2) DETACH the 5 lowest-weight Bangalore at_branch bills (51.35 g) from Booking #1
UPDATE purchases
SET booking_id = NULL,
    booked_at  = NULL
WHERE booking_id = 'a1fcde1a-ded8-43ee-bb38-bd4b0ca0f1ed'
  AND id IN (
    -- new_crm: WGKA55876(8.89) 55810(9.83) 55936(10.00) 55892(10.74) 56034(11.89)
    '914c7bb5-5b57-4945-b233-97783b885a11',
    '255f1535-1cc7-4ffd-a6d2-774d2630e336',
    '549d7d4d-2b72-4042-80ef-ed6cd3c6090a',
    'b0ba7d81-4458-418d-b80d-7b33f95a6c89',
    '81b5732c-283f-4765-a05c-52da8e1ab923'
  );

-- 3) Verify: expect ~49 bills, attached net ≈ 1445.43 g, effective ≈ 1496.0 g
SELECT COUNT(*)                         AS bills,
       ROUND(SUM(net_weight)::numeric,2) AS attached_net_g,
       ROUND((SUM(net_weight)*1.035)::numeric,2) AS effective_g
FROM purchases
WHERE booking_id = 'a1fcde1a-ded8-43ee-bb38-bd4b0ca0f1ed';

-- If the numbers look right, COMMIT;  otherwise ROLLBACK;
COMMIT;
