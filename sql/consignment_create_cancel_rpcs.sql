-- sql/consignment_create_cancel_rpcs.sql
--
-- Transactional Postgres functions for create_consignment and cancel_consignment.
-- These wrap the multi-table writes (consignments + consignment_items + purchases
-- updates + audit log) in a single SQL function so failures roll back atomically.
--
-- Without these functions, a failure between the consignments INSERT and the
-- purchases UPDATE leaves bills in `at_branch` while the consignment row says
-- `dispatched` — the partial state requires manual cleanup. With these in place,
-- the entire operation succeeds-as-one or fails-as-one.
--
-- Apply via: supabase db push OR run manually in the Supabase SQL editor.
-- Idempotent — uses CREATE OR REPLACE FUNCTION.

-- ─────────────────────────────────────────────────────────────────────────────
-- create_consignment_atomic
--
-- Inserts the consignment row, links every purchase via consignment_items,
-- and flips the purchases' stock_status / current_branch in one transaction.
-- Returns the new consignment row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_consignment_atomic(
  p_consignment_no   TEXT,
  p_tmp_prf_no       TEXT,
  p_external_no      TEXT,
  p_internal_no      TEXT,
  p_challan_no       TEXT,
  p_branch_name      TEXT,
  p_branch_code      TEXT,
  p_state_code       TEXT,
  p_movement_type    TEXT,
  p_dest_branch      TEXT,
  p_eway_bill_no     TEXT,
  p_total_bills      INT,
  p_total_net_wt     NUMERIC,
  p_total_amount     NUMERIC,
  p_gst_snapshot     JSONB,
  p_created_by       TEXT,
  p_purchase_ids     UUID[]
)
RETURNS consignments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consignment   consignments;
  v_is_internal   BOOLEAN := (p_movement_type = 'INTERNAL');
  v_now           TIMESTAMPTZ := NOW();
  v_status        TEXT := CASE WHEN v_is_internal THEN 'received' ELSE 'dispatched' END;
  v_received_at   TIMESTAMPTZ := CASE WHEN v_is_internal THEN v_now ELSE NULL END;
  v_already_in    INT;
BEGIN
  -- Pre-flight: any of the requested purchases already in a non-cancelled
  -- consignment? Prevents double-consigning under race conditions.
  SELECT COUNT(*) INTO v_already_in
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
  WHERE ci.purchase_id = ANY(p_purchase_ids)
    AND c.status != 'cancelled';
  IF v_already_in > 0 THEN
    RAISE EXCEPTION 'create_consignment_atomic: % bill(s) already linked to a non-cancelled consignment', v_already_in
      USING ERRCODE = 'check_violation';
  END IF;

  -- Insert the consignment header
  INSERT INTO consignments (
    consignment_no, tmp_prf_no, external_no, internal_no, challan_no,
    branch_name, branch_code, state_code, movement_type, dest_branch,
    eway_bill_no, status, dispatched_at, received_at,
    total_bills, total_net_wt, total_amount, gst_rate_snapshot,
    approval_status, created_by
  )
  VALUES (
    p_consignment_no, p_tmp_prf_no, p_external_no, p_internal_no, p_challan_no,
    p_branch_name, p_branch_code, p_state_code, COALESCE(p_movement_type, 'EXTERNAL'), CASE WHEN v_is_internal THEN p_dest_branch ELSE NULL END,
    p_eway_bill_no, v_status, v_now, v_received_at,
    p_total_bills, p_total_net_wt, p_total_amount, p_gst_snapshot,
    'pending', p_created_by
  )
  RETURNING * INTO v_consignment;

  -- Link every purchase
  INSERT INTO consignment_items (consignment_id, purchase_id, added_by)
  SELECT v_consignment.id, pid, p_created_by FROM unnest(p_purchase_ids) AS pid;

  -- Flip purchases state. INTERNAL = instant transfer to hub (still at_branch
  -- there). EXTERNAL = in_consignment until HO receive.
  IF v_is_internal THEN
    UPDATE purchases
    SET stock_status   = 'at_branch',
        current_branch = p_dest_branch,
        dispatched_at  = v_now
    WHERE id = ANY(p_purchase_ids);
  ELSE
    UPDATE purchases
    SET stock_status   = 'in_consignment',
        dispatched_at  = v_now
    WHERE id = ANY(p_purchase_ids);
  END IF;

  -- Audit log (best-effort — table may not exist in older deployments)
  BEGIN
    INSERT INTO consignment_events (consignment_id, event_type, actor_email, details, created_at)
    VALUES (
      v_consignment.id,
      CASE WHEN v_is_internal THEN 'created_and_received' ELSE 'created' END,
      p_created_by,
      jsonb_build_object(
        'movement_type', v_consignment.movement_type,
        'source', p_branch_name,
        'dest', CASE WHEN v_is_internal THEN p_dest_branch ELSE 'HO' END,
        'bills', p_total_bills,
        'weight', p_total_net_wt
      ),
      v_now
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;  -- audit log table absent — skip
    WHEN OTHERS THEN NULL;            -- never let audit failures block the insert
  END;

  RETURN v_consignment;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- cancel_consignment_atomic
--
-- Reverses a consignment: returns bills to source, flips status to cancelled.
-- Refuses if any bill is now in a later non-cancelled consignment (race-safe).
-- Returns the updated consignment row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_consignment_atomic(
  p_consignment_id  UUID,
  p_reason          TEXT,
  p_cancelled_by    TEXT
)
RETURNS consignments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_c             consignments;
  v_purchase_ids  UUID[];
  v_later_count   INT;
  v_now           TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_c FROM consignments WHERE id = p_consignment_id FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION 'cancel_consignment_atomic: consignment % not found', p_consignment_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_c.status = 'cancelled' THEN
    RAISE EXCEPTION 'cancel_consignment_atomic: already cancelled' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_c.status = 'received' AND v_c.movement_type != 'INTERNAL' THEN
    RAISE EXCEPTION 'Cannot cancel — already received at HO. Initiate a return instead.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Collect linked purchases
  SELECT array_agg(purchase_id) INTO v_purchase_ids
  FROM consignment_items WHERE consignment_id = p_consignment_id;

  -- For INTERNAL (auto-received), block if any bill moved into a later consignment.
  IF v_c.movement_type = 'INTERNAL' AND v_purchase_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_later_count
    FROM consignment_items ci
    JOIN consignments c2 ON c2.id = ci.consignment_id
    WHERE ci.purchase_id = ANY(v_purchase_ids)
      AND ci.consignment_id != p_consignment_id
      AND c2.status != 'cancelled'
      AND c2.created_at > v_c.created_at;
    IF v_later_count > 0 THEN
      RAISE EXCEPTION 'Cannot void — % bill(s) are in a later consignment. Cancel that one first.', v_later_count
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- Return bills to source branch (if any linked)
  IF v_purchase_ids IS NOT NULL AND array_length(v_purchase_ids, 1) > 0 THEN
    UPDATE purchases
    SET stock_status   = 'at_branch',
        current_branch = v_c.branch_name,
        dispatched_at  = NULL
    WHERE id = ANY(v_purchase_ids);
  END IF;

  -- Mark consignment cancelled (clears received_at for INTERNAL auto-received case)
  UPDATE consignments
  SET status        = 'cancelled',
      cancelled_at  = v_now,
      cancel_reason = p_reason,
      received_at   = NULL
  WHERE id = p_consignment_id
  RETURNING * INTO v_c;

  -- Audit log (best-effort)
  BEGIN
    INSERT INTO consignment_events (consignment_id, event_type, actor_email, details, created_at)
    VALUES (
      p_consignment_id,
      'cancelled',
      p_cancelled_by,
      jsonb_build_object(
        'reason', p_reason,
        'had_ewb', v_c.eway_bill_no IS NOT NULL,
        'had_irn', v_c.irn IS NOT NULL,
        'bills_returned', COALESCE(array_length(v_purchase_ids, 1), 0)
      ),
      v_now
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN OTHERS THEN NULL;
  END;

  RETURN v_c;
END $$;

-- Allow authenticated callers to invoke via supabase.rpc()
GRANT EXECUTE ON FUNCTION create_consignment_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_consignment_atomic TO authenticated, service_role;
