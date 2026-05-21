-- ─────────────────────────────────────────────────────────────────────────────
-- Bookings breakdown — store the components that make up cal_quotas.weight
-- ─────────────────────────────────────────────────────────────────────────────
-- The Bidding Volume booking modal asks the operator to build the committed
-- weight from four addends:
--
--   bills_net_weight (sum of selected bills)
--   + gain_applied   (default 3.5 % of bills, overrideable)
--   + pending        (carry-over delivery, if ticked)
--   + pipeline       (excess attributed to tomorrow's incoming)
--   + additional_gain (excess attributed to more refining gain)
--   = weight  (committed to the bidder)
--
-- Until now we only stored the final weight; the breakdown lived in the
-- notes string. This migration adds dedicated columns so the Bookings tab
-- can render a bill-style row showing every addend without parsing free
-- text. Pipeline tracking (pipeline_remaining_g / pipeline_attached_at /
-- gain_realized_g) already exists; this layer is purely the "what did the
-- operator commit, and how was it broken down" snapshot at creation time.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Breakdown columns (snapshot at create_booking time)
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS bills_net_weight_g  NUMERIC(12, 3);
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS gain_applied_g      NUMERIC(12, 3);
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pending_g           NUMERIC(12, 3);
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS additional_gain_g   NUMERIC(12, 3);
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS pipeline_original_g NUMERIC(12, 3);

COMMIT;
