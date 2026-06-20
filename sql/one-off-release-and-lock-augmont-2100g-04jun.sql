-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — release excess from 2100g booking AND lock it from auto-attach
-- ─────────────────────────────────────────────────────────────────────────────
-- Loop diagnosis (sql/cal_quotas_pipeline_attach.sql):
--   process_pipeline_attachments() walks cal_quotas rows where
--   pipeline_remaining_g > 0 AND status = 'booked' AND pipeline_region =
--   'Bangalore' AND pipeline_arrival_date IS NOT NULL. It DECREMENTS
--   pipeline_remaining_g as bills attach, but never recomputes it from
--   live attached totals. So after we manually release excess bills,
--   pipeline_remaining_g stays whatever it was — and the next CRM sync
--   refills the booking again.
--
-- Permanent fix for this specific booking:
--   1. Release the over-attached bills (smallest first until cumulative
--      covers the current over-attachment).
--   2. Force cal_quotas.pipeline_remaining_g = 0 so the auto-attacher
--      skips this booking on every future run. The bidding UI also
--      reads from the live attached total, so display stays correct.
--
-- Target: Augmont 2100g, 04-Jun-2026, booking_id 7883f6eb-9eaf-…
-- gain_rate = 0.035 (KA-AP-TS pool).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — current state + how much to release ────────────────────
WITH b AS (
  SELECT q.id, q.weight, q.gain_rate, q.pipeline_remaining_g,
         (SELECT COALESCE(SUM(p.net_weight), 0) FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted = false) AS attached_net
    FROM cal_quotas q
   WHERE q.id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
)
SELECT id, weight AS committed_g, gain_rate, pipeline_remaining_g AS current_pipeline_col,
       ROUND(attached_net::numeric, 3) AS attached_net_g,
       ROUND((attached_net * (1 + gain_rate))::numeric, 3) AS attached_effective_g,
       GREATEST(0, ROUND(((attached_net * (1 + gain_rate) - weight) / (1 + gain_rate))::numeric, 3)) AS net_over_to_release
  FROM b;

-- ── 2a) Apply — release the over-attached bills, smallest first ─────────
WITH b AS (
  SELECT q.weight, q.gain_rate,
         (SELECT COALESCE(SUM(p.net_weight), 0) FROM purchases p WHERE p.booking_id = q.id AND p.is_deleted = false) AS attached_net
    FROM cal_quotas q
   WHERE q.id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
),
target AS (
  SELECT GREATEST(0, (attached_net * (1 + gain_rate) - weight) / (1 + gain_rate)) AS net_to_release
    FROM b
),
ranked AS (
  SELECT p.id, p.net_weight,
         SUM(p.net_weight) OVER (ORDER BY p.net_weight ASC, p.id) - p.net_weight AS cumulative_before
    FROM purchases p
   WHERE p.booking_id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid
     AND p.is_deleted = false
)
UPDATE purchases p
   SET booking_id = NULL,
       booked_at  = NULL
  FROM ranked r, target t
 WHERE p.id = r.id
   AND r.cumulative_before < t.net_to_release
   AND t.net_to_release > 0;

-- ── 2b) Lock — set pipeline_remaining_g = 0 so the auto-attacher skips ─
-- Now and forever (until ops explicitly resets it). The attacher's WHERE
-- clause excludes pipeline_remaining_g = 0 rows.
UPDATE cal_quotas
   SET pipeline_remaining_g = 0
 WHERE id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid;

-- ── 3) Verify ───────────────────────────────────────────────────────────
SELECT q.id,
       q.weight                                                                                        AS committed_g,
       q.gain_rate,
       q.pipeline_remaining_g,
       (SELECT COUNT(*)                                                                                FROM purchases p WHERE p.booking_id = q.id) AS attached_bills,
       (SELECT ROUND(SUM(p.net_weight)::numeric, 3)                                                    FROM purchases p WHERE p.booking_id = q.id) AS attached_net_g,
       ROUND(((SELECT SUM(p.net_weight) FROM purchases p WHERE p.booking_id = q.id) * (1 + q.gain_rate))::numeric, 3) AS attached_effective_g
  FROM cal_quotas q
 WHERE q.id = '7883f6eb-9eaf-419f-b9c2-1c59e394c5ff'::uuid;
-- Expected: attached_effective_g ≈ 2100, pipeline_remaining_g = 0.
-- Auto-attacher will NOT touch this booking on future sync runs.

COMMIT;
