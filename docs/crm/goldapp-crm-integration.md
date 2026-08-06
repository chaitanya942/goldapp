# GoldApp ↔ CRM — the integration layer

> **What this document is.** The CRM reference docs (`00-CRM-MASTER.md`, the cluster
> docs, `db-objects-views-functions.md`) describe the *source* systems — what the CRMs
> hold and how they compute it. **This document describes the seam**: every place where
> GoldApp reaches into a CRM, how it connects, what it reads, how it maps that data into
> its own store, how it stays fresh, and the rules that keep two CRMs + one operational
> store from corrupting each other.
>
> **The one-line model:** GoldApp is **read-only** against both CRMs. It mirrors the
> parts it needs into its own Supabase `purchases` table (the "mirror"), and for
> real-time views it reaches *past* the mirror straight into the CRMs. It never writes a
> single row back to a CRM. The boundary is: **CRM owns everything up to the purchase;
> GoldApp owns everything after** — stock movement, consignments, bidding, margins,
> audits, reports — and those post-purchase facts live only in GoldApp columns the sync
> is forbidden to touch.

---

## 1. The two source CRMs

There are **two** live CRMs, mid-migration. GoldApp reads both and unifies them.

| | OLD CRM | NEW CRM |
|---|---|---|
| Engine | MySQL (RDS) | Postgres (RDS, `ap-south-1`, `dbwhitegold_production`) |
| Node driver(s) | `mysql2/promise` | `pg` **and** `postgres` (postgres.js) — different endpoints use different clients |
| Env vars | `CRM_DB_HOST` · `CRM_DB_PORT` (3306) · `CRM_DB_NAME` · `CRM_DB_USER` · `CRM_DB_PASSWORD` | `NEW_CRM_DB_HOSTNAME` (or `NEW_CRM_DB_HOST`) · `NEW_CRM_DB_PORT` (5432) · `NEW_CRM_DB_NAME` · `NEW_CRM_DB_USER` · `NEW_CRM_DB_PASSWORD`; SSL via `NEW_CRM_DB_CA` (else `rejectUnauthorized:false`) |
| Table style | lower_snake (`transac_tbl`, `ornments_tbl`, `branch_tbl`) | quoted PascalCase (`"Transaction"`, `"Ornament"`, `"Payment"`, `"Branch"`, `"Employee"` …) |
| Timezone | server is **UTC**; every date filter shifts to IST with `+ INTERVAL 330 MINUTE` | timestamps shifted `+5:30` in JS (`ts + 5.5h`) |
| App-ID format | `WGKA` + bill_no, **no hyphen** → `WGKA12345` | native `code` already hyphenated → `WGKA-12345` |
| Go-live | historical (all years) | **2026-06-15** (`NEW_CRM_LIVE_DATE`) |

Both CRM credentials are, per infra reality, **read/write superuser** — but the
application issues **SELECT / DESCRIBE / SHOW only**, never a write. That discipline is
enforced by convention, not by a restricted DB role (a `crm_readonly` role is deferred).

---

## 2. The mirror — Supabase `purchases`

Everything the sync pulls lands in one table, `purchases`. Its columns fall into two
strictly separated groups. **This split is the single most important rule in the whole
integration.**

### 2a. CRM-sourced columns — overwritten on every sync (the mirror of CRM truth)

| Column | Source | Notes |
|---|---|---|
| `application_id` | OLD `transac_tbl.bill_no` / NEW `Transaction.code` | **Mutable** — bill_no can be renamed in-CRM. Unique only *per* `crm_source`. |
| `crm_txn_id` (bigint) | CRM row `id` | Stable rename anchor; lets a renamed bill UPDATE in place and keep its `stock_status`. |
| `crm_source` | literal `'old_crm'` / `'new_crm'` | The discriminator. Half of the composite unique key. |
| `crm_status` | `trxn_status` / mapped | `approved` / `pending` / `rejected` / `deleted`. |
| `purchase_date` (date) | **final-payment / invoice day** | NOT walk-in date, NOT created_at, NOT the dashboard's editable updated_at. |
| `transaction_time` | CRM | |
| `customer_name`, `phone_number` | CRM (NEW: name from the `Walkin` record) | |
| `branch_name` | CRM branch, **canonicalized** via `aliasBranchName()` | |
| `transaction_type` | `type_gold` → `PHYSICAL` / `TAKEOVER` | NEW: `RELEASED_*` → `TAKEOVER`. |
| `gross_weight`, `stone_weight`, `wastage`, `net_weight`, `purity` | rolled up from ornament rows | |
| `net_weight_crm`, `net_weight_calculated` | CRM / computed | mismatch-audit pair |
| `total_amount`, `final_amount_crm`, `final_amount_calc` | CRM | |
| `service_charge_pct`, `service_charge_amount_crm`, `service_charge_amount_calc` | CRM / computed | pct clamped 0–100 |
| `id_proof_types`, `id_proof_numbers` | OLD KYC/`cust_addr_tbl` (CSV) | replaced the legacy single `pan_number` |
| `bank_name`, `payment_reference` | CRM | |
| `net_weight_mismatch`, `service_charge_mismatch`, `final_amount_mismatch` | computed flags | |
| `is_duplicate`, `is_deleted` | computed / reconcile | |

### 2b. Operational columns — owned by GoldApp, **NEVER written by the sync**

| Column | Meaning |
|---|---|
| `id` (uuid PK) | Internal identity. Every FK in GoldApp points here — never at `application_id`. |
| `stock_status` | `at_branch` → `in_consignment` → `at_ho` → `sold`. **The reason the sync is an upsert, not a refresh.** |
| `current_branch` | Physical location (branch, or hub after transfer). |
| `dispatched_at`, `received_at` | Consignment movement stamps. |
| `booking_id` (uuid), `booked_at` | Link to a Bidding Volume booking; NULL = still in the bidding pool. |
| `audit_gross_weight`, `audit_discrepancy_g` (generated), `audited_at`, `audited_by`, `audit_remark` | Collection-Audit module. |
| `created_at` | Supabase insert time. |

**How the separation is enforced:** the sync's record object simply *does not contain*
the operational columns. On `INSERT` they fall to their DB defaults; on
`ON CONFLICT DO UPDATE` they are left untouched. This is why the sync **must** be a
non-destructive upsert — an earlier "delete the window, re-insert" design silently reset
`stock_status`/`dispatched_at`/`booking_id` on every 30-second cron cycle.

- **Unique constraint / upsert target:** `UNIQUE(application_id, crm_source)`.
  The same `WGKA…` number can exist once as `old_crm` and once as `new_crm` without
  collision — the `crm_source` discriminator is what makes dual-CRM coexistence safe.
- **RLS** is enabled (region scoping via `user_profiles.allowed_regions`).
- Base table in `supabase_master_seed.sql`; the CRM-identity + operational columns were
  layered on by later `sql/*.sql` migrations.

---

## 3. The heartbeat — `goldapp-cron` (`scripts/cron-sync.mjs`)

Freshness does **not** depend on anyone keeping a browser open. A separate long-lived
**Railway service** (`goldapp-cron`) runs `scripts/cron-sync.mjs`, which `setInterval`s a
tick every **30 s** (`SYNC_INTERVAL_MS`). Each tick fires a fan-out of jobs, all
fire-and-forget and each independently guarded so one slow/broken job can't block the
others. IST is computed as `Date.now() + 5.5h` (Asia/Kolkata is a fixed offset, no DST).

| Job | Endpoint | Cadence | Auth header |
|---|---|---|---|
| OLD-CRM purchase sync | `GET /api/sync-purchases?days=2` | every tick | `Authorization: Bearer CRON_SECRET` |
| NEW-CRM purchase sync | `GET /api/sync-new-crm` | every tick (own in-flight guard) | `Authorization: Bearer CRON_SECRET` |
| EOD inventory snapshot | `POST /api/eod-inventory-snapshot` | once/IST-day after 23:30 | `x-cron-token: CRON_SECRET` |
| At-risk bookings log | `GET /api/consignments?action=bidding_at_risk_summary` | once/IST-day after 19:00 | `x-cron-token` |
| Section-1 EOD audit | `POST /api/bidding/section1-audit` | once/IST-day after 23:30 | `x-cron-token` |
| Branch employee refresh | `POST /api/sync-branch-employees` | once/IST-day + on startup | `x-cron-token` |
| Branch auto-add | `POST /api/sync-branches-auto` | once/IST-day + on startup | `x-cron-token` |
| Scheduled report delivery | `POST /api/reports/dispatch` | every tick (idempotent per schedule/day) | `x-cron-token` |
| Bounce scan | `GET /api/consignments/scan-bounces` | every ~5 min | `Bearer CRON_SECRET` |

Required env on the worker service: `APP_URL`, `CRON_SECRET` (must match the web
service). Optional: `SYNC_INTERVAL_MS` (30 000), `SYNC_DAYS` (2). It logs every tick to
Railway so sync health is scannable from logs.

> **Two cron-auth mechanisms coexist** — this is deliberate, not an inconsistency:
> purchase-sync + bounce use `Authorization: Bearer CRON_SECRET` (checked inline, fully
> bypassing `requireAuth`); the daily/EOD jobs use `x-cron-token: CRON_SECRET`. The
> branch/employee endpoints accept **either** header form.

---

## 4. Purchase sync — NEW CRM (`app/api/sync-new-crm/route.js`)

The most important read path. `pg.Client`, SSL `rejectUnauthorized:false`, 15 s connect
timeout.

**Gate:** if `NEW_CRM_LIVE_DATE` is null, it deletes all `new_crm` test rows and returns
(pre-go-live). Otherwise it computes a **cutoff** = `max(latest synced purchase_date − 7
days, NEW_CRM_LIVE_DATE)` — a 7-day re-scan window that never predates go-live.

**The query** (one row per completed transaction):
- **Weight basis = APPROVED ornaments only** (`o.approve = true`), gathered via *both*
  `quotation_id` and `estimation_id` links (an approved-at-estimation bill still carries
  weight), then **deduped by `ornament_id` keeping the latest** — the NEW CRM can leave a
  duplicate Ornament row per item (one `approve=true`, one leftover), and summing both
  doubled weights. Deduped rows are aggregated: Σ gross/stone/wastage/net, net-weighted
  mean purity, Σ amount.
- **Customer name** comes from the latest `"Walkin"` row (that's the KYC-stage name the
  branch dashboard shows), falling back to `"Customer"`.
- **`service_charge` / `final_amount`** from the latest `"Quotation"`.
- **`final_payment_at`** = `MAX("Payment".created_at)` where `type='FINAL_PAYMENT'` and
  status is `COMPLETED` **or** `CONFIRMED` **or** (`PENDING` and
  `provider_status='processing'`). This is the purchase moment (= invoice day). Including
  `CONFIRMED` matters: a completed txn whose only final payment is `CONFIRMED` (e.g. a
  RELEASED_GOLD/takeover settling as CONFIRMED, not COMPLETED) was otherwise silently
  dropped and stuck at zero.
- **Window:** `WHERE fpay.fp >= cutoff AND t.status IN
  ('FINAL_PAYMENT_COMPLETED','FINAL_PAYMENT_PENDING')` — windowed on the *final-payment*
  date, not created_at, so a bill walked-in before the cutoff but paid recently still
  syncs.

**Mapping highlights:**
- `application_id` = the native hyphenated `code` (`WGKA-XXXX`), whitespace/case
  normalized; a bare code gets a `WGKA-` prefix. **The hyphen is preserved on purpose** —
  it is exactly what distinguishes a new-CRM bill from an old-CRM one; stripping it once
  collapsed both CRMs onto the same `application_id` and caused cross-CRM collisions.
- `crm_status` is always `'approved'` (every returned row is an effective purchase).
- `service_charge` is `clampPct()`-ed to 0–100 (garbage values like 1685.94 would
  overflow the numeric column and, because upserts batch, block every bill in the run).
- `stock_status` and `is_deleted` are **intentionally omitted** (§2b) — a manually
  soft-deleted bill must stay deleted across the 60 s re-syncs.

**Upsert:** batches of 100, `onConflict: 'application_id,crm_source'`. On any batch error
it **falls back to per-row upserts** so one bad record only drops itself (and is named in
`failedIds`) instead of stalling the whole sync — a single bad numeric value once stalled
the sync ~14 h.

**After the upsert:** `recordSyncSuccess()` heartbeat, then a non-fatal
`process_pipeline_attachments` RPC — the NEW-CRM sync is what brings Bangalore bills in,
so it closes any owed bidding pipeline against them immediately (no-overshoot) rather than
waiting for the 23:30 EOD job.

**Triggers:** `POST` = manual, ADMIN only. `GET` = cron, `CRON_SECRET` Bearer.

---

## 5. Purchase sync — OLD CRM (`app/api/sync-purchases/route.js`)

The older, more elaborate path (bill_no is mutable *and* rows can be deleted/recreated in
MySQL, so it carries a full reconcile).

**Main query:** one row per bill from `transac_tbl t LEFT JOIN ornments_tbl o`, ornament
line-items rolled into parallel `GROUP_CONCAT` CSVs, `WHERE t.trxn_status='approved' AND
t.date >= ?` (cutoff = `daysBack` ago, default 2, cron forces 7). Purity is a
net-weight-weighted average; `service_charge_amount = finl_amnt × serv_chr/100`.
Secondary reads: `branch_tbl` (id→name map) and `fetchKycMetaMaps()` (ID proofs from
`cust_addr_tbl`, most-recent bank from `bank_details`, chunked by 1000; placeholder
numbers like `9999…`/`0000…` dropped).

**Mapping:** `application_id` = `WGKA` + bill_no, **no hyphen**; `crm_source='old_crm'`;
`crm_txn_id = t.id` (the stable anchor); `branch_name` **also** run through
`aliasBranchName()` (old CRM stores bare "ADUGODI"/"MYSURU"). `stock_status` omitted (§2b).

**Upsert:** batches of 200, `onConflict: 'application_id,crm_source'`, non-destructive
(the delete-then-insert design was explicitly abandoned — timeouts lost data). Then the
same `process_pipeline_attachments` RPC.

**Three reconcile passes unique to the OLD CRM** (this is the sophisticated part):
1. **In-place rename via `crm_txn_id`** — incoming rows are indexed by `crm_txn_id`;
   existing Supabase rows are paged and, where the `application_id` differs, UPDATE-d in
   place (matched on `crm_txn_id`+`crm_source`) so `stock_status` survives a bill_no
   rename. Counts `renamed` / `renameCollisions`.
2. **Ghost marking** — anything present in Supabase (`old_crm`, approved, in the date
   window) but absent from the CRM's current approved-id set is set `crm_status='deleted'`
   (catches deletes and delete-then-recreate).
3. **Carry-forward** — for a just-ghosted row that had a non-`at_branch` stock_status, it
   looks for a fresh `at_branch` lookalike under a *different* application_id (matched on
   customer_name + branch_name + purchase_date + net_weight < 0.001) and moves
   `stock_status`/`booking_id` across — **but only when exactly ONE match exists** (0 or
   >1 is logged and skipped; never guessed — the "V.1 over-merge lesson").

`smartDedup` preserves every distinct CRM `txn_id`: the smallest keeps the bare bill_no,
the rest get suffixed `-<txn_id>` (an older name+date+amount+phone dedup was abandoned —
it collapsed walk-ins with NULL phone / shared default names, ~25 bills/day).

**Triggers:** `POST` = manual ADMIN (`?days=`); `GET` = cron `CRON_SECRET` Bearer (forces
`days=7`).

---

## 6. Backfill & reconcile tools

| Endpoint / script | Reads | Does | Auth |
|---|---|---|---|
| `POST /api/backfill-purchases` | OLD CRM, `t.date BETWEEN from AND to`, **all statuses** | Inserts new rows (batch 100); patches only proof/bank on existing via RPC `bulk_patch_purchases_proofs` (COALESCE, never touches stock). Sets `stock_status:'at_branch'` on inserts. | ADMIN |
| `GET /api/diag-missing-bills` | OLD CRM approved in range | Read-only report: CRM bills missing from Supabase, dup groups, report-visible count. Writes nothing. | ADMIN |
| `POST /api/cleanup-ghost-bills` | OLD CRM | The only endpoint that mass-marks `crm_status='deleted'`. Three modes (single-date / range / fingerprint). Honors `?dry_run=true`; leaves true orphans untouched. | ADMIN |
| `scripts/backfill-history.mjs` | OLD CRM pre-2025-04 | One-time historical load by hardcoded quarter ranges. **Note:** upserts on `application_id` only (not the composite key). | local |
| `scripts/full-audit.mjs`, `audit-date.mjs` | OLD CRM | Read-only CRM-vs-Supabase count reconciliation. | local |

---

## 7. Branch sync & name canonicalization

### 7a. `POST /api/sync-branches-auto` (NEW CRM — the live path)

Reads `"Branch"` (name/address/city/pin/gstin), the per-branch purchase count from
Supabase, and the existing `branches` master. For each CRM branch name → `aliasBranchName()`
→ canonical. **A branch is added to the master only once it has ≥1 purchase**
("first-purchase → auto-add"), and only if its name passes the validity gate (must be in
the aliased CRM `Branch` set; `IGNORE_NAMES` and length ≥3 filter stray values). New
branches are plain-`insert`ed with derived `region/state/model_type/cluster`
(`lib/branchDerive.js`, filled only where same-prefix peers unanimously agree, else
conservative defaults) and an auto `branch_code`. For existing branches it **backfills
blank address fields only**, and never overwrites a row with `address_verified=true`.
Once/IST-day + on startup. Auth: `CRON_SECRET` (either header) or ADMIN.

### 7b. `lib/crmBranchAlias.js` — `aliasBranchName()`

Normalizes each CRM bill's bare branch name onto GoldApp's canonical name *and* stops
`sync-branches-auto` from recreating a duplicate under the old bare name. Case-insensitive
dictionary lookup, else returns the trimmed UPPERCASE form. The dictionary (~60 entries)
covers: the **Karnataka `KA-` prefix migration** (`'adugodi' → 'KA-ADUGODI'`, `'mysuru' →
'KA-MYSURU'`, …), spelling/variant folding (`'flagship store' → 'KA-VELLARA JUNCTION'`,
`'mangaluru' → 'KA-MANGALORE'`, `'mattikere' → 'KA-MATHIKERE'`, …), and HO folding
(`'ho'`/`'head office' → 'KA-KORAMANGALA'`).

> **⚠ Latent bug — flagged, not fixed.** Both the key-builder and the fallback use
> `.replace(/s+/g, ' ')` — a regex that matches the **literal letter "s"**, not
> whitespace (it was almost certainly meant to be `/\s+/g`). Any name containing "s"
> (Mysuru, Hassan, Hosa Road, Hospete, Basaweshwaranagar…) is mangled *before* the
> dictionary lookup, so those aliases silently fail and the fallback returns a
> corrupted uppercase name. It has been survivable only because **both** the incoming
> bill and the auto-added branch row pass through the *same* mangling, so they still
> match each other — the stored names are just wrong/ugly rather than mis-joined. Worth
> fixing to `/\s+/g`, but that will re-map many branch names and needs a coordinated
> `branches`/`purchases` rename, so it's a decision, not a silent patch.
> ([crmBranchAlias.js:90](../../lib/crmBranchAlias.js#L90), [:94](../../lib/crmBranchAlias.js#L94))

### 7c. Legacy / retired branch tooling

`POST /api/sync-branch-addresses` and `GET /api/crm-branches` read the **OLD CRM MySQL**
`branch_tbl` (schema peeks + a manual upsert). Both are ADMIN-only and **not** on the cron
path — superseded by `sync-branches-auto`. Documented for completeness.

---

## 8. Employee sync & productivity analytics

### 8a. `POST /api/sync-branch-employees` (NEW CRM → Supabase `branch_employees`)

Three queries: the `"Employee"`⋈`"Branch"` roster; **cases opened** (`"Transaction"`
grouped by `emp_id`); and **cases handled** — a `UNION ALL` across every stage artifact's
handler column (`Transaction.emp_id`, `Estimation.negotiation_approved_id`,
`Quotation.quotation_approved_id`, `Payment.employee_id`, `Order.emp_id`,
`KycLog.emp_id`), each normalized against `"Employee"` on both `emp_id` **and** `id`
(handler IDs may be either the code or the UUID). **Strategy = full wipe + re-insert**
(chunk 500) — deliberately clears stale OLD-CRM rows. Migration-resilient: if the insert
errors on newer columns it strips them and retries the core set. Once/IST-day + startup.

`GET /api/branch-employees` is the read side (any authenticated user) — Supabase only.

### 8b. `GET /api/branch-employees/insights` & `GET /api/productivity` (live, no mirror)

Both compute analytics **directly from the NEW CRM per request** (always fresh, no
migration dependency), using a short-lived `pg.Pool` (`max` 6, low `idleTimeout`) to dodge
the CRM's 60 s idle-session timeout; a `withPgRetry()` re-runs once on a stale connection
— **safe precisely because all CRM work here is read-only.**

**Stage-timing reconstruction** (the heart of Productivity — the native `Timer` table is
dead). Per transaction it takes each stage-artifact's min/max timestamps —
`Estimation` (ts, upd), `Quotation` (ts, upd), `Payment` (ts), `Order` (ts),
`KycLog`⋈`Kyc` (earliest `KYC_MAKER`, latest `KYC_CHECKER`) — and derives seven durations
in minutes:

```
val     = Transaction.created_at → first Estimation
estneg  = Estimation span (negotiation / SC approval)
quoprep = Estimation end → first Quotation
quoappr = Quotation span (approval)
kyc     = KYC maker → checker
pay     = KYC-done (or quotation end) → first Payment
order   = first Payment → Transaction.updated_at (completion)
total   = Transaction.created_at → updated_at   (only for FINAL_PAYMENT_COMPLETED)
```

Handlers per stage come from the artifact approver/employee columns mapped through
`"Employee"`. The OLD CRM has only two comparable stages (`process`, `payout`, via
`TIMESTAMPDIFF`). `source=auto|new|old|compare` picks by the cutover date `2026-06-15`.
Region is derived from branch **state** (`Branch.region_id` is unpopulated in the NEW
CRM). Auth: Productivity is the **3-email hard allowlist** (overrides super_admin);
insights is ADMIN-only.

---

## 9. Live gold rates

Two **distinct** rate sources — do not conflate:

| Source | Table / provider | Endpoints | UI |
|---|---|---|---|
| NEW-CRM rate card (per-state buy rates set by ops) | Postgres `"GoldRate"`⋈`"State"` | `GET /api/gold-rates`, `GET /api/purchases/live-rates` | `GoldBuyingRate.js`, Purchases `LiveRates.js` |
| External spot feeds (market reference) | Kalinga (HTTP) + Ambicaa (Firebase) → Supabase `gold_rates` | `GET /api/fetch-gold-rates` (cron writer), `/api/debug-rates` | `LiveMarketRates.js` |

Both CRM-rate endpoints select the latest row per state
(`DISTINCT ON (state_id) … ORDER BY state_id, created_at DESC`) across whatever states
exist (currently Karnataka, Telangana, Andhra Pradesh, Kerala — never hardcoded).
`/api/gold-rates` uses postgres.js with a 15 s in-memory cache and `LEFT JOIN State`;
`/api/purchases/live-rates` uses `pg`, no cache, `INNER JOIN State`, and orders by
`updated_at` first — so the two can occasionally pick a different "latest" row. The UI
maps columns to bands: `rate_24k` → 24K, `rate_22k` → 22K (primary), `rate_17_21k`,
`rate_14_17k`, with a `margin_24k` footer and an "Offline" pill.

> **On the 22K / `margin_24k` band question:** the band-shift mislabel documented in
> `cluster-4-valuation-pricing.md` is a property of the **transaction-snapshot tables**
> (`Estimation`/`Quotation`/`Agreement`), where `margin_24k` is the real 22K payout and
> `rate_22k` actually prices the 18–21K band. On the **`GoldRate`** table these
> live-rate endpoints read, the columns mean what they say (`rate_22k` *is* the 22K buy
> rate; `margin_24k` is a small per-gram spread, not a rate). So the live-rates board
> labelling `rate_22k` as "22K" is **correct** and must **not** apply the band shift —
> an earlier note that flagged this board as mislabelled was mistaken.

`fetch-gold-rates` is a `CRON_SECRET`-Bearer writer to Supabase `gold_rates` (Kalinga +
Ambicaa spot, every minute); `debug-rates` is an ADMIN-only outbound probe.

---

## 10. Direct-read (live) endpoints — reaching past the mirror

For real-time dashboards, several endpoints read the CRMs **live** rather than the ~10 s-lagging mirror. All SELECT-only.

| Endpoint | Reads | Powers | Auth |
|---|---|---|---|
| `GET /api/crm-purchases` (`?action=`) | **Both CRMs live** + Supabase | Live Feed, walk-in pipeline, rejected/pending/blacklisted lists, dashboard flashcards | any authed (region-scoped) |
| `GET /api/purchase-intelligence` | OLD CRM (`transac_tbl`/`customer_walkin`/`branch_tbl`) | Purchase Intelligence dashboard (funnels, branch matrix, repeat customers, aging) | any authed |
| `GET /api/billed-vs-paid` | Supabase `purchases` (billed) + live NEW-CRM `"Payment"` (paid) + `razorpay_payouts` (webhook-fed) | Accounts three-way reconciliation (billed vs paid vs account-match) | page allowlist |
| `GET /api/crm-schema`, `/api/crm-branches`, `/api/crm-transac-columns` | schema/DESCRIBE peeks | Admin schema inspection | ADMIN |
| `GET /api/crm-export-all` | OLD `transac_tbl` streamed | Consignment-Seeds CSV export | ADMIN |

The `crm-purchases` **flashcards** action is the trickiest: it reconciles the Supabase
purchase aggregate (RPC `get_purchase_aggregates`, ~10 s lag) with a *live* NEW-CRM slice
to remove the lag —
`purchased = syncedAggregate − syncedNewCrmSlice + liveNewCrmCompleted` — with a 5 s
in-memory TTL cache keyed by date+region. Every source is `.catch()`-isolated so one CRM
outage degrades gracefully rather than blanking the panel.

**Money note:** GoldApp holds **no money-capable RazorpayX key**. Payout data is read only
from Supabase `razorpay_payouts` (webhook-fed) and matched to cases by UTR / App-ID.

---

## 11. Auth model (`lib/apiAuth.js`)

`ROLE_GROUPS`: `ADMIN` = super_admin/founders_office/admin · `ACCOUNTS` = …/accounts ·
`TELESALES` · `OPERATIONS` = …/manager/branch_staff · `AUDIT` = …/audit · `BUS_AUDIT` =
…/marketing · `ANY` = null (authenticated, no role check).

`requireAuth(req, {requiredRoles, allowServiceToken, skipAuditGate})`:
1. optional `x-internal-token` = `WG_INTERNAL_TOKEN` service bypass (synthetic
   `role:'service'`); 2. `Authorization: Bearer <token>` → `supabase.auth.getUser`;
3. load `user_profiles` (401 missing, 403 inactive); 4. role check;
5. **audit-shift time gate** — `role:'audit'` is 403'd outside its assigned IST shift
   window (`OUTSIDE_SHIFT_WINDOW`); every other role bypasses it.

`requireAuthForPage(req, pageName)` adds page-permission gating: a hard
`PAGE_EMAIL_ALLOWLIST` (checked even before super_admin — this is how Productivity is
locked to 3 emails), else super_admin god-mode, else DB `role_permissions`, else the
static `ROLE_PAGES` fallback. Region scoping: `REGION_BYPASS_ROLES` =
super_admin/founders_office/admin/service see everything; others are filtered by
`user_profiles.allowed_regions`.

**Cron bypass** is *not* through this file — cron endpoints check `CRON_SECRET` (Bearer)
or `x-cron-token` inline, entirely outside `requireAuth` (no user session).

---

## 12. Sync health

`lib/syncHeartbeat.js` upserts Supabase `sync_status` (key `sync_name`):
`recordSyncSuccess` stamps `last_success_at`/`last_attempt_at`/`last_count`, clears
`last_error`; `recordSyncFailure` stamps `last_attempt_at`/`last_error` (sliced 500 chars)
but **deliberately leaves `last_success_at`** so staleness keeps climbing until a real
success. All best-effort (never breaks the sync).

`GET /api/sync-health` (ADMIN): `STALE_MINUTES = 10`, expects `new_crm` + `old_crm`;
`stale = age==null || age>10`. Degrades to `{unavailable:true, anyStale:false}` if the
table is missing. The super-admin in-app notifier polls this and alerts on `anyStale`.

---

## 13. Cross-cutting rules & gotchas

- **App-ID conventions:** OLD = `WGKA12345` (no hyphen); NEW = `WGKA-12345` (hyphen).
  The hyphen is the CRM discriminator; all bank-key lookups strip hyphens + uppercase
  before matching so the two reconcile. `crm_source` is the authoritative discriminator.
- **Purchase date = final-payment/invoice day** everywhere (not walk-in, not created_at,
  not the editable dashboard updated_at).
- **Never delete-then-insert.** The sync is upsert-only; operational columns survive by
  *omission* from the record object.
- **Timezone:** the only raw `+ INTERVAL 330 MINUTE` shift is in
  `lib/purchaseRegisterData.js`'s OLD-CRM query; do **not** rewrite it to a range compare
  (the literals are session-TZ-interpreted). Other OLD-CRM routes filter on raw `t.date`.
- **Pagination:** any `.in(...)` / chunked read uses ≤1000 (Supabase `max_rows`) and ≤~100
  ids per `.in()` URL — larger breaks the loop condition or silently over-runs the URL.
- **Read-only, but not by role.** Both CRM creds are R/W superuser; SELECT-only is a
  convention. The local `scripts/*.mjs` embed **hardcoded** CRM credentials (the
  `nighthack` MySQL superuser, the `marketing@` Postgres reader) — these, plus the
  public repo holding `CRON_SECRET`, are the standing "make private + rotate" debt.
- **Flagged bug:** `aliasBranchName`'s `/s+/g` (§7b).

---

## 14. File map

**Purchase sync:** `app/api/sync-new-crm/route.js` · `app/api/sync-purchases/route.js` ·
`app/api/backfill-purchases/route.js` · `app/api/diag-missing-bills/route.js` ·
`app/api/cleanup-ghost-bills/route.js`
**Branch/employee:** `app/api/sync-branches-auto/route.js` ·
`app/api/sync-branch-employees/route.js` · `app/api/branch-employees/route.js` ·
`app/api/branch-employees/insights/route.js` · `app/api/sync-branch-addresses/route.js` ·
`app/api/crm-branches/route.js` · `lib/crmBranchAlias.js` · `lib/branchDerive.js`
**Rates:** `app/api/gold-rates/route.js` · `app/api/purchases/live-rates/route.js` ·
`app/api/fetch-gold-rates/route.js` · `app/api/debug-rates/route.js`
**Direct reads:** `app/api/crm-purchases/route.js` · `app/api/productivity/route.js` ·
`app/api/billed-vs-paid/route.js` · `app/api/purchase-intelligence/route.js` ·
`app/api/crm-schema/route.js` · `app/api/crm-export-all/route.js` ·
`app/api/crm-transac-columns/route.js`
**Shared / infra:** `scripts/cron-sync.mjs` · `lib/apiAuth.js` · `lib/syncHeartbeat.js` ·
`lib/crmConfig.js` · `app/api/sync-health/route.js` · `lib/purchaseRegisterData.js`
**Target schema:** `supabase_master_seed.sql` + `sql/*.sql` (purchases columns/indexes/RLS)
