-- ─────────────────────────────────────────────────────────────────────────────
-- MDM — allow ANY login identifier (username), not just email
-- ─────────────────────────────────────────────────────────────────────────────
-- The IT admin can now create users whose login is a name / employee id / phone
-- / email — anything. Supabase Auth still needs an email internally, so each
-- user keeps an `email` (real if provided, otherwise a synthetic @mdm.local one)
-- and logs in with their `username`. Login resolves username → email server-side.
--
-- Existing users keep working: username backfills to their email, so they can
-- still sign in with the email they already have.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE mdm_users ADD COLUMN IF NOT EXISTS username TEXT;

-- Backfill so current users (e.g. the IT admin) can log in with their email.
UPDATE mdm_users SET username = email WHERE username IS NULL OR username = '';

-- Case-insensitive uniqueness on the login identifier.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mdm_users_username_lower ON mdm_users (lower(username));

COMMIT;
