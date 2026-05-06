-- sql/heatmap_projects.sql
--
-- Registry of heatmap-tracking projects across all tools (GoldApp + Treasury + Telesales + future).
-- Each row = one Microsoft Clarity project. Admin pastes the generated snippet into
-- the corresponding tool's <head>; heatmaps appear in the Clarity dashboard at
-- clarity.microsoft.com filtered by that project.
--
-- Apply via Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS heatmap_projects (
  id           TEXT PRIMARY KEY,                  -- slug: 'goldapp', 'treasury', etc.
  name         TEXT NOT NULL,                     -- display name: 'Treasury App'
  description  TEXT,                              -- short blurb for the admin UI
  project_id   TEXT,                              -- Clarity project id (the ID after clarity.ms/tag/)
  is_internal  BOOLEAN DEFAULT FALSE,             -- TRUE = goldapp itself (script lives in code)
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._heatmap_projects_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS heatmap_projects_touch ON heatmap_projects;
CREATE TRIGGER heatmap_projects_touch BEFORE UPDATE ON heatmap_projects
  FOR EACH ROW EXECUTE FUNCTION public._heatmap_projects_touch();

ALTER TABLE heatmap_projects ENABLE ROW LEVEL SECURITY;

-- All authenticated users can READ the registry (so non-admins can see what's tracked).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'heatmap_projects' AND policyname = 'authenticated read heatmap_projects') THEN
    CREATE POLICY "authenticated read heatmap_projects"
      ON heatmap_projects FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Only admin roles can INSERT / UPDATE / DELETE — enforced via a helper that reads user_profiles.role.
-- We use the same SECURITY DEFINER pattern as user_can_see_branch.
CREATE OR REPLACE FUNCTION public.user_is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
  RETURN v_role IN ('super_admin', 'founders_office', 'admin');
END $$;
GRANT EXECUTE ON FUNCTION public.user_is_admin() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'heatmap_projects' AND policyname = 'admin write heatmap_projects') THEN
    CREATE POLICY "admin write heatmap_projects"
      ON heatmap_projects
      FOR ALL TO authenticated
      USING (public.user_is_admin())
      WITH CHECK (public.user_is_admin());
  END IF;
END $$;
