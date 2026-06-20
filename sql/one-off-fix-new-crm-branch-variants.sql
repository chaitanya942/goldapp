-- ─────────────────────────────────────────────────────────────────────────────
-- One-off: rewrite already-synced new-CRM purchases that landed under a variant
-- / mis-cased / differently-named branch → GoldApp's canonical name. Mirrors
-- lib/crmBranchAlias.js so existing rows match what future syncs produce.
--
-- Scoped to crm_source='new_crm'. Idempotent — safe to re-run.
-- As of writing only TS-WARANGAL (HANAMKONDA) (1 bill) actually needs Part 1;
-- the case variants (Koramangala/Kolar/Tavarekere) have no synced bills yet but
-- Part 2 future-proofs them. (The lone 'Branch' row is a 0 g TEST bill —
-- WGKA55434 "TEST ASBEER MK", ESTIMATION_PENDING — left alone on purpose.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PART 1 · explicit variant / renamed / differently-named → canonical ──────
-- PREVIEW
WITH amap(variant, canonical) AS (
  VALUES ('flagship store','VELLARA JUNCTION'),
         ('mangaluru','MANGALORE'),
         ('basaveshwarnagar','BASAWESHWARANAGAR'),
         ('bomanahalli','BOMMANAHALLI'),
         ('mattikere','MATHIKERE'),
         ('sunkadkatte','SUNKADAKATTE'),
         ('t c palya','TC PALYA'),
         ('thirupathi','AP-TIRUPATHI'),
         ('ts-warangal (hanamkonda)','TS-WARANGAL'),
         ('jigani','BANNERGHATTA'),
         ('jp nagar 7thphs','JP NAGAR'),
         ('by-pass','KL-VENNALA-BY-PASS'),
         ('cauvery junction','SADASHIVA NAGAR'),
         ('ho','KORAMANGALA'),
         ('head office','KORAMANGALA')
)
SELECT p.branch_name AS current_name, a.canonical AS will_become, count(*) AS bills
  FROM purchases p
  JOIN amap a ON lower(btrim(regexp_replace(p.branch_name,'\s+',' ','g'))) = a.variant
 WHERE p.crm_source = 'new_crm'
 GROUP BY p.branch_name, a.canonical
 ORDER BY p.branch_name;

-- APPLY
BEGIN;
WITH amap(variant, canonical) AS (
  VALUES ('flagship store','VELLARA JUNCTION'),
         ('mangaluru','MANGALORE'),
         ('basaveshwarnagar','BASAWESHWARANAGAR'),
         ('bomanahalli','BOMMANAHALLI'),
         ('mattikere','MATHIKERE'),
         ('sunkadkatte','SUNKADAKATTE'),
         ('t c palya','TC PALYA'),
         ('thirupathi','AP-TIRUPATHI'),
         ('ts-warangal (hanamkonda)','TS-WARANGAL'),
         ('jigani','BANNERGHATTA'),
         ('jp nagar 7thphs','JP NAGAR'),
         ('by-pass','KL-VENNALA-BY-PASS'),
         ('cauvery junction','SADASHIVA NAGAR'),
         ('ho','KORAMANGALA'),
         ('head office','KORAMANGALA')
)
UPDATE purchases p
   SET branch_name    = a.canonical,
       current_branch = CASE WHEN lower(btrim(regexp_replace(coalesce(p.current_branch,''),'\s+',' ','g'))) = a.variant
                             THEN a.canonical ELSE p.current_branch END
  FROM amap a
 WHERE p.crm_source = 'new_crm'
   AND lower(btrim(regexp_replace(p.branch_name,'\s+',' ','g'))) = a.variant;
COMMIT;

-- ── PART 2 · case-only mismatches — match the canonical branches table ────────
-- Fixes Koramangala→KORAMANGALA, Kolar→KOLAR, Tavarekere→TAVAREKERE, and any
-- future case-only difference, by snapping to the exact branches.name spelling.
-- PREVIEW
SELECT p.branch_name AS current_name, b.name AS will_become, count(*) AS bills
  FROM purchases p
  JOIN branches b
    ON lower(btrim(p.branch_name)) = lower(b.name)
   AND p.branch_name <> b.name
 WHERE p.crm_source = 'new_crm'
 GROUP BY p.branch_name, b.name
 ORDER BY p.branch_name;

-- APPLY
BEGIN;
UPDATE purchases p
   SET branch_name    = b.name,
       current_branch = CASE WHEN p.current_branch IS NOT NULL
                              AND lower(btrim(p.current_branch)) = lower(b.name)
                             THEN b.name ELSE p.current_branch END
  FROM branches b
 WHERE p.crm_source = 'new_crm'
   AND p.branch_name <> b.name
   AND lower(btrim(p.branch_name)) = lower(b.name);
COMMIT;
