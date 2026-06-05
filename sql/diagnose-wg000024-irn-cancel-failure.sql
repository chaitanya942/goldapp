-- Diagnostic — why is IRP rejecting the cancel for WG000024?
-- ClearTax error 107 "Valid Irn number is missing" from their CLEARTAX-
-- source pre-validation. Need to see what's actually stored.

-- 1) Consignment row — the IRN we'll send, the GSTIN we'd authenticate
--    with, the EWB state (to rule out partial cancel cascade).
SELECT c.id,
       c.tmp_prf_no,
       c.consignment_no,
       c.external_no,
       c.branch_name,
       c.dest_branch,
       c.movement_type,
       c.status,
       c.cancellation_requested_at,
       c.cancellation_requested_by,
       c.cancellation_reason,
       -- IRP-side fields:
       c.irn,
       LENGTH(c.irn)                                AS irn_length,           -- should be 64 chars
       c.irn IS NULL                                AS irn_is_null,
       c.irn = ''                                   AS irn_is_empty,
       c.ack_no,
       c.ack_dt,
       c.einvoice_generated_at,
       EXTRACT(EPOCH FROM (NOW() - c.einvoice_generated_at))/3600 AS irn_age_hours,
       c.signed_qr_code IS NOT NULL                 AS has_signed_qr,
       -- NIC-side fields (rule out cascade):
       c.eway_bill_no,
       c.ewb_generated_at,
       -- GSTIN snapshot used for portal calls:
       c.source_gstin,
       c.source_state,
       c.source_region
  FROM consignments c
 WHERE c.tmp_prf_no = 'WG000024';

-- 2) Branch + state-wise company GSTIN — compare against c.source_gstin
--    above. If they differ, GSTIN drift since generation is the cause.
SELECT b.name           AS branch_name,
       b.region         AS branch_region,
       b.branch_gstin   AS branch_gstin,
       cs.gstin_ka      AS company_gstin_ka,
       cs.gstin_ap      AS company_gstin_ap,
       cs.gstin_ts      AS company_gstin_ts,
       cs.gstin_kl      AS company_gstin_kl,
       cs.gstin         AS company_gstin_default
  FROM (SELECT 'AP-KAKINADA'::text AS name) probe
  LEFT JOIN branches b           ON b.name = probe.name
  CROSS JOIN company_settings cs
  LIMIT 1;

-- 3) E-Invoice generation event log — what did ClearTax actually return
--    at generation time? Confirms the IRN we stored matches what was
--    acknowledged. Table is consignment_activity_log (not consignment_events).
--    NB: tmp_prf_no 'WG000024' is reused across 5 consignment_no rows; pin to
--    the AP-KAKINADA cancellation-requested row directly by id.
SELECT event_type,
       actor_email,
       actor_role,
       created_at,
       details
  FROM consignment_activity_log
 WHERE consignment_id = '9f683ea7-0147-4ebc-bf71-556641aac2a0'::uuid
 ORDER BY created_at;

-- 4) Quick sanity — is the stored IRN a 64-char hex hash like NIC issues?
--    NIC IRN format: 64 hex chars. Anything else here = corruption.
SELECT tmp_prf_no,
       irn,
       irn ~ '^[a-f0-9]{64}$' AS looks_like_valid_irn
  FROM consignments
 WHERE tmp_prf_no = 'WG000024';
