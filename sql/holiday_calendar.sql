-- ─────────────────────────────────────────────────────────────────────────────
-- holiday_calendar — statewise holiday list feeding the dashboard projection
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose:
--   - Powers Admin → Calendar (UI for marking holidays per state).
--   - Read by dashboard run-rate + monthly closure math: a day is treated as
--     a non-working day for a branch if its state has a row for that date
--     (or an 'All India' row exists). Sundays are excluded by the dashboard
--     code separately — they don't live in this table.
--
-- Schema:
--   - holiday_date : the calendar day (DATE, no timezone shenanigans)
--   - state        : 'Karnataka' | 'Andhra Pradesh' | 'Telangana' | 'Kerala'
--                  | 'All India' (wildcard — applies to every state)
--   - description  : ops-facing label, e.g. 'Republic Day', 'Karnataka Rajyotsava'
--   - is_active    : soft toggle so admin can pause an entry without deleting
--                    (and so future Karnataka-only edits don't lose history).
--   - created_at / created_by / updated_at / updated_by : audit trail.
--
-- Unique constraint on (holiday_date, state) so:
--   - The same date can be marked for multiple states (one row each).
--   - The same date can have one 'All India' wildcard row + state-specific
--     overrides if needed (unlikely but legal).
--   - Cannot accidentally duplicate the same (date, state) pair.
--
-- Indexes:
--   - (holiday_date) — dashboard's hot path: "what holidays on date D?"
--   - (state, holiday_date) — admin filter path: "show me Kerala 2026"
--   - Both partial on is_active = true so soft-deleted rows don't bloat the
--     index for lookups.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS holiday_calendar (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE        NOT NULL,
  state        TEXT        NOT NULL,
  description  TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT holiday_calendar_state_check CHECK (
    state IN ('Karnataka', 'Andhra Pradesh', 'Telangana', 'Kerala', 'All India')
  ),
  UNIQUE (holiday_date, state)
);

CREATE INDEX IF NOT EXISTS idx_holiday_calendar_date
  ON holiday_calendar (holiday_date)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_holiday_calendar_state_date
  ON holiday_calendar (state, holiday_date)
  WHERE is_active = TRUE;

-- updated_at maintenance trigger — keeps audit trail honest without forcing
-- every API write to remember to set it.
CREATE OR REPLACE FUNCTION holiday_calendar_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_holiday_calendar_touch_updated_at ON holiday_calendar;
CREATE TRIGGER trg_holiday_calendar_touch_updated_at
  BEFORE UPDATE ON holiday_calendar
  FOR EACH ROW
  EXECUTE FUNCTION holiday_calendar_touch_updated_at();

GRANT SELECT ON holiday_calendar TO authenticated;
-- Writes go through the API (service role) so we don't need direct write
-- grants on the table itself; the API does the role gating.

COMMIT;
