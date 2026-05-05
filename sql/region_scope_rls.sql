-- sql/region_scope_rls.sql
--
-- Region-scoped Row Level Security for browser-direct queries.
--
-- Architecture:
--   - API routes use service_role key → bypass RLS → enforce scoping in
--     application code via lib/apiAuth.getRegionFilter() and resolveAllowedBranchNames().
--   - Browser-direct queries (Purchases module, Telesales, etc.) use anon key
--     with the user's session → RLS applies → these policies enforce scoping
--     at the database layer. This means even if a future component queries
--     a table directly without going through an API route, the user only
--     sees their region's rows. Defense in depth.
--
-- Roles that BYPASS this scope (always see everything):
--   super_admin, founders_office, admin
--
-- Users with empty/null allowed_regions: also see everything (default permissive).
--
-- Apply via Supabase SQL Editor. Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: returns TRUE iff the calling user (auth.uid()) can see data scoped
-- to the given branch_name. Used by every RLS policy below.
--
-- SECURITY DEFINER + STABLE so the inner SELECTs from user_profiles and
-- branches bypass RLS (otherwise we'd recurse on the branches policy).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_can_see_branch(p_branch_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_role          TEXT;
  v_regions       TEXT[];
  v_branch_region TEXT;
BEGIN
  -- No authenticated user → no access (RLS won't run for service_role)
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT role, allowed_regions
    INTO v_role, v_regions
    FROM public.user_profiles
   WHERE id = v_uid;

  -- No profile → deny (user must be provisioned)
  IF v_role IS NULL THEN RETURN FALSE; END IF;

  -- Bypass roles see everything regardless of allowed_regions
  IF v_role IN ('super_admin', 'founders_office', 'admin') THEN
    RETURN TRUE;
  END IF;

  -- No restriction set → user sees everything (default permissive)
  IF v_regions IS NULL OR array_length(v_regions, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- No branch to filter on → don't block (rare; e.g. company-level rows)
  IF p_branch_name IS NULL THEN RETURN TRUE; END IF;

  -- Look up the branch's region. (SECURITY DEFINER means this bypasses
  -- RLS on branches, so we don't recurse on our own policy.)
  SELECT region INTO v_branch_region
    FROM public.branches
   WHERE name = p_branch_name;

  -- Unknown branch → don't block (data integrity issue, not a security issue)
  IF v_branch_region IS NULL THEN RETURN TRUE; END IF;

  RETURN v_branch_region = ANY(v_regions);
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_see_branch(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissive base policies: ensure the table is readable by authenticated
-- users at all (RLS-enabled tables block reads by default until a policy
-- grants access). These are idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchases' AND policyname='authenticated read purchases') THEN
    CREATE POLICY "authenticated read purchases"      ON purchases      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='consignments' AND policyname='authenticated read consignments') THEN
    CREATE POLICY "authenticated read consignments"   ON consignments   FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='consignment_items' AND policyname='authenticated read consignment_items') THEN
    CREATE POLICY "authenticated read consignment_items" ON consignment_items FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='branch_employees' AND policyname='authenticated read branch_employees') THEN
    CREATE POLICY "authenticated read branch_employees" ON branch_employees FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RESTRICTIVE region-scope policies. These AND with any other SELECT policies,
-- so they tighten access without needing to drop existing permissive ones.
-- ─────────────────────────────────────────────────────────────────────────────

-- purchases: visible if EITHER origin (branch_name) OR current_branch is in user's allowed regions.
-- "OR" because a Kerala manager should see bills they originated AND bills currently at a Kerala hub.
DROP POLICY IF EXISTS region_scope_select_purchases ON purchases;
CREATE POLICY region_scope_select_purchases
  ON purchases AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    public.user_can_see_branch(branch_name)
    OR public.user_can_see_branch(current_branch)
  );

-- consignments: scoped by source branch (where the consignment originated).
DROP POLICY IF EXISTS region_scope_select_consignments ON consignments;
CREATE POLICY region_scope_select_consignments
  ON consignments AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.user_can_see_branch(branch_name));

-- consignment_items: scoped via parent consignment's source branch.
DROP POLICY IF EXISTS region_scope_select_consignment_items ON consignment_items;
CREATE POLICY region_scope_select_consignment_items
  ON consignment_items AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM consignments c
       WHERE c.id = consignment_id
         AND public.user_can_see_branch(c.branch_name)
    )
  );

-- branches: scoped by branch name itself (a branch IS the region holder).
DROP POLICY IF EXISTS region_scope_select_branches ON branches;
CREATE POLICY region_scope_select_branches
  ON branches AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.user_can_see_branch(name));

-- branch_employees: scoped via parent branch (telesales views — agent should
-- only see employees of branches they have access to).
DROP POLICY IF EXISTS region_scope_select_branch_employees ON branch_employees;
CREATE POLICY region_scope_select_branch_employees
  ON branch_employees AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    branch_id IS NULL
    OR EXISTS (
      SELECT 1 FROM branches b
       WHERE b.id = branch_id
         AND public.user_can_see_branch(b.name)
    )
  );

-- consignment_activity_log (audit trail): scoped via parent consignment, if the table exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='consignment_activity_log') THEN
    EXECUTE 'ALTER TABLE consignment_activity_log ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='consignment_activity_log' AND policyname='authenticated read consignment_activity_log') THEN
      EXECUTE $POL$
        CREATE POLICY "authenticated read consignment_activity_log"
          ON consignment_activity_log FOR SELECT TO authenticated USING (true)
      $POL$;
    END IF;
    EXECUTE 'DROP POLICY IF EXISTS region_scope_select_consignment_activity_log ON consignment_activity_log';
    EXECUTE $POL$
      CREATE POLICY region_scope_select_consignment_activity_log
        ON consignment_activity_log AS RESTRICTIVE
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM consignments c
             WHERE c.id = consignment_id
               AND public.user_can_see_branch(c.branch_name)
          )
        )
    $POL$;
  END IF;
END $$;
