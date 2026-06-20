-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: clear Bidding Volume "Section 5 — Consignment created · bidding
-- passed · not booked" by RECEIVING those bills at HO.
--
-- Section 5 = bills that are:
--   stock_status   = 'in_consignment'
--   booking_id     IS NULL                 (never booked)
--   dispatched_at  IS NOT NULL             (a consignment was actually created)
--   branch region  <> 'Kerala'             (KL bills live in the Kerala tab's
--                                            own movement sections, not here)
--   is_deleted     = false
--
-- Flipping them in_consignment → at_ho (and clearing current_branch) takes them
-- out of the in-flight bidding pool entirely: they will no longer be SEEN in any
-- bidding section nor be AVAILABLE for booking. We do NOT touch dispatched_at
-- (keeps the audit trail of when each went out).
--
-- NOTE on scope: this matches Section 5 exactly only while Sections 2/3/4
-- (forward arrival windows) are empty — which they are now (0 bills each). The
-- PREVIEW below MUST show 25 bills / 540.27 g. If it shows more, a forward-window
-- bill has appeared since; stop and re-check before APPLYING.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · PREVIEW — overall count + weight (expect 25 bills / 540.27 g) ───
SELECT count(*) AS bills, round(sum(p.net_weight)::numeric, 2) AS net_g
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE p.stock_status  = 'in_consignment'
   AND p.booking_id    IS NULL
   AND p.dispatched_at IS NOT NULL
   AND p.is_deleted    = false
   AND b.region       <> 'Kerala';

-- ── STEP 1b · PREVIEW — branch-wise, so you can eyeball the exact set ────────
SELECT p.branch_name, b.region,
       count(*)                              AS bills,
       round(sum(p.net_weight)::numeric, 2)  AS net_g
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE p.stock_status  = 'in_consignment'
   AND p.booking_id    IS NULL
   AND p.dispatched_at IS NOT NULL
   AND p.is_deleted    = false
   AND b.region       <> 'Kerala'
 GROUP BY p.branch_name, b.region
 ORDER BY p.branch_name;

-- ── STEP 2 · APPLY (run once the preview reads 25 / 540.27) ──────────────────
BEGIN;

UPDATE purchases p
   SET stock_status   = 'at_ho',
       current_branch = NULL
  FROM branches b
 WHERE b.name = p.branch_name
   AND p.stock_status  = 'in_consignment'
   AND p.booking_id    IS NULL
   AND p.dispatched_at IS NOT NULL
   AND p.is_deleted    = false
   AND b.region       <> 'Kerala';

COMMIT;

-- ── STEP 3 · VERIFY — Section-5 set should now be empty ──────────────────────
SELECT count(*) AS still_in_section5
  FROM purchases p
  JOIN branches  b ON b.name = p.branch_name
 WHERE p.stock_status  = 'in_consignment'
   AND p.booking_id    IS NULL
   AND p.dispatched_at IS NOT NULL
   AND p.is_deleted    = false
   AND b.region       <> 'Kerala';
-- Expect 0. Refresh Bidding Volume → Section 5 reads 0 bills.
