-- ─────────────────────────────────────────────────────────────────────────────
-- Pipeline Phase 3 — region-specific auto-attach (Bangalore + Kerala)
-- ─────────────────────────────────────────────────────────────────────────────
-- Bangalore and Kerala have different definitions of "pipeline":
--
--   Bangalore: future bills purchased TODAY that haven't synced from the
--              CRM yet. As they sync in, they back-fill the booking.
--              Match rule → purchase_date = arrival_date - 1 day,
--                          region = 'Bangalore', any stock_status.
--
--   Kerala:    bills that physically arrive at one of the Kerala hubs
--              (KL-VENNALA-BY-PASS, KL-THRISSUR) during the day via the
--              normal leaf → hub consolidation flow. The bill was already
--              in the system (purchased on any prior day); it just wasn't
--              at the hub yet. The auto-attacher fires when it lands at
--              the hub.
--              Match rule → current_branch IN (Kerala hubs),
--                          stock_status = 'at_branch',
--                          region = 'Kerala' (i.e. originating leaf is Kerala).
--
-- Both flows still:
--   · FIFO by purchase_date (oldest first)
--   · respect booking_id IS NULL (don't double-claim)
--   · respect FOR UPDATE SKIP LOCKED (concurrent attach safety)
--   · log every attach into cal_quota_pipeline_attachments
--   · credit overshoot to gain_realized_g
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION process_pipeline_attachments()
RETURNS TABLE (
  booking_id      UUID,
  bills_attached  INT,
  weight_attached NUMERIC,
  overshoot_g     NUMERIC
) AS $$
DECLARE
  booking          RECORD;
  bill             RECORD;
  remaining        NUMERIC;
  remaining_before NUMERIC;
  attached_count   INT;
  attached_weight  NUMERIC;
  overshoot        NUMERIC;
  expected_pdate   DATE;
  kerala_hubs      TEXT[];
BEGIN
  -- Cache the Kerala-hub list once per call so we don't subquery the
  -- branches table inside the inner bill loop.
  SELECT array_agg(name) INTO kerala_hubs
    FROM branches
   WHERE region = 'Kerala' AND is_hub = true;

  FOR booking IN
    SELECT
      q.id,
      q.pipeline_remaining_g,
      q.pipeline_region,
      q.pipeline_arrival_date
    FROM cal_quotas q
    WHERE q.pipeline_remaining_g > 0
      AND q.status = 'booked'
      AND q.pipeline_arrival_date IS NOT NULL
      AND q.pipeline_region IN ('Bangalore', 'Kerala')
    ORDER BY q.pipeline_arrival_date ASC, q.created_at ASC
  LOOP
    remaining       := booking.pipeline_remaining_g;
    attached_count  := 0;
    attached_weight := 0;
    overshoot       := 0;
    expected_pdate  := booking.pipeline_arrival_date - INTERVAL '1 day';

    -- ── Region-specific candidate query ─────────────────────────────────────
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
        EXIT WHEN remaining <= 0;
        remaining_before := remaining;
        UPDATE purchases
           SET booking_id = booking.id, booked_at = now()
         WHERE id = bill.id;
        attached_count  := attached_count + 1;
        attached_weight := attached_weight + bill.net_weight;
        remaining       := remaining - bill.net_weight;
        INSERT INTO cal_quota_pipeline_attachments
          (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
        VALUES
          (booking.id, bill.id, bill.net_weight, remaining_before, GREATEST(0, remaining), GREATEST(0, -remaining), 'auto_attach');
      END LOOP;

    ELSIF booking.pipeline_region = 'Kerala' THEN
      -- Kerala bills become eligible the moment they land at a hub via the
      -- leaf → hub consolidation. We match on current_branch (the hub's
      -- name) AND stock_status='at_branch' (physically there). Bills still
      -- at a leaf branch or in-transit to the hub do NOT match yet.
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
          EXIT WHEN remaining <= 0;
          remaining_before := remaining;
          UPDATE purchases
             SET booking_id = booking.id, booked_at = now()
           WHERE id = bill.id;
          attached_count  := attached_count + 1;
          attached_weight := attached_weight + bill.net_weight;
          remaining       := remaining - bill.net_weight;
          INSERT INTO cal_quota_pipeline_attachments
            (booking_id, purchase_id, bill_net_wt_g, pipeline_remaining_before, pipeline_remaining_after, overshoot_g, reason)
          VALUES
            (booking.id, bill.id, bill.net_weight, remaining_before, GREATEST(0, remaining), GREATEST(0, -remaining), 'auto_attach');
        END LOOP;
      END IF;
    END IF;

    IF remaining < 0 THEN
      overshoot := -remaining;
      remaining := 0;
    END IF;

    IF attached_count > 0 THEN
      UPDATE cal_quotas
         SET pipeline_remaining_g = remaining,
             gain_realized_g      = gain_realized_g + overshoot,
             pipeline_attached_at = now()
       WHERE id = booking.id;

      booking_id      := booking.id;
      bills_attached  := attached_count;
      weight_attached := attached_weight;
      overshoot_g     := overshoot;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO authenticated;
GRANT EXECUTE ON FUNCTION process_pipeline_attachments() TO service_role;

COMMIT;
