-- sql/audit_shift_assignments.sql
--
-- Audit Roster shift assignments. Each row pins one auditor to one shift
-- on one date. Two business rules enforced via constraints + a trigger:
--
--   1) Max 2 auditors per (shift_date, shift_type). Same auditor can't be
--      assigned to the same slot twice — that's a clean UNIQUE.
--
--   2) Same auditor cannot do BOTH a night shift on date N AND a morning
--      shift on date N+1 — the night-to-morning rotation is operationally
--      back-to-back so we forbid it. Cross-row constraint, enforced via a
--      trigger.
--
-- The 2-per-shift cap is also enforced via a trigger because Postgres has
-- no native "max N rows per group" check. App code MUST treat both
-- triggers as authoritative — the server returns the trigger's error
-- message verbatim to the UI.
--
-- shift_type values: 'night' or 'morning'.
-- shift_date is the calendar day the shift actually happens. Night is
-- worked on that date's evening; morning is worked on that date's
-- morning. So the "night N → morning N+1" pairing uses date arithmetic.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS audit_shift_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date   DATE NOT NULL,
  shift_type   TEXT NOT NULL CHECK (shift_type IN ('night', 'morning')),
  auditor_id   UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by  UUID REFERENCES user_profiles(id),
  -- Same auditor can't be assigned to the same shift twice.
  UNIQUE (shift_date, shift_type, auditor_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_shift_assignments_date_shift
  ON audit_shift_assignments(shift_date, shift_type);

CREATE INDEX IF NOT EXISTS idx_audit_shift_assignments_auditor
  ON audit_shift_assignments(auditor_id);

-- ── Trigger 1: max 2 auditors per shift slot ────────────────────────────────
CREATE OR REPLACE FUNCTION audit_shift_max_two_per_slot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM audit_shift_assignments
   WHERE shift_date = NEW.shift_date
     AND shift_type = NEW.shift_type
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'Shift already has 2 auditors assigned (% on %). Remove one before adding another.',
      NEW.shift_type, NEW.shift_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_shift_max_two ON audit_shift_assignments;
CREATE TRIGGER trg_audit_shift_max_two
  BEFORE INSERT OR UPDATE ON audit_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_shift_max_two_per_slot();

-- ── Trigger 2: no auditor on night N AND morning N+1 ────────────────────────
CREATE OR REPLACE FUNCTION audit_shift_no_back_to_back()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_conflict_date DATE;
  v_conflict_type TEXT;
BEGIN
  IF NEW.shift_type = 'night' THEN
    -- New night on date N — check this auditor isn't already on morning N+1.
    SELECT shift_date, shift_type INTO v_conflict_date, v_conflict_type
      FROM audit_shift_assignments
     WHERE auditor_id = NEW.auditor_id
       AND shift_type = 'morning'
       AND shift_date = NEW.shift_date + INTERVAL '1 day'
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
     LIMIT 1;
  ELSIF NEW.shift_type = 'morning' THEN
    -- New morning on date N — check this auditor isn't on night N-1.
    SELECT shift_date, shift_type INTO v_conflict_date, v_conflict_type
      FROM audit_shift_assignments
     WHERE auditor_id = NEW.auditor_id
       AND shift_type = 'night'
       AND shift_date = NEW.shift_date - INTERVAL '1 day'
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
     LIMIT 1;
  END IF;
  IF v_conflict_date IS NOT NULL THEN
    RAISE EXCEPTION 'Auditor is already on the % shift of %, which is back-to-back with this slot. Same auditor cannot run night and the next morning.',
      v_conflict_type, v_conflict_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_shift_no_back_to_back ON audit_shift_assignments;
CREATE TRIGGER trg_audit_shift_no_back_to_back
  BEFORE INSERT OR UPDATE ON audit_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_shift_no_back_to_back();

-- ── RLS — authenticated users can read; service-role writes from API ────────
ALTER TABLE audit_shift_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_assignments_read ON audit_shift_assignments;
CREATE POLICY shift_assignments_read
  ON audit_shift_assignments FOR SELECT
  TO authenticated
  USING (true);
