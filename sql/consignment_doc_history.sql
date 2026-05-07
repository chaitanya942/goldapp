-- sql/consignment_doc_history.sql
--
-- Permanent ledger of every consignment document number EVER issued by this
-- system, kept independent of the consignments table so it survives DB resets
-- (the test-cycle DELETE that wiped consignments was the trigger for the
-- 2026-05-07 NIC duplicate-DocNo incident — generateTmpPrfNo restarted at
-- WG000001 because the table was empty, NIC silently returned a stale EWB
-- for that DocNo from a prior test session).
--
-- INVARIANTS
--   - INSERT-only. Never DELETE / UPDATE rows here. The whole point is that
--     this table is the long-term memory of "what numbers have we ever used
--     on NIC's / IRP's books".
--   - tmp_prf_no UNIQUE — generateTmpPrfNo reads the max from here.
--   - One row per (tmp_prf_no) issued, even if the consignment was later
--     voided / rejected / wiped. NIC remembers it, so we must too.
--
-- WORKFLOW
--   On every successful consignment creation, insert one row capturing:
--     tmp_prf_no, challan_no, internal_no, consignment_id (NULLABLE FK),
--     movement_type, issued_at (auto-now()).
--   The FK is set to ON DELETE SET NULL so wiping consignments doesn't break
--   referential integrity here.
--
-- Apply via Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS consignment_doc_history (
  id              BIGSERIAL PRIMARY KEY,
  tmp_prf_no      TEXT UNIQUE NOT NULL,
  challan_no      TEXT,
  internal_no     TEXT,
  external_no     TEXT,
  movement_type   TEXT,
  consignment_id  UUID REFERENCES consignments(id) ON DELETE SET NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Optional debug field — useful when triaging "why did NIC return stale".
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cdh_tmp_prf_no   ON consignment_doc_history (tmp_prf_no);
CREATE INDEX IF NOT EXISTS idx_cdh_challan_no   ON consignment_doc_history (challan_no);
CREATE INDEX IF NOT EXISTS idx_cdh_internal_no  ON consignment_doc_history (internal_no);
CREATE INDEX IF NOT EXISTS idx_cdh_external_no  ON consignment_doc_history (external_no);

-- Backfill from any consignments that exist right now (so the new
-- generator immediately knows the safe floor).
INSERT INTO consignment_doc_history (tmp_prf_no, challan_no, internal_no, external_no, movement_type, consignment_id, notes)
SELECT
  c.tmp_prf_no, c.challan_no, c.internal_no, c.external_no, c.movement_type, c.id,
  'Backfilled from consignments on ' || NOW()::date
FROM consignments c
WHERE c.tmp_prf_no IS NOT NULL
ON CONFLICT (tmp_prf_no) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- ONE-TIME RECOVERY for the 2026-05-07 NIC duplicate-DocNo incident:
-- the May-3 test session burned through TMP_PRFs we don't have a record
-- of (the DB was wiped). To guarantee no future collision with NIC, seed
-- the history with a safe placeholder at WG000999. The next generated
-- TMP_PRF will be WG001000.
--
-- Adjust the placeholder to a higher number if you remember going past
-- WG000999 in any prior test cycle.
INSERT INTO consignment_doc_history (tmp_prf_no, movement_type, notes)
VALUES ('WG000999', NULL, 'Sequence reset placeholder — skip past historical NIC DocNos used during May-3 testing')
ON CONFLICT (tmp_prf_no) DO NOTHING;
