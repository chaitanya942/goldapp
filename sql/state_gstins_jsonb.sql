-- ─────────────────────────────────────────────────────────────────────────────
-- Per-state GSTIN map as JSONB on company_settings
-- ─────────────────────────────────────────────────────────────────────────────
-- Until now, per-state GSTINs lived in fixed columns (gstin_ka, gstin_kl,
-- gstin_ts, gstin_ap). Adding a new state required a schema migration.
--
-- This script introduces company_settings.state_gstins (JSONB) as the
-- canonical store. Adding a new state is now a JSON key insert via the
-- Settings UI — no DB change needed.
--
-- Backwards compatible:
--   - The fixed gstin_* columns are kept and will continue to be written
--     by the existing edit endpoints (so legacy code paths reading
--     companySettings.gstin_kl etc. don't break).
--   - state_gstins is the source of truth for new code paths and the UI.
--
-- Idempotent: safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add the JSONB column with a sensible empty default.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS state_gstins JSONB DEFAULT '{}'::jsonb NOT NULL;

-- 2. Backfill from existing fixed columns. Only writes a key when the column
--    has a non-empty value, so we don't pollute the map with empty strings.
--    COALESCE preserves any keys already present.
UPDATE company_settings
SET state_gstins = COALESCE(state_gstins, '{}'::jsonb)
                 || (CASE WHEN gstin_ka IS NOT NULL AND gstin_ka <> '' THEN jsonb_build_object('KA', gstin_ka) ELSE '{}'::jsonb END)
                 || (CASE WHEN gstin_kl IS NOT NULL AND gstin_kl <> '' THEN jsonb_build_object('KL', gstin_kl) ELSE '{}'::jsonb END)
                 || (CASE WHEN gstin_ts IS NOT NULL AND gstin_ts <> '' THEN jsonb_build_object('TS', gstin_ts) ELSE '{}'::jsonb END)
                 || (CASE WHEN gstin_ap IS NOT NULL AND gstin_ap <> '' THEN jsonb_build_object('AP', gstin_ap) ELSE '{}'::jsonb END);

COMMIT;

-- Verification — print the resulting state_gstins map.
SELECT id, state_gstins
FROM company_settings;
