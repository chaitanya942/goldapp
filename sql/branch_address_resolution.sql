-- Branch address resolution columns.
-- Tracks Google-resolved address state alongside the existing manual fields.
-- Manual edits (address_verified=true) win over auto-resolution forever after.

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS google_place_id      TEXT,
  ADD COLUMN IF NOT EXISTS lat                  NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS lng                  NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS address_source       TEXT,           -- 'manual' | 'google_geocoding' | 'google_places'
  ADD COLUMN IF NOT EXISTS address_verified     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS address_resolved_at  TIMESTAMPTZ;

-- Helpful index for the admin tool: "branches needing review"
CREATE INDEX IF NOT EXISTS idx_branches_address_unverified
  ON branches (address_verified)
  WHERE address_verified = FALSE;
