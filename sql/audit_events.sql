-- sql/audit_events.sql
--
-- One row per audit ACTION. Previously purchases.audit_gross_weight /
-- audited_at / audit_remark were overwritten on every re-audit, so the
-- history of attempts was lost. This table captures each attempt so the
-- Audit Report can show "first audit" + "re-audited" columns side by side,
-- and so future audit analytics have a real event log to work from.
--
-- An audit action is one of:
--   keep_pending  → auditor weighed and chose NOT to flip the bill
--                   (discrepancy still open, awaiting follow-up).
--   receive       → auditor weighed and flipped the bill to at_ho
--                   (either exact match, or accepted with remark).
--
-- crm_gross_weight is snapshotted at audit time so a later edit to CRM
-- gross doesn't retroactively change historical discrepancies.
--
-- Idempotent. Safe to re-run. Backfill block at the bottom copies the
-- LATEST audit on every audited bill that doesn't already have an event
-- row — so existing data shows up under "first audit" until a re-audit
-- actually happens.

CREATE TABLE IF NOT EXISTS audit_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id         UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  action              TEXT NOT NULL CHECK (action IN ('keep_pending', 'receive')),
  audit_gross_weight  NUMERIC(10,3),
  crm_gross_weight    NUMERIC(10,3),
  discrepancy_g       NUMERIC(10,3),
  remark              TEXT,
  audited_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audited_by          UUID
);

CREATE INDEX IF NOT EXISTS idx_audit_events_purchase   ON audit_events(purchase_id, audited_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_audited_at ON audit_events(audited_at DESC);

-- RLS: authenticated users can read; service role writes from API.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_read ON audit_events;
CREATE POLICY audit_events_read
  ON audit_events FOR SELECT
  TO authenticated
  USING (true);

-- ── Backfill — one event row per currently-audited bill ─────────────────────
-- Use the bill's last-known audit fields. New audits going forward will
-- insert their own rows from the API.
INSERT INTO audit_events (purchase_id, action, audit_gross_weight, crm_gross_weight, discrepancy_g, remark, audited_at, audited_by)
SELECT p.id,
       CASE WHEN p.stock_status = 'at_ho' THEN 'receive' ELSE 'keep_pending' END,
       p.audit_gross_weight,
       p.gross_weight,
       p.audit_discrepancy_g,
       p.audit_remark,
       p.audited_at,
       p.audited_by
  FROM purchases p
 WHERE p.audited_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM audit_events ae WHERE ae.purchase_id = p.id);
