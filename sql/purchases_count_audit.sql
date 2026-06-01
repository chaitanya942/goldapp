-- sql/purchases_count_audit.sql
--
-- Two-stage audit on the at-HO intake. Up to now `audited_at` +
-- `audit_gross_weight` were the only audit fields and they captured the
-- WEIGHT audit — the auditor puts the bill on the scale, the discrepancy
-- vs CRM gross is computed, and stock_status flips to at_ho.
--
-- Ops introduced a second, lighter audit step: COUNT audit. The auditor
-- can physically count the inbound packets and "mark as received" without
-- weighing each bill, then come back the next morning to weigh. This is
-- the interim "Received — audit pending" state.
--
-- Business rules (encoded in app code, not constraints here):
--   - Weight audit alone is sufficient — it implicitly proves count.
--     A bill can go straight from in_consignment to at_ho via the weigh
--     flow without ever being count-received.
--   - Count audit alone is NOT sufficient — the bill stays in_consignment
--     after count is marked. Stock_status flip to at_ho only happens on
--     successful weight audit.
--
-- Columns:
--   count_received_at  TIMESTAMPTZ  — when the count audit was done
--   count_received_by  UUID         — the auditor who did it
--
-- Both nullable; existing rows pre-feature have NULLs and behave the
-- same as before.
--
-- Idempotent (IF NOT EXISTS), safe to re-run.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS count_received_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS count_received_by  UUID;
