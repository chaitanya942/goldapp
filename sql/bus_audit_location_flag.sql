-- ═══════════════════════════════════════════════════════════════════════════
-- BUS AUDIT — LOCATION MISMATCH FLAG
-- Records whether a bus was photographed in the city it's registered to.
-- A bus assigned to Kundapura (Mangalore) but shot on Hosur Road, Bengaluru is
-- exactly what this audit exists to catch.
--
-- location_status: 'match' | 'mismatch' | 'unknown'
--   'unknown' means we couldn't confidently resolve one of the two cities —
--   deliberately NOT treated as a mismatch.
--
-- Run once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table bus_audit_buses
  add column if not exists location_status text,   -- match | mismatch | unknown
  add column if not exists audit_city      text;   -- canonical city resolved from the geotag

create index if not exists idx_bus_audit_buses_locstatus on bus_audit_buses(location_status);

NOTIFY pgrst, 'reload schema';
