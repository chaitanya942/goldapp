-- ─────────────────────────────────────────────────────────────────────────────
-- Bangalore Section 1 — end-of-day audit columns + log table
-- ─────────────────────────────────────────────────────────────────────────────
-- At 23:30 IST every day, the system reconciles Bangalore-today bills that
-- never got booked into a customer order. The audit:
--
--   1. Re-runs the auto-attacher to sweep any stragglers into open bookings
--      whose pipeline_remaining_g > 0.
--   2. For Section 1 bills still booking_id=null and audit_hold=false,
--      stamps audit_consumed_at + audit_attributed_to='gain'. They're now
--      explicitly attributed to refinery gain — no fake booking row, just
--      a flag that lifts them out of "booking_id=null limbo".
--   3. Writes a one-row summary into bidding_audit_log so we have a daily
--      audit trail (date, swept_count, attributed_count, total_grams, etc).
--
-- Ops can pre-empt the audit per bill via the audit_hold flag — the bill
-- stays in the bidding picker but is excluded from the EOD sweep, rolling
-- forward to whichever future bid the operator wants.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── purchases: three audit columns ──────────────────────────────────────────
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS audit_consumed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_attributed_to   TEXT,
  ADD COLUMN IF NOT EXISTS audit_hold            BOOLEAN NOT NULL DEFAULT false;

-- Lookup index for "what did the audit consume?" queries (per-day or in
-- general). Partial — vast majority of rows are NULL on this column.
CREATE INDEX IF NOT EXISTS idx_purchases_audit_consumed_at
  ON purchases (audit_consumed_at)
  WHERE audit_consumed_at IS NOT NULL;

-- ── bidding_audit_log: one row per daily run ────────────────────────────────
CREATE TABLE IF NOT EXISTS bidding_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_date            DATE NOT NULL UNIQUE,             -- IST date the audit ran for
  ran_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Sweep pass: bills the auto-attacher claimed into existing open bookings.
  swept_count           INTEGER NOT NULL DEFAULT 0,
  swept_net_wt          NUMERIC(14, 3) NOT NULL DEFAULT 0,
  -- Reconciliation pass: bills attributed to refinery gain (no booking).
  attributed_count      INTEGER NOT NULL DEFAULT 0,
  attributed_net_wt     NUMERIC(14, 3) NOT NULL DEFAULT 0,
  -- Held-from-audit (operator's audit_hold flag) — surfaced for visibility.
  held_count            INTEGER NOT NULL DEFAULT 0,
  held_net_wt           NUMERIC(14, 3) NOT NULL DEFAULT 0,
  -- Free-form notes / errors — JSON object so future audits can add fields
  -- without a schema change.
  details               JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bidding_audit_log_date
  ON bidding_audit_log (audit_date DESC);

COMMIT;
