-- ═══════════════════════════════════════════════════════════════════════════
-- BUS ADVERTISING AUDIT
-- Master list of ~3,600 ad-wrapped buses + field-captured proof photos.
--
-- Flow: marketing team shoots 3–5 photos per bus in the field. Claude vision
-- reads the registration plate off a photo, we normalize it (Latin, Kannada
-- digits folded) and match it to this master list. A bus becomes 'audited'
-- once it has ≥1 confirmed plate shot AND ≥3 photos total. The 6th photo is
-- refused ("audit already done for this bus").
--
-- Run this once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Master list of buses ────────────────────────────────────────────────────
create table if not exists bus_audit_buses (
  id                uuid primary key default gen_random_uuid(),
  reg_number        text not null,                      -- display form from the master list, e.g. "KA-09-F-5029"
  reg_norm          text not null,                      -- match key: uppercase, separators stripped, e.g. "KA09F5029"
  region            text,                               -- optional, only if the master list carries it
  depot             text,
  route             text,
  status            text not null default 'pending',    -- 'pending' | 'audited'
  photo_count       int  not null default 0,
  first_audited_at  timestamptz,
  audited_by        uuid references auth.users(id),
  audited_by_name   text,
  created_at        timestamptz not null default now()
);

-- One row per registration number. Re-importing the master list is idempotent
-- on this key (see scripts/import-bus-list.mjs — upsert on reg_norm).
create unique index if not exists uq_bus_audit_buses_regnorm on bus_audit_buses(reg_norm);
create index if not exists idx_bus_audit_buses_status on bus_audit_buses(status);
create index if not exists idx_bus_audit_buses_region on bus_audit_buses(region);

-- ── Captured photos ─────────────────────────────────────────────────────────
create table if not exists bus_audit_photos (
  id                uuid primary key default gen_random_uuid(),
  bus_id            uuid references bus_audit_buses(id) on delete cascade,
  reg_norm          text,                               -- matched bus key (denormalized for quick reporting)
  storage_path      text not null,                      -- object path inside the 'bus-audit-photos' bucket
  detected_number   text,                               -- raw string Claude read off the plate
  detected_norm     text,                               -- normalized form of detected_number
  matched           boolean not null default false,     -- did detected_norm match a bus in the master list
  is_plate_shot     boolean not null default false,     -- true = this is the confirmed plate photo for the bus
  confidence        numeric,                            -- 0..1 vision confidence
  blur_score        numeric,                            -- client-side sharpness (Laplacian variance); higher = sharper
  uploaded_by       uuid references auth.users(id),
  uploaded_by_name  text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_bus_audit_photos_bus on bus_audit_photos(bus_id);
create index if not exists idx_bus_audit_photos_regnorm on bus_audit_photos(reg_norm);

-- ── Private storage bucket for the photos ───────────────────────────────────
-- Photos are uploaded server-side with the service role (the /submit endpoint),
-- so the bucket stays private and needs no per-user RLS policies.
insert into storage.buckets (id, name, public)
values ('bus-audit-photos', 'bus-audit-photos', false)
on conflict (id) do nothing;

-- ── Page permission ─────────────────────────────────────────────────────────
-- Grant the 'marketing' role (and any others) access to /bus-audit via Role
-- Management, or rely on the ROLE_PAGES fallback in lib/context.js. super_admin
-- always has access.
