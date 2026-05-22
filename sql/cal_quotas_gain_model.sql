-- ─────────────────────────────────────────────────────────────────────────────
-- Booking gain model — derive gain from net weight, kill overshoot
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PROBLEM this fixes: gain was stored as drifting addends
-- (gain_applied + gain_realized + additional_gain). Pipeline overshoot —
-- the auto-attacher filling a 10 g gap with a 50 g bill and dumping the
-- 40 g excess into gain_realized — inflated gain well past the real
-- 3-3.5 % refining margin (84 g on 1395 g net = 6 %).
--
-- THE MODEL now:
--   gain_rate          : 3.5 % default (0 for Kerala)            ← stored
--   target_net         = bid_weight / (1 + gain_rate)            ← bills needed
--   sourced_net        = SUM(attached bills) + pending_g         ← derived
--
--   while arrival_date >= today  (booking still live):
--     gain     = sourced_net * gain_rate          → always exactly the rate
--     pipeline = bid_weight - sourced_net * (1 + gain_rate)   → uncovered commitment
--
--   once arrival_date < today  (settled — EOD leftover folds in):
--     gain     = bid_weight - sourced_net          → clean gain + tiny leftover
--     pipeline = 0
--
-- Auto-attach NEVER overshoots: a bill bigger than the remaining gap
-- (target_net - sourced_net) is skipped and left unbooked, so it stays
-- available for Section 1/4 or another booking. Overshoot is now
-- structurally impossible — gain_realized is dead.
--
-- gain + pipeline are DERIVED everywhere (API computes them); only
-- gain_rate is added as a stored column. close_stale_pipelines() and
-- audit_daily_gain() are no longer called by the sync worker — gain is
-- exact, nothing to close or redistribute. The functions are left in
-- place (harmless) for rollback safety.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── gain_rate column ────────────────────────────────────────────────────────
ALTER TABLE cal_quotas ADD COLUMN IF NOT EXISTS gain_rate NUMERIC(6, 4);

-- Backfill: Kerala bookings 0 %, everything else the 3.5 % standard.
UPDATE cal_quotas
   SET gain_rate = CASE WHEN is_kl THEN 0 ELSE 0.035 END
 WHERE gain_rate IS NULL;

ALTER TABLE cal_quotas ALTER COLUMN gain_rate SET DEFAULT 0.035;


-- ── Rewritten auto-attacher — no-overshoot, target-net based ────────────────
-- For each live booking (arrival_date >= today, region Bangalore/Kerala):
--   target_net  = weight / (1 + gain_rate)
--   sourced_net = SUM(attached bill net_weight) + COALESCE(pending_g, 0)
--   gap         = target_net - sourced_net
-- Attach eligible bills FIFO, but ONLY a bill whose net_weight <= gap.
-- A bill too big to fit is skipped (stays unbooked). Stop when gap closes
-- or no fitting bill remains. No gain_realized, no overshoot.
--
-- DROP first — the return signature changed (overshoot_g column removed),
-- and CREATE OR REPLACE can't alter an existing function's return type.
DROP FUNCTION IF EXISTS process_pipeline_attachments();
CREATE OR REPLACE FUNCTION process_pipeline_attachments()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC
) AS $$
DECLARE
  booking        RECORD;
  bill           RECORD;
  gap            NUMERIC;
  rate           NUMERIC;
  target_net     NUMERIC;
  sourced_net    NUMERIC;
  attached_count INT;
  attached_wt    NUMERIC;
  expected_pdate DATE;
  kerala_hubs    TEXT[];
  today_ist      DATE;
BEGIN
  today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT array_agg(name) INTO kerala_hubs
    FROM branches
   WHERE region = 'Kerala' AND is_hub = true;

  FOR booking IN
    SELECT q.id, q.weight, q.pending_g, q.gain_rate,
           q.pipeline_region, q.pipeline_arrival_date
      FROM cal_quotas q
     WHERE q.status = 'booked'
       AND q.pipeline_arrival_date IS NOT NULL
       AND q.pipeline_arrival_date >= today_ist          -- live bookings only
       AND q.pipeline_region IN ('Bangalore', 'Kerala')
     ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    rate        := COALESCE(booking.gain_rate, 0.035);
    target_net  := booking.weight / (1 + rate);
    SELECT COALESCE(SUM(p.net_weight), 0) INTO sourced_net
      FROM purchases p WHERE p.booking_id = booking.id;
    sourced_net := sourced_net + COALESCE(booking.pending_g, 0);
    gap         := target_net - sourced_net;

    IF gap <= 0 THEN
      CONTINUE;                                          -- already fully sourced
    END IF;

    attached_count := 0;
    attached_wt    := 0;
    expected_pdate := booking.pipeline_arrival_date - INTERVAL '1 day';

    IF booking.pipeline_region = 'Bangalore' THEN
      FOR bill IN
        SELECT p.id, p.net_weight
          FROM purchases p
          JOIN branches b ON b.name = p.branch_name
         WHERE p.booking_id IS NULL
           AND p.is_deleted = false
           AND p.crm_status = 'approved'
           AND b.region    = 'Bangalore'
           AND p.purchase_date = expected_pdate
         ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC
         FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN gap <= 0;
        CONTINUE WHEN bill.net_weight > gap;             -- too big → skip, leave unbooked
        UPDATE purchases SET booking_id = booking.id, booked_at = now() WHERE id = bill.id;
        attached_count := attached_count + 1;
        attached_wt    := attached_wt + bill.net_weight;
        gap            := gap - bill.net_weight;
        INSERT INTO cal_quota_pipeline_attachments
          (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
        VALUES (booking.id, bill.id, bill.net_weight, gap + bill.net_weight, GREATEST(0, gap), 0, 'auto_attach');
      END LOOP;

    ELSIF booking.pipeline_region = 'Kerala' THEN
      IF kerala_hubs IS NOT NULL AND array_length(kerala_hubs, 1) > 0 THEN
        FOR bill IN
          SELECT p.id, p.net_weight
            FROM purchases p
            JOIN branches b ON b.name = p.branch_name
           WHERE p.booking_id IS NULL
             AND p.is_deleted = false
             AND p.crm_status = 'approved'
             AND b.region = 'Kerala'
             AND p.current_branch = ANY(kerala_hubs)
             AND p.stock_status = 'at_branch'
           ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC
           FOR UPDATE SKIP LOCKED
        LOOP
          EXIT WHEN gap <= 0;
          CONTINUE WHEN bill.net_weight > gap;           -- too big → skip
          UPDATE purchases SET booking_id = booking.id, booked_at = now() WHERE id = bill.id;
          attached_count := attached_count + 1;
          attached_wt    := attached_wt + bill.net_weight;
          gap            := gap - bill.net_weight;
          INSERT INTO cal_quota_pipeline_attachments
            (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
          VALUES (booking.id, bill.id, bill.net_weight, gap + bill.net_weight, GREATEST(0, gap), 0, 'auto_attach');
        END LOOP;
      END IF;
    END IF;

    IF attached_count > 0 THEN
      -- pipeline_remaining_g kept in sync as a cache for any legacy reader;
      -- the API derives pipeline fresh, but writing it keeps old views sane.
      UPDATE cal_quotas
         SET pipeline_remaining_g = GREATEST(0, gap),
             pipeline_attached_at = now()
       WHERE id = booking.id;
      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_wt;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;

COMMIT;
