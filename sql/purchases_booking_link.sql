-- ─────────────────────────────────────────────────────────────────────────────
-- Link purchases to bidding bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- The Bidding Volume module commits incoming gold to buyers. Each booking
-- now points back to the specific bills that fulfil it via the new
-- booking_id column. Two consequences:
--
--   1. Bills with booking_id != NULL are excluded from the bidding pool —
--      they're already promised to a buyer and shouldn't show up as
--      available supply on subsequent visits to the page.
--
--   2. Cancelling a booking nulls the link out, releasing the bills back
--      to the pool.
--
-- Migration safety: default = NULL. Every existing bill stays "unbooked"
-- so the bidding view's behaviour is preserved as this column rolls out.
-- Only new bookings created via Bidding Volume mark bills going forward.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS booking_id UUID;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS booked_at  TIMESTAMPTZ;

-- Partial index — only rows that are actually booked are queried by
-- booking_id. Keeps the index lean on a large purchases table.
CREATE INDEX IF NOT EXISTS idx_purchases_booking_id
  ON purchases(booking_id) WHERE booking_id IS NOT NULL;

COMMIT;

-- Verification: count of bills booked vs unbooked.
SELECT
  COUNT(*) FILTER (WHERE booking_id IS NULL)     AS unbooked,
  COUNT(*) FILTER (WHERE booking_id IS NOT NULL) AS booked,
  COUNT(*)                                       AS total
FROM purchases;
