-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: seed page.purchase-live into role_permissions
-- ─────────────────────────────────────────────────────────────────────────────
-- The Purchase module was split into 3 sub-modules; Live Data Feed became
-- its own page (purchase-live). The sidebar / canSee() check reads the
-- role_permissions table for any role that has DB-configured permissions
-- (which includes super_admin) — and page.purchase-live doesn't exist
-- there yet, so the new sidebar entry resolves to "no access" and stays
-- hidden.
--
-- This clones each role's existing page.purchase-data grant to
-- page.purchase-live (same enabled flag) so whoever can see Purchase Data
-- also sees Live Data Feed — matching how the bundled Live Feed tab was
-- reachable before the split.
--
-- Idempotent — skips any role that already has the purchase-live row.
-- Paste into the Supabase SQL editor and Run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO role_permissions (role_name, permission_key, enabled)
SELECT rp.role_name, 'page.purchase-live', rp.enabled
  FROM role_permissions rp
 WHERE rp.permission_key = 'page.purchase-data'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions x
      WHERE x.role_name = rp.role_name
        AND x.permission_key = 'page.purchase-live'
   );

COMMIT;

-- Verify — should list page.purchase-live alongside page.purchase-data.
SELECT role_name, permission_key, enabled
  FROM role_permissions
 WHERE permission_key IN ('page.purchase-data', 'page.purchase-live')
 ORDER BY role_name, permission_key;
