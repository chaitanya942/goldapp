-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostic: why don't KL-VENNALA-BY-PASS / KL-THRISSUR appear in Section 4?
-- ─────────────────────────────────────────────────────────────────────────────
-- Paste into Supabase SQL editor and Run. The three queries together pinpoint
-- whether the issue is branch metadata, bill stock status, or already-booked.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Q1. Hub branch metadata ─────────────────────────────────────────────────
-- Section 4 eligibility for Kerala requires is_hub = true AND region = 'Kerala'.
-- If either is wrong, the hub doesn't even reach the bill query.
SELECT name,
       region,
       is_hub,
       pickup_time,
       pickup_days,
       delivery_tat_hours
  FROM branches
 WHERE name IN ('KL-VENNALA-BY-PASS', 'KL-THRISSUR')
 ORDER BY name;
-- Expect: two rows, both region='Kerala' AND is_hub=true.
-- If is_hub is false/null → that's the bug. Run:
--   UPDATE branches SET is_hub = true WHERE name IN ('KL-VENNALA-BY-PASS', 'KL-THRISSUR');


-- ── Q2. Bills currently at_branch at the hubs ───────────────────────────────
-- This is exactly the filter Section 4 uses (current_branch IN hubs OR
-- (current_branch IS NULL AND branch_name IN hubs), stock_status='at_branch',
-- crm_status='approved', not deleted, not booked).
SELECT COALESCE(current_branch, branch_name) AS owner_branch,
       COUNT(*)                                AS bills,
       COALESCE(SUM(net_weight), 0)::numeric(12, 2) AS total_net_wt
  FROM purchases
 WHERE (current_branch IN ('KL-VENNALA-BY-PASS', 'KL-THRISSUR')
        OR (current_branch IS NULL AND branch_name IN ('KL-VENNALA-BY-PASS', 'KL-THRISSUR')))
   AND stock_status = 'at_branch'
   AND crm_status   = 'approved'
   AND is_deleted   = false
   AND booking_id IS NULL
 GROUP BY COALESCE(current_branch, branch_name)
 ORDER BY owner_branch;
-- Expect: rows for both hubs with bills > 0.
-- If 0 rows → there are no at_branch bills at the hubs right now. Most
-- likely the consignments TO the hubs are still in_consignment (in transit);
-- bills become at_branch only after the destination marks the consignment
-- received. Q3 below confirms.


-- ── Q3. Stock-status distribution at the hubs (any state) ───────────────────
-- Shows where bills tagged to the hubs actually are. If most are in_consignment
-- the consignments are still in flight and the hub has nothing PHYSICALLY
-- sitting there to bid out.
SELECT COALESCE(current_branch, branch_name) AS owner_branch,
       stock_status,
       crm_status,
       COUNT(*)                                AS bills,
       COALESCE(SUM(net_weight), 0)::numeric(12, 2) AS total_net_wt
  FROM purchases
 WHERE (current_branch IN ('KL-VENNALA-BY-PASS', 'KL-THRISSUR')
        OR (current_branch IS NULL AND branch_name IN ('KL-VENNALA-BY-PASS', 'KL-THRISSUR')))
   AND is_deleted = false
 GROUP BY COALESCE(current_branch, branch_name), stock_status, crm_status
 ORDER BY owner_branch, stock_status, crm_status;
-- Expect: a mix of in_consignment / at_branch / at_ho counts so you can see
-- where the bills currently live.
