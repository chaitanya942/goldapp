-- sql/user_allowed_regions.sql
--
-- Region-scoped data access for non-admin roles.
--
-- Adds an `allowed_regions` text array on user_profiles. Empty / NULL means
-- no restriction (the user sees everything — same behavior as today). When
-- populated, all data routes filter source-branch by region so a regional
-- user (e.g. Kerala management) only sees their region's branches, bills,
-- consignments, reports, etc.
--
-- super_admin / founders_office / admin always bypass this filter — they
-- need org-wide visibility for operations safety.
--
-- Apply via Supabase SQL Editor. Idempotent.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS allowed_regions TEXT[] DEFAULT NULL;

-- Helpful index for membership checks (rarely-touched column, but cheap).
CREATE INDEX IF NOT EXISTS idx_user_profiles_allowed_regions
  ON user_profiles USING GIN (allowed_regions);
