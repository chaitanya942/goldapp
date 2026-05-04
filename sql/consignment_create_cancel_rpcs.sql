-- sql/consignment_create_cancel_rpcs.sql
--
-- Transactional Postgres functions for create_consignment and cancel_consignment.
-- These wrap the multi-table writes (consignments + consignment_items + purchases
-- updates + audit log) in a single SQL function so failures roll back atomically.
--
-- ─── DESIGN: SINGLE JSONB PAYLOAD ─────────────────────────────────────────────
-- create_consignment_atomic now takes ONE arg (p_payload JSONB) instead of 32
-- positional args. Reasons:
--   1. Adding a new field (vehicle_no snapshot, transporter, per-bill GST rate)
--      doesn't change the function signature → no DROP-and-recreate dance, no
--      overload-ambiguity bugs (we hit this twice with the positional version).
--   2. Renaming a payload key is backwards-compatible with COALESCE on key reads.
--   3. JS-side caller becomes "build object, send" — much harder to misorder.
--
-- Apply via: Supabase SQL Editor. Idempotent (CREATE OR REPLACE FUNCTION).

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop ALL prior signatures so the JSONB-only version is the only overload.
-- Postgres treats different argument lists as different functions; without
-- these drops, the supabase.rpc() call could land on an old version.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_consignment_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, NUMERIC, NUMERIC, JSONB, TEXT, UUID[]
);
DROP FUNCTION IF EXISTS create_consignment_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, NUMERIC, NUMERIC, JSONB, TEXT, UUID, UUID[]
);
DROP FUNCTION IF EXISTS create_consignment_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, NUMERIC, NUMERIC, NUMERIC, JSONB, TEXT, UUID, UUID[],
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  JSONB
);

-- ─────────────────────────────────────────────────────────────────────────────
-- create_consignment_atomic(p_payload JSONB)
--
-- Required keys in p_payload:
--   consignment_no, tmp_prf_no, branch_name, branch_code, state_code,
--   movement_type, total_bills, created_by (email), added_by (uuid),
--   purchase_ids (uuid[]), item_snapshots (jsonb array)
--
-- Optional keys:
--   external_no, internal_no, challan_no, dest_branch, eway_bill_no,
--   total_net_wt, total_gross_wt, total_amount, gst_snapshot,
--   source_address, source_city, source_pin, source_state, source_region, source_gstin,
--   dest_address, dest_city, dest_pin, dest_state, dest_region, dest_gstin
--
-- item_snapshots format: [{ purchase_id, bill_no, gross_weight, net_weight,
--                           total_amount, customer_name, purchase_date }, ...]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_consignment_atomic(p_payload JSONB)
RETURNS consignments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consignment   consignments;
  v_movement_type TEXT := COALESCE(p_payload->>'movement_type', 'EXTERNAL');
  v_is_internal   BOOLEAN := (v_movement_type = 'INTERNAL');
  v_now           TIMESTAMPTZ := NOW();
  v_status        TEXT := CASE WHEN v_is_internal THEN 'received' ELSE 'dispatched' END;
  v_received_at   TIMESTAMPTZ := CASE WHEN v_is_internal THEN v_now ELSE NULL END;
  v_purchase_ids  UUID[] := ARRAY(SELECT jsonb_array_elements_text(p_payload->'purchase_ids'))::UUID[];
  v_added_by      UUID := NULLIF(p_payload->>'added_by', '')::UUID;
  v_already_in    INT;
BEGIN
  -- Pre-flight: are any of the requested purchases already tied up in an
  -- IN-FLIGHT consignment? Status 'received' and 'cancelled' are OK to
  -- ignore (closed / dead). See create_consignment route for full rationale.
  SELECT COUNT(*) INTO v_already_in
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
  WHERE ci.purchase_id = ANY(v_purchase_ids)
    AND c.status NOT IN ('cancelled', 'received');
  IF v_already_in > 0 THEN
    RAISE EXCEPTION 'create_consignment_atomic: % bill(s) already in an in-flight consignment', v_already_in
      USING ERRCODE = 'check_violation';
  END IF;

  -- Insert consignment header with full address + weight snapshot.
  INSERT INTO consignments (
    consignment_no, tmp_prf_no, external_no, internal_no, challan_no,
    branch_name, branch_code, state_code, movement_type, dest_branch,
    eway_bill_no, status, dispatched_at, received_at,
    total_bills, total_net_wt, total_gross_wt, total_amount, gst_rate_snapshot,
    approval_status, created_by,
    source_address, source_city, source_pin, source_state, source_region, source_gstin,
    dest_address,   dest_city,   dest_pin,   dest_state,   dest_region,   dest_gstin
  )
  VALUES (
    p_payload->>'consignment_no',
    p_payload->>'tmp_prf_no',
    p_payload->>'external_no',
    p_payload->>'internal_no',
    p_payload->>'challan_no',
    p_payload->>'branch_name',
    p_payload->>'branch_code',
    p_payload->>'state_code',
    v_movement_type,
    CASE WHEN v_is_internal THEN p_payload->>'dest_branch' ELSE NULL END,
    p_payload->>'eway_bill_no',
    v_status, v_now, v_received_at,
    NULLIF(p_payload->>'total_bills',    '')::INT,
    NULLIF(p_payload->>'total_net_wt',   '')::NUMERIC,
    NULLIF(p_payload->>'total_gross_wt', '')::NUMERIC,
    NULLIF(p_payload->>'total_amount',   '')::NUMERIC,
    p_payload->'gst_snapshot',
    'pending',
    p_payload->>'created_by',
    p_payload->>'source_address',
    p_payload->>'source_city',
    p_payload->>'source_pin',
    p_payload->>'source_state',
    p_payload->>'source_region',
    p_payload->>'source_gstin',
    CASE WHEN v_is_internal THEN p_payload->>'dest_address' ELSE NULL END,
    CASE WHEN v_is_internal THEN p_payload->>'dest_city'    ELSE NULL END,
    CASE WHEN v_is_internal THEN p_payload->>'dest_pin'     ELSE NULL END,
    CASE WHEN v_is_internal THEN p_payload->>'dest_state'   ELSE NULL END,
    CASE WHEN v_is_internal THEN p_payload->>'dest_region'  ELSE NULL END,
    CASE WHEN v_is_internal THEN p_payload->>'dest_gstin'   ELSE NULL END
  )
  RETURNING * INTO v_consignment;

  -- Link every purchase, freezing the per-bill snapshot.
  INSERT INTO consignment_items (
    consignment_id, purchase_id, added_by,
    bill_no_snap, gross_weight_snap, net_weight_snap, total_amount_snap,
    customer_name_snap, purchase_date_snap
  )
  SELECT
    v_consignment.id,
    (item->>'purchase_id')::UUID,
    v_added_by,
    item->>'bill_no',
    NULLIF(item->>'gross_weight', '')::NUMERIC,
    NULLIF(item->>'net_weight',   '')::NUMERIC,
    NULLIF(item->>'total_amount', '')::NUMERIC,
    item->>'customer_name',
    NULLIF(item->>'purchase_date', '')::DATE
  FROM jsonb_array_elements(p_payload->'item_snapshots') AS item;

  -- Bills stay 'at_branch' until accounts approves; that flip lives in the
  -- approve_consignment action. The duplicate-link guard above still blocks
  -- a second consignment for the same bills even before approval.

  -- Audit log (best-effort — table may not exist in older deployments)
  BEGIN
    INSERT INTO consignment_activity_log (consignment_id, event_type, actor_email, details, created_at)
    VALUES (
      v_consignment.id,
      CASE WHEN v_is_internal THEN 'created_and_received' ELSE 'created' END,
      p_payload->>'created_by',
      jsonb_build_object(
        'movement_type', v_consignment.movement_type,
        'source', p_payload->>'branch_name',
        'dest',   CASE WHEN v_is_internal THEN p_payload->>'dest_branch' ELSE 'HO' END,
        'bills',  v_consignment.total_bills,
        'gross_weight', v_consignment.total_gross_wt
      ),
      v_now
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN OTHERS THEN NULL;
  END;

  RETURN v_consignment;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- cancel_consignment_atomic(consignment_id, reason, cancelled_by)
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

  -- Return bills to source — but only if the consignment was actually approved.
  -- Pre-approval consignments never flipped purchase state (deferred-movement model).
  IF v_purchase_ids IS NOT NULL AND array_length(v_purchase_ids, 1) > 0
     AND v_c.approval_status = 'approved' THEN
    UPDATE purchases
    SET stock_status   = 'at_branch',
        current_branch = v_c.branch_name,
        dispatched_at  = NULL
    WHERE id = ANY(v_purchase_ids);
  END IF;

  UPDATE consignments
  SET status        = 'cancelled',
      cancelled_at  = v_now,
      cancel_reason = p_reason,
      received_at   = NULL
  WHERE id = p_consignment_id
  RETURNING * INTO v_c;

  BEGIN
    INSERT INTO consignment_activity_log (consignment_id, event_type, actor_email, details, created_at)
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

GRANT EXECUTE ON FUNCTION create_consignment_atomic(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_consignment_atomic       TO authenticated, service_role;
