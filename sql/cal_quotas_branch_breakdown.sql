-- sql/cal_quotas_branch_breakdown.sql
--
-- Snapshot of a booking's branch-level sourcing, captured at cancellation
-- time (app/api/consignments/route.js, action=update_booking_status) right
-- before its attached bills are released (purchases.booking_id nulled out).
-- That release destroys the only link between a booking and which branches
-- sourced it, so without this snapshot a cancelled booking's composition is
-- unrecoverable. Powers the "Rebook" action, which resegments this same
-- branch-level breakdown back into the bidding/source-picker view.
--
-- Shape: [{ "branch": "KA-TUMKUR", "net_weight_g": 1234.56 }, ...]
--
-- Apply via Supabase SQL Editor. Idempotent.

ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS cancelled_branch_breakdown JSONB;
