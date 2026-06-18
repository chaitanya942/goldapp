-- ─────────────────────────────────────────────────────────────────────────────
-- Migration — new-CRM application_id  WGKAXXXX → WGKA-XXXX
-- ─────────────────────────────────────────────────────────────────────────────
-- Goal: new-CRM bills carry the source's NATIVE hyphenated code (WGKA-XXXX) so
-- they no longer collide with old-CRM bills (WGKAXXXX). Rule is purely by
-- crm_source:
--     crm_source='old_crm' → WGKAXXXX   (untouched — incl. the 7 15-Jun old bills)
--     crm_source='new_crm' → WGKA-XXXX  (this migration)
--
-- ORDER OF OPERATIONS (important):
--   1. DEPLOY the code change first (sync writers now emit WGKA-XXXX) and wait
--      until it is LIVE on Railway.
--   2. THEN run this script.
-- While the OLD code is live it writes WGKAXXXX and matches the existing bare
-- rows (no dupes). Once the NEW code is live it writes WGKA-XXXX; until this
-- migration renames the bare rows, a cron tick could INSERT a fresh hyphenated
-- twin. STEP 2 below cleans up exactly those fresh twins, so the script is
-- SELF-HEALING and safe to re-run.
--
-- Only purchases.application_id changes. consignment_items / bookings key on the
-- purchase UUID (id), not application_id, so nothing downstream needs touching.
--
-- Wrapped in BEGIN/COMMIT. Run STEP 0 preview first; if a unique-violation rolls
-- it back (rare: both twins carry real state), fix that pair by hand and re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0) Preview — what will change ────────────────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE application_id ~ '^WGKA[0-9]')                       AS bare_to_rename,
  COUNT(*) FILTER (WHERE application_id LIKE 'WGKA-%')                        AS already_hyphenated,
  COUNT(*) FILTER (WHERE application_id ~ '^WGKA[0-9]'
                   AND EXISTS (SELECT 1 FROM purchases q
                               WHERE q.crm_source='new_crm'
                                 AND q.application_id = 'WGKA-' || substring(purchases.application_id from 5)
                                 AND q.id <> purchases.id))                   AS race_twins_present
  FROM purchases
 WHERE crm_source = 'new_crm' AND is_deleted = false;

-- ── 1) Remove race-created hyphenated DUPLICATES (fresh, no operational state)
--      i.e. a WGKA-XXXX new_crm row that a cron tick inserted after the new code
--      went live, while its stateful bare twin (WGKAXXXX) still existed. Only
--      delete ones that are clearly fresh (default state, no booking/dispatch/
--      receipt/audit), so we never drop a row that has real operational state. ─
DELETE FROM purchases h
 WHERE h.crm_source     = 'new_crm'
   AND h.application_id LIKE 'WGKA-%'
   AND h.stock_status     = 'at_branch'
   AND h.booking_id       IS NULL
   AND h.dispatched_at    IS NULL
   AND h.received_at      IS NULL
   AND h.audit_consumed_at IS NULL
   AND EXISTS (
     SELECT 1 FROM purchases b
      WHERE b.crm_source     = 'new_crm'
        AND b.id <> h.id
        AND b.application_id = 'WGKA' || substring(h.application_id from 6)  -- bare twin
   );

-- ── 2) Rename the bare new_crm rows  WGKAXXXX → WGKA-XXXX ─────────────────────
UPDATE purchases
   SET application_id = 'WGKA-' || substring(application_id from 5)
 WHERE crm_source     = 'new_crm'
   AND application_id ~ '^WGKA[0-9]';        -- bare WGKA followed by a digit only

-- ── 3) Verify — every new_crm row should now be hyphenated; zero bare left ───
SELECT
  COUNT(*)                                              AS new_crm_total,
  COUNT(*) FILTER (WHERE application_id LIKE 'WGKA-%')   AS hyphenated,
  COUNT(*) FILTER (WHERE application_id ~ '^WGKA[0-9]')  AS still_bare_should_be_0
  FROM purchases
 WHERE crm_source = 'new_crm' AND is_deleted = false;

-- ── 4) Safety — confirm old_crm is completely untouched (no WGKA- bare→hyphen)
--      Expect: the same 8 ancient WGKA-XXXX stragglers, nothing new. ──────────
SELECT COUNT(*) AS old_crm_wgka_hyphen_should_stay_8
  FROM purchases
 WHERE crm_source = 'old_crm' AND application_id LIKE 'WGKA-%';

COMMIT;
