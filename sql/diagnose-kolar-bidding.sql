-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostic: why isn't KOLAR showing in Bidding Volume for today's bills?
-- ─────────────────────────────────────────────────────────────────────────────
-- Paste into Supabase SQL editor and Run. The four queries pinpoint:
--   Q1 — Kolar's branch metadata (region / TAT / pickup_days / is_active)
--   Q2 — today's Kolar bills + their stock_status / crm_status / booking_id
--   Q3 — which Bidding Volume section *would* show Kolar if metadata were correct
--   Q4 — what's actually rendered today for arrivalDate = tomorrow
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Q1. Kolar branch metadata ───────────────────────────────────────────────
-- Section eligibility:
--   · Section 1 (Bangalore Today)   ← region = 'Bangalore'
--   · Section 2 (In-Transit 24h)    ← region != 'Bangalore' AND TAT <= 24h,
--                                     bill is in_consignment with dispatched_at
--   · Section 4 (Branch Stock EOD)  ← region != 'Bangalore' AND TAT <= 24h
--                                     AND pickup_days includes today's DOW
--                                     AND bill is at_branch
SELECT name, region, is_active,
       delivery_tat_hours,
       pickup_time, pickup_days,
       logistics_partner
  FROM branches
 WHERE name ILIKE '%kolar%'
 ORDER BY name;
-- Interpret:
--   region = 'Bangalore'           → Section 1 should show it
--   region != 'Bangalore' AND TAT > 24h → no section will show it (48h TAT)
--   region != 'Bangalore' AND TAT <= 24h AND pickup_days empty/null → Section 4
--      WILL NOT show it (current filter requires today ∈ pickup_days)
--   is_active = false              → branch dropped from branch list entirely


-- ── Q2. Kolar bills synced today ────────────────────────────────────────────
-- Are there any bills at all for Kolar today? If 0 rows, the issue is upstream
-- (CRM sync hasn't pulled them, or they're not approved yet).
SELECT branch_name,
       COUNT(*)                                AS bills,
       COUNT(*) FILTER (WHERE crm_status = 'approved') AS approved,
       COUNT(*) FILTER (WHERE crm_status = 'pending')  AS pending,
       COUNT(*) FILTER (WHERE crm_status = 'rejected') AS rejected,
       COUNT(*) FILTER (WHERE booking_id IS NOT NULL)  AS already_booked,
       COALESCE(SUM(net_weight), 0)::numeric(12, 2)    AS total_net_wt
  FROM purchases
 WHERE branch_name ILIKE '%kolar%'
   AND is_deleted = false
   AND purchase_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY branch_name
 ORDER BY branch_name;


-- ── Q3. Kolar bills broken down by stock_status (today) ─────────────────────
-- Which section *would* claim these bills if Kolar's metadata is correct?
SELECT branch_name,
       stock_status,
       COUNT(*) AS bills,
       COALESCE(SUM(net_weight), 0)::numeric(12, 2) AS total_net_wt
  FROM purchases
 WHERE branch_name ILIKE '%kolar%'
   AND is_deleted   = false
   AND crm_status   = 'approved'
   AND booking_id IS NULL
   AND purchase_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
 GROUP BY branch_name, stock_status
 ORDER BY branch_name, stock_status;
-- at_branch       → Section 4 candidate (needs pickup_days to include today)
-- in_consignment  → Section 2 candidate (needs dispatched_at + TAT-based arrival
--                                        landing on tomorrow's IST date)
-- at_ho           → already arrived; not part of today's bid (out of pool)


-- ── Q4. Sanity: today's DOW + arrivalDate-eligible Kolar bills ──────────────
-- Confirms today's day-of-week (filter Section 4 uses) and whether any
-- in-flight Kolar bill is expected to arrive at HO tomorrow.
SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'Dy') AS today_dow_ist,
       (now() AT TIME ZONE 'Asia/Kolkata')::date              AS today_ist,
       ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)        AS tomorrow_ist;
