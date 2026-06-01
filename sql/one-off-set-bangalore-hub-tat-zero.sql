-- ─────────────────────────────────────────────────────────────────────────────
-- One-off — set delivery_tat_hours = 0 on Bangalore hub branches
-- ─────────────────────────────────────────────────────────────────────────────
-- The audit module's arrival-date math reads branches.delivery_tat_hours.
-- For most branches the TAT is 24h or 48h (BVC truck transit). Bangalore
-- hubs are different — they dispatch to HO within the same yard, so the
-- truck pulls in within minutes of EWB generation. Arrival is effectively
-- the same calendar day as dispatch.
--
-- Until now Bangalore hubs had delivery_tat_hours = NULL, which the audit
-- API silently treats as 24h (the safe default for "unconfigured"
-- branches). Result: today's Bangalore Hub Dispatches were showing up
-- under the Tomorrow filter chip instead of Today, and the BANGALORE
-- section never rendered under the default Today view.
--
-- Setting TAT = 0 makes the arrival math return the dispatch day itself.
-- This is configuration, not code — the audit endpoint stays
-- region-agnostic (no hardcoded "if region = Bangalore" branches).
--
-- Idempotent. Only updates rows that don't already have a TAT configured.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Preview — which Bangalore hubs are about to be set to 0h TAT ──────
SELECT name, region, hub_branch_name, is_hub, delivery_tat_hours
  FROM branches
 WHERE region = 'Bangalore'
   AND is_active = true
   AND (delivery_tat_hours IS NULL OR delivery_tat_hours >= 24)
 ORDER BY name;

-- ── 2) Apply — set TAT to 0 on Bangalore branches ────────────────────────
-- Includes both hub branches and their leaves. Leaves never directly
-- dispatch to HO under the new model (their bills travel via the hub),
-- so setting 0 on a leaf is harmless even if the leaf never appears as a
-- consignment source.
UPDATE branches
   SET delivery_tat_hours = 0
 WHERE region = 'Bangalore'
   AND is_active = true
   AND (delivery_tat_hours IS NULL OR delivery_tat_hours >= 24);

-- ── 3) Verify — all Bangalore branches should now read 0 ────────────────
SELECT name, region, is_hub, delivery_tat_hours
  FROM branches
 WHERE region = 'Bangalore'
   AND is_active = true
 ORDER BY name;

COMMIT;
