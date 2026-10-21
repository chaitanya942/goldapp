-- Adds stock_status 'on_hold': a bill that must stay at its branch. Consignment,
-- Branch Stock and booking only pick up 'at_branch' bills, so an on_hold bill
-- is never moved or booked, but it still counts as a purchase in Purchase Data
-- and reports. The CRM sync never overwrites stock_status, so the hold sticks.
-- Release a bill with: UPDATE purchases SET stock_status = 'at_branch' WHERE application_id = '…';
-- Idempotent: safe to re-run in the Supabase SQL editor.

-- 1) Allow 'on_hold' — extends the live CHECK list instead of retyping it.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'purchases_stock_status_check' AND conrelid = 'public.purchases'::regclass;

  IF def IS NULL THEN
    RAISE NOTICE 'purchases_stock_status_check not found — nothing to extend';
  ELSIF def NOT LIKE '%on_hold%' THEN
    EXECUTE 'ALTER TABLE public.purchases DROP CONSTRAINT purchases_stock_status_check';
    EXECUTE 'ALTER TABLE public.purchases ADD CONSTRAINT purchases_stock_status_check '
            || regexp_replace(def, '\]', ', ''on_hold''::text]');
  END IF;
END $$;

-- 2) Hold WGKA-95221 (JAIMY JOSEPH, KL-PERUMBAVOOR) at its branch — not to be
--    consigned or booked. Only while it is still at the branch and unbooked.
UPDATE public.purchases
   SET stock_status = 'on_hold'
 WHERE id = 'd52a3fc2-feea-4277-92d5-90937e31e05d'
   AND application_id = 'WGKA-95221'
   AND stock_status = 'at_branch'
   AND booking_id IS NULL;

-- Check: should return one row with stock_status = on_hold.
SELECT application_id, customer_name, branch_name, stock_status, booking_id
  FROM public.purchases WHERE application_id = 'WGKA-95221';
