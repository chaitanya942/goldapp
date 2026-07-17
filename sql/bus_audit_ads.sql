-- ═══════════════════════════════════════════════════════════════════════════
-- BUS AUDIT — AD DETAILS
-- The creative each bus should be carrying, and when it was mounted. Lets the
-- field team verify the RIGHT ad is up (not just any wrap), and gives the
-- founder a "should have X, mounted Y" reference per bus.
--
-- Run once in the Supabase SQL editor, then:
--   node scripts/enrich-bus-list.mjs "C:\path\to\ROK Bus Campaign.xlsx"
-- (the enricher now also fills ad_type + mounting_date).
-- ═══════════════════════════════════════════════════════════════════════════

alter table bus_audit_buses add column if not exists ad_type       text;
alter table bus_audit_buses add column if not exists mounting_date date;

NOTIFY pgrst, 'reload schema';
