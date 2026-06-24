-- ─────────────────────────────────────────────────────────────────────────────
-- razorpay_payouts — payout events captured from the RazorpayX webhook
-- (/api/razorpay-webhook). This is the ONLY place the app learns "how much
-- actually left our bank", so it never needs a money-capable Razorpay API key.
-- Read by the Billed vs Paid module; written only by the signed webhook.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS razorpay_payouts (
  payout_id         text PRIMARY KEY,          -- Razorpay payout id (pout_...)
  utr               text,                       -- bank UTR (matches the CRM final-payment UTR)
  amount            numeric,                    -- in RUPEES (webhook gives paise; we store ₹)
  status            text,                       -- processed | reversed | failed | queued | ...
  reference_id      text,                       -- App ID if the payments team stamps it on the payout
  benef_account     text,                       -- beneficiary account number (if present in the event)
  benef_ifsc        text,
  fund_account_id   text,
  notes             jsonb,                      -- arbitrary key/values (may carry the App ID)
  payout_created_at timestamptz,               -- when Razorpay created the payout
  event             text,                       -- payout.processed / payout.reversed / payout.failed
  received_at       timestamptz DEFAULT now(), -- when our webhook stored it
  raw               jsonb                       -- full event payload, for audit
);

CREATE INDEX IF NOT EXISTS idx_rzp_payouts_utr        ON razorpay_payouts (utr);
CREATE INDEX IF NOT EXISTS idx_rzp_payouts_ref        ON razorpay_payouts (reference_id);
CREATE INDEX IF NOT EXISTS idx_rzp_payouts_created_at ON razorpay_payouts (payout_created_at);

-- Service-role only (webhook + server read). No anon access.
ALTER TABLE razorpay_payouts ENABLE ROW LEVEL SECURITY;
