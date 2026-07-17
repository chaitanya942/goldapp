-- ═══════════════════════════════════════════════════════════════════════════
-- BUS AUDIT — GEOTAGGING
-- Capture where each proof photo was actually taken, so the founder can verify
-- the bus was audited on location (not from a desk). GPS is captured in-browser
-- at photo time and stored per photo; the bus record also carries the location
-- of its plate shot for quick map display on the dashboard.
--
-- Run once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table bus_audit_photos
  add column if not exists lat          numeric,
  add column if not exists lng          numeric,
  add column if not exists gps_accuracy numeric;   -- metres

alter table bus_audit_buses
  add column if not exists audit_lat numeric,
  add column if not exists audit_lng numeric;

NOTIFY pgrst, 'reload schema';
