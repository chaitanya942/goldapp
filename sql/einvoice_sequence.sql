-- ─────────────────────────────────────────────────────────────────────────────
-- Per-state E-Invoice document numbering
-- ─────────────────────────────────────────────────────────────────────────────
-- E-Invoices ship with DocDtls.No = 'WG/{STATE}/{FY}/{SEQ}', e.g.
-- 'WG/KL/26-27/53'. Sequence resets every fiscal year per state. Issued for
-- non-KA, non-INTERNAL movements (KL/TS/AP source → KA HO buyer).
--
-- Storage: einvoice_sequence(state_code, fy_code, last_seq).
-- Atomic increment: next_einvoice_seq(state, fy) → INT (the just-issued seq).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Counter table — one row per (state, fy).
CREATE TABLE IF NOT EXISTS einvoice_sequence (
  state_code TEXT NOT NULL,
  fy_code    TEXT NOT NULL,                              -- e.g. '26-27'
  last_seq   INT  NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (state_code, fy_code)
);

-- 2. Atomic 'get next + commit' RPC. UPSERT semantics — first call for a
--    (state, fy) pair lands seq=1; subsequent calls increment. Race-safe
--    under concurrent E-Invoice generation thanks to PK uniqueness +
--    ON CONFLICT serialisation.
CREATE OR REPLACE FUNCTION next_einvoice_seq(p_state TEXT, p_fy TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq INT;
BEGIN
  INSERT INTO einvoice_sequence (state_code, fy_code, last_seq, updated_at)
  VALUES (p_state, p_fy, 1, NOW())
  ON CONFLICT (state_code, fy_code) DO UPDATE
    SET last_seq   = einvoice_sequence.last_seq + 1,
        updated_at = NOW()
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END $$;

GRANT EXECUTE ON FUNCTION next_einvoice_seq(TEXT, TEXT) TO authenticated, service_role;

-- 3. Seed the three states for FY 26-27 with last-issued numbers from the
--    physical book. Next call to next_einvoice_seq('KL','26-27') will return 53.
INSERT INTO einvoice_sequence (state_code, fy_code, last_seq) VALUES
  ('KL', '26-27', 52),
  ('TS', '26-27', 28),
  ('AP', '26-27', 62)
ON CONFLICT (state_code, fy_code) DO UPDATE
  SET last_seq = EXCLUDED.last_seq, updated_at = NOW();

-- 4. Add einvoice_doc_no column on consignments to store the issued number
--    (so the audit trail and Credit Note PrecDocDtls reference can read it).
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS einvoice_doc_no TEXT;

COMMIT;

-- Verification — should print the seeded last values per state.
SELECT state_code, fy_code, last_seq,
       'WG/' || state_code || '/' || fy_code || '/' || (last_seq + 1) AS next_will_be
FROM einvoice_sequence
ORDER BY state_code;
