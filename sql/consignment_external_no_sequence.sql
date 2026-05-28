-- ─────────────────────────────────────────────────────────────────────────────
-- Eliminate the read-then-write race on consignment_no
-- ─────────────────────────────────────────────────────────────────────────────
-- lib/consignmentUtils.js#generateExternalNo used to be:
--   SELECT MAX(external_no) + 1   →   INSERT
-- which races under concurrent creates — two users see the same max and
-- generate the same number, the second INSERT trips the unique constraint
-- on consignments.consignment_no. The retry loop in the API recovers from
-- this most of the time, but the race itself is the right thing to fix.
--
-- This migration introduces a Postgres SEQUENCE seeded from the current max,
-- and a thin wrapper function that returns the next 6-digit padded value.
-- Sequence nextval() is atomic at the engine level — collisions are
-- impossible regardless of concurrency. The trade-off: cancelled consignments
-- no longer "release" their number back into the pool, so gaps appear in the
-- sequence over time. For tax-doc auditability this is actually desirable.
--
-- Idempotent: re-running advances setval to MAX(actual external_no) without
-- regenerating duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Sequence — start at 1 conceptually; setval below re-aligns it to the
--    current data immediately so we never hand out a value below MAX.
CREATE SEQUENCE IF NOT EXISTS consignment_external_no_seq START 1 INCREMENT 1;

-- 2. Re-align to the current max so the next nextval() returns max+1.
--    setval(..., is_called=true) makes the next nextval() return value+1.
--    The MAX query coerces external_no via regex so any stray non-numeric
--    values don't break parse — they just count as 0 for the max.
DO $$
DECLARE
  current_max INT;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(external_no, '\D', '', 'g'), '')::int), 0)
    INTO current_max
  FROM consignments
  WHERE external_no IS NOT NULL
    AND status != 'seed';
  -- Floor at 1904 (the old EXT_NO_SEED) so we never go backwards on a fresh DB.
  PERFORM setval('consignment_external_no_seq', GREATEST(1904, current_max), true);
END $$;

-- 3. Wrapper function the app calls instead of doing SELECT MAX in JS.
--    Returns the next external_no as a 6-digit zero-padded text value
--    (matches the existing format the challan template expects).
CREATE OR REPLACE FUNCTION next_consignment_external_no()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT LPAD(nextval('consignment_external_no_seq')::text, 6, '0');
$$;

GRANT EXECUTE ON FUNCTION next_consignment_external_no() TO authenticated, service_role;

COMMIT;
