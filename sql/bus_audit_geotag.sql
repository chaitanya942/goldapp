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

-- Human-readable place resolved from the GPS fix (reverse-geocoded).
alter table bus_audit_photos add column if not exists address       text;
alter table bus_audit_buses  add column if not exists audit_address text;

-- Integrity: how the photo entered — 'camera' (live capture) vs 'upload'
-- (picked from gallery, treated as unverified since its GPS is the device's
-- location at submit time, not the photo's origin).
alter table bus_audit_photos add column if not exists source text;

NOTIFY pgrst, 'reload schema';
