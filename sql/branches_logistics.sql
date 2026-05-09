-- ─────────────────────────────────────────────────────────────────────────────
-- Per-branch logistics configuration
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds columns to the branches table that drive the new Admin → Logistics
-- module. branches.pickup_time already exists (used by the pickup reminder
-- banner in the consignment data picker); this migration adds the rest.
--
-- Idempotent: every column add uses IF NOT EXISTS, every backfill is gated
-- on the existing value being NULL.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Logistics partner (BVC for everyone today; other couriers may come later).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logistics_partner TEXT;

-- Delivery TAT — usual values are 24, 48, 72 hours from pickup → HO arrival.
-- Stored in hours (not as 'next-day' strings) so reports can math against it.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS delivery_tat_hours INT;

-- Pickup days — array of 3-letter day codes. Default = Mon-Sat (Sunday off).
-- Couriers also skip public holidays; the operator can edit this per-branch
-- when a regional festival happens.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS pickup_days TEXT[];

-- Contact info for the courier-branch handler — for escalation when a pickup
-- goes wrong. Separate from the BRANCH contact_person/phone (which is the
-- White Gold staff member).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logistics_contact_name TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logistics_contact_phone TEXT;

-- Free-form notes. Real branches have edge cases ('double pickup on Mondays',
-- 'closed on Onam', etc.).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logistics_notes TEXT;

-- Backfill defaults for existing rows so the Logistics page shows sensible
-- starting values.
UPDATE branches SET logistics_partner   = 'BVC' WHERE logistics_partner   IS NULL;
UPDATE branches SET delivery_tat_hours  = 24    WHERE delivery_tat_hours  IS NULL;
UPDATE branches SET pickup_days         = ARRAY['Mon','Tue','Wed','Thu','Fri','Sat']
                                                WHERE pickup_days         IS NULL;

COMMIT;

-- Verification — count of branches with each field populated.
SELECT
  COUNT(*)                                                    AS total_branches,
  COUNT(*) FILTER (WHERE logistics_partner   IS NOT NULL)     AS with_partner,
  COUNT(*) FILTER (WHERE pickup_time         IS NOT NULL)     AS with_pickup_time,
  COUNT(*) FILTER (WHERE delivery_tat_hours  IS NOT NULL)     AS with_tat,
  COUNT(*) FILTER (WHERE pickup_days         IS NOT NULL)     AS with_days
FROM branches
WHERE is_active = true;
