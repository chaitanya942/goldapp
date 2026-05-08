-- ─────────────────────────────────────────────────────────────────────────────
-- Per-branch TMP_PRF seeding
-- ─────────────────────────────────────────────────────────────────────────────
-- Sets the "last used" TMP_PRF for each branch so the next generated number
-- matches the branch's physical book exactly. Each branch has its own
-- independent sequence — MYSURU's WG000493 is unrelated to TUMKUR's WG000313.
--
-- HOW IT WORKS
--   - generateTmpPrfNo(supabase, branchName) reads MAX(tmp_prf_no) for that
--     branch only, then returns +1.
--   - We insert ONE status='seed' row per branch holding (next - 1) so the
--     next consignment created in that branch picks up the right number.
--   - Seed rows are filtered out of all normal queries by status='seed'.
--
-- IDEMPOTENT — re-runnable. Each run wipes the previous seed rows and
-- replants. Real (non-seed) consignments are never touched.
--
-- IMPORTANT — CONSTRAINT CHANGE
--   Drops the legacy global UNIQUE on tmp_prf_no. Going forward, two branches
--   can each issue WG000001 independently. Composite UNIQUE
--   (branch_name, tmp_prf_no) protects against duplicates within a branch.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Drop legacy global UNIQUE constraint on tmp_prf_no (no-op if absent).
ALTER TABLE consignments DROP CONSTRAINT IF EXISTS consignments_tmp_prf_no_key;

-- 2. Composite UNIQUE (branch_name, tmp_prf_no) — same number can't be
--    generated twice within the same branch (defence against the read-then-
--    write race in generateTmpPrfNo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'consignments_branch_tmp_prf_unique'
  ) THEN
    ALTER TABLE consignments ADD CONSTRAINT consignments_branch_tmp_prf_unique
      UNIQUE (branch_name, tmp_prf_no);
  END IF;
END $$;

-- 3. Wipe any previous seed rows so this script is idempotent.
DELETE FROM consignments WHERE status = 'seed';

-- 4. Plant one seed row per branch with tmp_prf_no = (desired_next - 1).
INSERT INTO consignments (
  tmp_prf_no, external_no, internal_no, challan_no, branch_name, branch_code,
  state_code, movement_type, status, total_bills, total_net_wt, total_amount,
  created_by, created_at
)
SELECT
  s.seed_no,
  'SEED-' || s.branch_name,                         -- placeholder external_no
  NULL,
  'SEED-' || s.branch_name,                         -- placeholder challan_no
  s.branch_name,
  LEFT(REGEXP_REPLACE(s.branch_name, '^[A-Z]{2,3}-', ''), 3),
  CASE
    WHEN s.branch_name LIKE 'AP-%' THEN 'AP'
    WHEN s.branch_name LIKE 'TS-%' THEN 'TS'
    ELSE 'KA'
  END,
  'EXTERNAL',
  'seed',
  0, 0, 0,
  'SYSTEM_SEED',
  NOW()
FROM (VALUES
  ('MYSURU',                'WG000492'),
  ('TUMKUR',                'WG000312'),
  ('HASSAN',                'WG000248'),
  ('MANGALORE',             'WG000331'),
  ('CHIKMAGALURU',          'WG000172'),
  ('DAVANAGERE',            'WG000243'),
  ('SHIVAMOGGA',            'WG000254'),
  ('HUBLI',                 'WG000314'),
  ('UDUPI',                 'WG000179'),
  ('DEVANAHALLI',           'WG000098'),
  ('MANDYA',                'WG000081'),
  ('KOLAR',                 'WG000000'),
  ('AP-VIJAYAWADA',         'WG000081'),
  ('AP-GUNTUR',             'WG000064'),
  ('AP-TIRUPATHI',          'WG000082'),
  ('AP-RAJAMAHENDRAVARAM',  'WG000021'),
  ('AP-NAD',                'WG000055'),
  ('AP-RAMATALKIES',        'WG000111'),
  ('TS-KUKATPALLY',         'WG000068'),
  ('TS-AS RAO NAGAR',       'WG000036'),
  ('TS-PANJAGUTTA',         'WG000057'),
  ('TS-DILSUKH NAGAR',      'WG000038'),
  ('TS-HIMAYAT NAGAR',      'WG000023'),
  ('TS-TOLI CHOWKI',        'WG000017'),
  ('CHITRADURGA',           'WG000069'),
  ('HOSPETE',               'WG000025'),
  ('VIJAYAPURA',            'WG000043'),
  ('BELAGAVI',              'WG000042'),
  ('AP-NELLORE',            'WG000016'),
  ('AP-ONGOLE',             'WG000025'),
  ('AP-KAKINADA',           'WG000020'),
  ('AP-GAJUWAKA',           'WG000040'),
  ('AP-ANANTAPUR',          'WG000031'),
  ('AP-KURNOOL',            'WG000019'),
  ('TS-CHANDA NAGAR',       'WG000014'),
  ('TS-LB NAGAR',           'WG000011')
) AS s(branch_name, seed_no);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — what each branch's NEXT TMP_PRF will be after this seed.
-- Should match the user's input list exactly.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  branch_name,
  MAX(tmp_prf_no) AS last_used,
  'WG' || LPAD(
    (MAX(NULLIF(REGEXP_REPLACE(tmp_prf_no, '^WG', ''), '')::INT) + 1)::TEXT,
    6, '0'
  ) AS next_will_be
FROM consignments
WHERE tmp_prf_no IS NOT NULL
GROUP BY branch_name
ORDER BY branch_name;
