-- ─────────────────────────────────────────────────────────────────────────────
-- Add purchases.received_at — per-bill timestamp of when the bill transitioned
-- in_consignment → at_ho (received at Head Office).
-- ─────────────────────────────────────────────────────────────────────────────
-- Why: parallel to purchases.dispatched_at (which captures at_branch →
-- in_consignment). Going forward, the receive route stamps both columns on
-- the consignment 'Receive' action, so accounts can see end-to-end transit
-- time per bill without joining through consignment_items every time.
--
-- Backfill: pulls from consignment_items.received_at — the existing source of
-- truth for per-item receive timestamps. For any bill that was received in
-- multiple consignments historically (rare, but possible after a cancel +
-- re-consign), takes the MOST RECENT received_at.
--
-- Idempotent: ALTER uses IF NOT EXISTS; backfill UPDATEs only rows whose
-- received_at is currently NULL but where stock_status='at_ho' AND a
-- consignment_items.received_at exists.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add the column.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- 2. Backfill from consignment_items.received_at — most recent per bill.
WITH latest AS (
  SELECT
    ci.purchase_id,
    MAX(ci.received_at) AS received_at
  FROM consignment_items ci
  WHERE ci.received_at IS NOT NULL
  GROUP BY ci.purchase_id
)
UPDATE purchases p
SET received_at = l.received_at
FROM latest l
WHERE p.id = l.purchase_id
  AND p.received_at IS NULL
  AND p.stock_status = 'at_ho';

COMMIT;

-- Verification — every at_ho bill should now carry a received_at.
SELECT
  COUNT(*)                                              AS at_ho_total,
  COUNT(*) FILTER (WHERE received_at IS NOT NULL)       AS with_received_at,
  COUNT(*) FILTER (WHERE received_at IS NULL)           AS without_received_at
FROM purchases
WHERE stock_status = 'at_ho';
