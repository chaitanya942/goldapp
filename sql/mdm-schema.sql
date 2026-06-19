-- ─────────────────────────────────────────────────────────────────────────────
-- MDM Portal — isolated schema (Phase 1 + dynamic-form tables)
-- ─────────────────────────────────────────────────────────────────────────────
-- A self-contained data-collection portal for the IT team, fully isolated from
-- GoldApp's operational data:
--   • Its own user pool (mdm_users) — separate from user_profiles. Being in
--     user_profiles does NOT grant MDM access and vice-versa.
--   • IT-admin-gated login: a user can authenticate but the app refuses entry
--     unless mdm_users.active = true (the IT admin's master switch).
--   • Dynamic forms: the admin defines forms + fields at runtime; records are
--     stored as JSONB so new fields never need a schema change.
--
-- All access goes through the /api/mdm/* routes (service-role + requireMdmAuth),
-- so RLS is enabled with NO policies = locked to service_role only. No anon or
-- logged-in client can read these tables directly.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Users — the MDM membership + IT-admin access gate ────────────────────────
CREATE TABLE IF NOT EXISTS mdm_users (
  id            UUID PRIMARY KEY,                         -- = auth.users.id
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active        BOOLEAN NOT NULL DEFAULT false,           -- IT-admin master switch
  invited_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ── Forms — admin-defined collections ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mdm_forms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Fields — the dynamic schema of each form ─────────────────────────────────
CREATE TABLE IF NOT EXISTS mdm_fields (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    UUID NOT NULL REFERENCES mdm_forms(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  field_key  TEXT NOT NULL,                               -- machine key used in record.data
  type       TEXT NOT NULL CHECK (type IN ('text','textarea','number','date','select','checkbox','file')),
  options    JSONB NOT NULL DEFAULT '[]'::jsonb,          -- choices for select
  required   BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, field_key)
);

-- ── Records — submitted entries (flexible JSONB payload) ──────────────────────
CREATE TABLE IF NOT EXISTS mdm_records (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    UUID NOT NULL REFERENCES mdm_forms(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Files — documents uploaded against a record/field ────────────────────────
CREATE TABLE IF NOT EXISTS mdm_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id   UUID REFERENCES mdm_records(id) ON DELETE CASCADE,
  form_id     UUID,
  field_key   TEXT,
  file_name   TEXT,
  storage_path TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  BIGINT,
  uploaded_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mdm_fields_form    ON mdm_fields (form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_mdm_records_form   ON mdm_records (form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_files_record   ON mdm_files (record_id);

-- ── Lock everything to service_role (the API). RLS on, no policies. ──────────
ALTER TABLE mdm_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm_forms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm_fields  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdm_files   ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOTSTRAP the first IT admin (chicken-and-egg: an admin must exist to invite
-- others). Steps:
--   1. Create the IT admin's auth account — Supabase Dashboard → Authentication
--      → Add user (email + password), OR send them an invite.
--   2. Run the statement below with their email to make them an MDM admin.
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO mdm_users (id, email, full_name, role, active)
-- SELECT id, email, 'IT Admin', 'admin', true
--   FROM auth.users WHERE email = 'REPLACE_WITH_IT_ADMIN_EMAIL'
-- ON CONFLICT (id) DO UPDATE SET role = 'admin', active = true;

-- Storage bucket for uploaded documents (Phase 3). Create via:
--   Supabase Dashboard → Storage → New bucket → name "mdm-docs", Private.
-- (Or run: INSERT INTO storage.buckets (id, name, public) VALUES ('mdm-docs','mdm-docs',false) ON CONFLICT DO NOTHING;)
