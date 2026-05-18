-- ── Bidding: Pending Delivery carry-over ──────────────────────────────────────
-- Shared (not per-device) signed adjustment to a given arrival date's
-- available pool. Represents gold that was expected for an earlier booking
-- cycle but slipped due to uncertain events and now carries into this date —
-- positive (delayed gold finally rolling in) or negative (something pulled
-- back). One row per arrival_date; the whole ops team books against the same
-- number so it MUST be server-side, not localStorage like the Gain override.
--
-- pending_grams is intentionally NOT constrained to >= 0 — the +/- behaviour
-- is the whole point.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS bidding_pending_delivery (
  arrival_date  DATE        PRIMARY KEY,
  pending_grams NUMERIC     NOT NULL DEFAULT 0,
  note          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);

COMMENT ON TABLE  bidding_pending_delivery            IS 'Per-arrival-date signed carry-over (Pending Delivery) for the Bidding Volume pool. Set/read via /api/consignments?action=bidding_volume and action=set_bidding_pending.';
COMMENT ON COLUMN bidding_pending_delivery.pending_grams IS 'Signed grams. + = delayed gold rolling into this date; - = reduction. No sign constraint by design.';
