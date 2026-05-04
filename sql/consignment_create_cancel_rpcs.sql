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

-- Drop any prior signature first. Postgres treats functions with different
-- argument lists as different overloads — without this, replacing the
-- previous version with the new snapshot-aware version would leave both
-- in place and the supabase.rpc() call would be ambiguous.
DROP FUNCTION IF EXISTS create_consignment_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, NUMERIC, NUMERIC, JSONB, TEXT, UUID[]
);
DROP FUNCTION IF EXISTS create_consignment_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INT, NUMERIC, NUMERIC, JSONB, TEXT, UUID, UUID[]
);

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
  p_total_gross_wt   NUMERIC,    -- gross weight snapshot (canonical for EWB/E-Invoice/challan)
  p_total_amount     NUMERIC,
  p_gst_snapshot     JSONB,
  p_created_by       TEXT,    -- email; goes into consignments.created_by + audit log
  p_added_by         UUID,    -- supabase auth uid; goes into consignment_items.added_by (UUID column)
  p_purchase_ids     UUID[],
  -- Source branch address snapshot (frozen at creation time)
  p_source_address   TEXT,
  p_source_city      TEXT,
  p_source_pin       TEXT,
  p_source_state     TEXT,
  p_source_region    TEXT,
  p_source_gstin     TEXT,
  -- Destination branch address snapshot (only for INTERNAL movements; pass NULL for EXTERNAL)
  p_dest_address     TEXT,
  p_dest_city        TEXT,
  p_dest_pin         TEXT,
  p_dest_state       TEXT,
  p_dest_region      TEXT,
  p_dest_gstin       TEXT,
  -- Per-bill snapshot, JSONB array of { purchase_id, bill_no, gross_weight, net_weight, total_amount, customer_name, purchase_date, hsn_code }
  p_item_snapshots   JSONB
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
  -- Pre-flight: are any of the requested purchases already tied up in an
  -- IN-FLIGHT consignment (draft or dispatched)? Those can't be moved into
  -- a new consignment because they aren't physically free yet.
  --
  -- Status 'received' is OK to ignore — the prior consignment is closed and
  -- the bills are at their new location, available for the next leg. This
  -- is the hub-consolidation flow: WG000001 (Branch→Hub) marks bills
  -- 'received' on creation (INTERNAL auto-receive), so when the hub
  -- forwards those bills onward via WG000002 (Hub→HO), the same bills
  -- legitimately need to appear in BOTH consignments.
  --
  -- Status 'cancelled' is also ignored (the link is dead).
  SELECT COUNT(*) INTO v_already_in
  FROM consignment_items ci
  JOIN consignments c ON c.id = ci.consignment_id
  WHERE ci.purchase_id = ANY(p_purchase_ids)
    AND c.status NOT IN ('cancelled', 'received');
  IF v_already_in > 0 THEN
    RAISE EXCEPTION 'create_consignment_atomic: % bill(s) already in an in-flight consignment', v_already_in
      USING ERRCODE = 'check_violation';
  END IF;

  -- Insert the consignment header — now including the address + weight snapshot
  -- so EWB/E-Invoice generation never has to re-read live `branches`.
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
    p_consignment_no, p_tmp_prf_no, p_external_no, p_internal_no, p_challan_no,
    p_branch_name, p_branch_code, p_state_code, COALESCE(p_movement_type, 'EXTERNAL'), CASE WHEN v_is_internal THEN p_dest_branch ELSE NULL END,
    p_eway_bill_no, v_status, v_now, v_received_at,
    p_total_bills, p_total_net_wt, p_total_gross_wt, p_total_amount, p_gst_snapshot,
    'pending', p_created_by,
    p_source_address, p_source_city, p_source_pin, p_source_state, p_source_region, p_source_gstin,
    CASE WHEN v_is_internal THEN p_dest_address ELSE NULL END,
    CASE WHEN v_is_internal THEN p_dest_city    ELSE NULL END,
    CASE WHEN v_is_internal THEN p_dest_pin     ELSE NULL END,
    CASE WHEN v_is_internal THEN p_dest_state   ELSE NULL END,
    CASE WHEN v_is_internal THEN p_dest_region  ELSE NULL END,
    CASE WHEN v_is_internal THEN p_dest_gstin   ELSE NULL END
  )
  RETURNING * INTO v_consignment;

  -- Link every purchase, freezing the bill-level snapshot at the same time.
  -- consignment_items.added_by is UUID — we pass the supabase auth uid via
  -- p_added_by, NOT the email (p_created_by) which would fail the UUID cast.
  INSERT INTO consignment_items (
    consignment_id, purchase_id, added_by,
    bill_no_snap, gross_weight_snap, net_weight_snap, total_amount_snap,
    customer_name_snap, purchase_date_snap, hsn_code_snap
  )
  SELECT
    v_consignment.id,
    (item->>'purchase_id')::UUID,
    p_added_by,
    item->>'bill_no',
    NULLIF(item->>'gross_weight', '')::NUMERIC,
    NULLIF(item->>'net_weight',   '')::NUMERIC,
    NULLIF(item->>'total_amount', '')::NUMERIC,
    item->>'customer_name',
    NULLIF(item->>'purchase_date', '')::DATE,
    item->>'hsn_code'
  FROM jsonb_array_elements(p_item_snapshots) AS item;

  -- IMPORTANT: do NOT flip purchases.stock_status / current_branch here.
  -- Bills stay at_branch (in the branch's stock) until the accounts team
  -- approves the consignment. Approval is what triggers the physical
  -- movement; until then this row is a planning document. The actual
  -- stock-state flip lives in the approve_consignment action in
  -- app/api/consignments/route.js.
  --
  -- The duplicate-link guard above (status NOT IN cancelled, received)
  -- still blocks operators from creating a second consignment for the
  -- same bills, even before approval, because the consignment row exists.

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

  -- Return bills to the source branch — but only if they were actually
  -- moved (i.e. the consignment was approved at some point). Pre-approval
  -- consignments never flipped purchase state, so there's nothing to
  -- reverse. Approved consignments did flip state, so reverse it.
  IF v_purchase_ids IS NOT NULL AND array_length(v_purchase_ids, 1) > 0
     AND v_c.approval_status = 'approved' THEN
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
