-- sql/purchases_released_at.sql
--
-- Marks a bill as freshly released back into the bookable pool by a booking
-- cancellation (app/api/consignments/route.js, action=update_booking_status).
-- Section 1 ("Bangalore today") uses this to surface a released bill under
-- TODAY's purchase-date bucket regardless of its original purchase_date or
-- whether the EOD audit had already attributed it to gain — a cancellation
-- should make a bill immediately rebookable today, not stuck under a
-- historical date ops would have no reason to look up.
--
-- Apply via Supabase SQL Editor. Idempotent.

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_purchases_released_at ON purchases(released_at) WHERE released_at IS NOT NULL;
