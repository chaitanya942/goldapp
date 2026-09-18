-- sql/dashboard_audit_log.sql
--
-- Audit trail for Dashboard access/viewing activity. Append-only: writes only
-- ever happen via the service-role client in app/api/dashboard-audit-log/route.js
-- (POST), never via a direct client insert. There is deliberately no INSERT/
-- UPDATE/DELETE policy for authenticated/anon at all, so the log cannot be
-- forged or edited by any normal user even via a direct table/RPC call — RLS
-- blocks it, and only the service role (which bypasses RLS) can write.
--
-- Apply via Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS dashboard_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL,                    -- auth.users id, server-derived from the bearer token
  user_email     TEXT NOT NULL,                    -- denormalized, server-derived
  user_name      TEXT,                              -- denormalized full_name, server-derived
  user_role      TEXT NOT NULL,                    -- role at time of access, server-derived
  session_id     TEXT,                              -- per-tab id, client-generated (sessionStorage)
  page           TEXT NOT NULL,                    -- 'dashboard' | 'dynamic-dashboard'
  section        TEXT,                              -- 'Purchase Overview' | 'Consignment Overview' | 'Sales Overview' | ...
  region         TEXT,                              -- active region/state filter, if any
  branch         TEXT,                              -- active branch filter, if any
  period         TEXT,                              -- human label, e.g. 'Last 7 days', '2026-09-01 to 2026-09-07'
  filters        JSONB,                             -- free-form extra filters: { txnType, source, ... }
  access_result  TEXT NOT NULL DEFAULT 'granted',   -- 'granted' | 'denied'
  denied_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_audit_log_user_ts ON dashboard_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_audit_log_ts      ON dashboard_audit_log(created_at DESC);

ALTER TABLE dashboard_audit_log ENABLE ROW LEVEL SECURITY;

-- Strictly role = 'super_admin' (not the broader admin-tier used elsewhere,
-- e.g. public.user_is_admin() in sql/heatmap_events.sql, which also allows
-- founders_office/admin) — the spec for this log is "only super admin roles."
CREATE OR REPLACE FUNCTION public.user_is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
  RETURN v_role = 'super_admin';
END $$;
GRANT EXECUTE ON FUNCTION public.user_is_super_admin() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dashboard_audit_log' AND policyname='super_admin read dashboard_audit_log') THEN
    CREATE POLICY "super_admin read dashboard_audit_log"
      ON dashboard_audit_log FOR SELECT TO authenticated
      USING (public.user_is_super_admin());
  END IF;
END $$;
