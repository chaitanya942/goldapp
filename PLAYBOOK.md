# Operations Platform Playbook

> A practitioner's playbook for building, running, and evolving a multi-database
> operations app. Written against the GoldApp codebase (gold-buying ops for a
> jeweller chain) but the patterns transfer to anything that has to mirror a
> legacy operational system into a modern app stack while staying live.
>
> Audience: a competent developer new to this kind of problem. Assumes JS/TS
> familiarity but not Next.js, Supabase, or RBAC. Read top-to-bottom on day one;
> use it as a reference after that.

---

## Contents

1. [What the app actually does](#1-what-the-app-actually-does)
2. [Tech stack & where things run](#2-tech-stack--where-things-run)
3. [Architecture: the three-database design](#3-architecture-the-three-database-design)
4. [The build, phase by phase](#4-the-build-phase-by-phase)
5. [Sync engine deep dive](#5-sync-engine-deep-dive)
6. [UI architecture & design language](#6-ui-architecture--design-language)
7. [Permission system (RBAC)](#7-permission-system-rbac)
8. [Operational conventions](#8-operational-conventions)
9. [Mistakes we made & what we learned](#9-mistakes-we-made--what-we-learned)
10. [Future roadmap](#10-future-roadmap)
11. [Files you'll touch most often](#11-files-youll-touch-most-often)
12. [Working with Claude on this codebase](#12-working-with-claude-on-this-codebase)

---

## 1. What the app actually does

A jeweller chain runs ~110 branches across South India. People walk in to sell
their gold. A branch employee takes the gold, weighs it, records the bill in
the old CRM (MySQL, written ~2018), the customer is paid, the gold is later
shipped to HQ, melted, and accounted for.

The app does five things on top of that flow:

| Module | Job |
|---|---|
| **Purchases** | Live tab + historical reports of every bill the CRM produced. Slices by region/branch/period. |
| **Consignments** | Track gold from branch → in-transit → HQ → melted. Generate transport documents (e-way bills, e-invoices). Ops's daily workflow. |
| **Sales (Cal Table)** | Pricing/quotation tool for buying gold. |
| **Live Feed** | Real-time view of today's walk-ins, conversions, branch hot/cold zones. |
| **Admin** | Branch master, user management, role permissions, gold-rate display, etc. |

The CRM is where the company actually runs. The app is where the company is
*managed* — execs see consolidated numbers, ops triggers movements, accounts
approves dispatches, leadership sees insights. The CRM does not change. The app
mirrors it and adds the layer on top.

**Why this matters for design**: the app cannot be the source of truth for
transactional data. Bills are created in the CRM. They flow into the app for
display, aggregation, and downstream workflow.

---

## 2. Tech stack & where things run

| Layer | Tech | Hosted on |
|---|---|---|
| Frontend + API routes | Next.js 16 (App Router) + React | Railway |
| App database | Supabase (managed Postgres) | supabase.com |
| Legacy operational DB ("old CRM") | MySQL 8 | Lightsail in `ap-south-1` |
| New CRM DB | PostgreSQL | Lightsail in `ap-south-1` |
| Background sync worker | Node.js script | Railway (second service) |
| Auth | Supabase Auth (JWT) | bundled with Supabase |
| File storage (KYC docs, etc.) | Supabase Storage | bundled |
| External API integrations | ClearTax (e-invoice / e-way bill via REST), NIC IRP (cancel flows) | their cloud |

Why Railway: one click deploys from GitHub `main`. The team is small; CI is
auto-deploy on push. No staging environment.

Why Supabase: managed Postgres + auth + storage + row-level security in one
product. The team is two devs — every saved hour matters.

Why Next.js with App Router: filesystem-routed API endpoints sit next to React
pages in the same repo, single deploy. App Router gives us per-route auth
patterns without a separate API gateway.

---

## 3. Architecture: the three-database design

```
┌──────────────┐    sync     ┌──────────────┐
│   Old CRM    │ ─────────▶  │              │
│   (MySQL)    │  every 30s  │              │
│              │             │              │
│ Bills,       │             │   Supabase   │ ─── App reads ───▶ Browser
│ Customers,   │             │  (Postgres)  │
│ Walk-ins     │             │              │
└──────────────┘             │              │
                             │  Purchases,  │
┌──────────────┐    (read    │  Consign-    │
│   New CRM    │   direct,   │  ments,      │
│  (Postgres)  │   not       │  Users,      │
│              │   synced)   │  Permissions │
│ Gold rates,  │ ──────────▶ │  Audit logs  │
│ Newer txns,  │             │              │
│ Stages       │             │              │
└──────────────┘             └──────────────┘
```

### Why three databases?

1. **Old CRM** is the *operational* source of truth, written by branch staff
   in real time. We don't own it. We can't change its schema. We read from it.
2. **New CRM** is a parallel system the company is migrating to. Some data
   only exists there (live gold rates, newer transactions). Eventually old
   CRM retires — until then, both are live.
3. **Supabase** is *ours*. Everything app-specific lives here:
   consignment workflow state, user permissions, audit trails, branch master,
   stock movement state. Plus a *mirror* of the CRM bills, so we can:
   - Run rich joins (region grouping, ageing analysis) without crushing CRM
   - Add columns CRM doesn't have (`stock_status`, `booking_id`, `crm_txn_id`)
   - Survive a CRM outage with the most recent snapshot
   - Use a single auth system across everything

### What lives where

| Data | Source of truth | Mirrored to Supabase? |
|---|---|---|
| Bills (`purchases`) | Old CRM `transac_tbl` | Yes, via sync |
| Walk-ins | Old CRM `customer_walkin` | No — read directly when needed |
| Gold rates | New CRM `GoldRate` | No — read directly |
| Consignments (workflow) | Supabase | n/a |
| Stock status (at_branch / in_consignment / at_ho) | Supabase | n/a (overlay on mirrored bills) |
| Users, roles, permissions | Supabase | n/a |
| Branch master | Supabase | n/a |

**Rule of thumb**: anything CRM produces is mirrored read-only. Anything the
app needs to author (workflow state, audit, configuration) lives in Supabase
exclusively.

---

## 4. The build, phase by phase

Useful for someone starting a similar project. Build order matters — get the
data flowing before designing the dashboard.

### Phase 1: read-only mirror

1. **Pick the source of truth.** Identify the operational system you must
   mirror. Get read credentials. Confirm what tables/columns matter.
2. **Build the sync.** A single endpoint that pulls from source → upserts into
   your DB. Idempotent. Re-running it should produce the same result.
3. **Decide the upsert key.** This is *the* most important decision in the
   build. Pick something stable across edits in the source system. **Do not
   use any field the source's users can edit** (bill numbers, names, anything
   typed in). Use the source's primary key (auto-incrementing or UUID).
4. **Build the simplest view.** A page that shows "today's records". Confirm
   the count matches what the source system shows. If counts diverge, your
   sync is wrong — fix before continuing.

### Phase 2: workflow on top

1. **Add app-only columns to the mirror table.** Status fields, workflow
   timestamps, booking links — things CRM doesn't have but you need.
2. **Set defaults.** `stock_status = 'at_branch'` on insert; existing rows
   keep their value on subsequent upserts.
3. **Build the workflow UI.** Buttons that mutate the app-only columns.
   Never write back to the source system unless you fully own the write path.

### Phase 3: auth & permissions

1. **Use managed auth from day one** (Supabase Auth, Clerk, Auth0). Rolling
   your own delays the build by months and you get it wrong.
2. **Start with hardcoded roles** (`ROLE_PAGES` map in source code) — every
   role gets a fixed set of pages. This works for the first 6 months.
3. **Move to DB-driven permissions** once you have 3+ roles and people want
   to tweak. `role_permissions` table: `(role_name, permission_key, enabled)`.
   Fall back to the hardcoded map when DB has no rows for a role.

### Phase 4: aggregations & insights

1. Build server-side aggregation RPCs (Postgres functions). They're faster
   than fetching rows to the client. They also let you cache the same query
   shape across UI surfaces.
2. **One aggregation function, multiple UIs.** Dashboard panel, reports tab,
   admin overview — all consume the same RPC. Guarantees numbers can't
   disagree.

### Phase 5: live freshness

1. Start with client-side polling on a 30-60s interval. Good enough.
2. Add a sync trigger when users open key pages, so navigating in
   doesn't show stale data.
3. When freshness needs to survive nobody-in-app intervals → add a
   server-side cron/worker. Critical: it must not depend on a browser session.

### Phase 6: real-time CRM-direct surfaces (optional)

Some surfaces (Live Feed flashcards in our case) need to feel real-time.
Read the source system directly, bypassing the mirror. Trade-off: you can't
join with app-owned data; you pay the source system's query latency.

### Phase 7: ops tooling

Audit logs. Health badges. Background-job status. Sync freshness indicators.
These exist to answer the question "is everything still working?" without
opening Railway logs.

---

## 5. Sync engine deep dive

The most engineering-dense part of the codebase. Most production bugs in this
class of system live in sync. Get this right.

### The core flow

```
1. Pull all records from the source where mtime/date is in our window.
2. Map source fields → mirror schema.
3. Dedupe within the batch (see below).
4. Detect identity changes (see below).
5. Upsert into mirror table.
6. Reconcile: anything in the mirror's window that isn't in this batch is
   marked deleted in the mirror.
```

The window is typically "last N days". 2 days is a sweet spot — covers
yesterday's stragglers plus today, doesn't pull years of history.

### Three landmines in sync logic

#### 1. Dedup is too aggressive

Tempting code: "if two rows look the same (name + date + weight + amount + phone),
drop the duplicate." Sounds reasonable.

**Don't do this.** Real-world data has:
- Walk-ins with `phone = NULL` and default names.
- Two legitimate transactions from the same customer same day.
- Bills accidentally entered twice — which sometimes you *do* want, because
  the user will void one in the source system and you should mirror that void.

The right rule: **never drop a record**. Every distinct primary-key in the
source is a row in the mirror. If two records would collide on your upsert
key, suffix one to make it unique.

```js
// Group records by upsert key. Smallest source-PK keeps the bare key;
// the rest get suffixed with their source-PK to disambiguate.
function smartDedup(records) {
  const groups = new Map()
  for (const r of records) {
    if (!groups.has(r.application_id)) groups.set(r.application_id, [])
    groups.get(r.application_id).push(r)
  }
  const result = []
  for (const group of groups.values()) {
    group.sort((a, b) => Number(a._txn_id) - Number(b._txn_id))
    for (let i = 0; i < group.length; i++) {
      const r = group[i]
      result.push(i === 0 ? r : { ...r, application_id: `${r.application_id}-${r._txn_id}` })
    }
  }
  return result
}
```

We learned this the hard way. The old dedup was silently dropping 20-30 bills
per day. Operations couldn't create consignments for the missing ones.

#### 2. Upsert key uses a mutable field

If your upsert key is "bill number" and bill numbers can be edited in the
source system, a rename looks like "new bill" to your sync — you insert a
fresh row and the original becomes an orphan. Any app-only columns
(`stock_status`, workflow state) on the original are *lost*.

**Fix:** add a hidden stable identity column.

```sql
ALTER TABLE purchases ADD COLUMN crm_txn_id BIGINT;
CREATE INDEX idx_purchases_crm_txn_id
  ON purchases (crm_txn_id, crm_source)
  WHERE crm_txn_id IS NOT NULL;
```

Then in sync, before the upsert:

```js
// For each incoming record, find the existing mirror row by crm_txn_id.
// If the incoming application_id differs from what's stored, UPDATE the
// application_id in place. The subsequent upsert then matches by the
// renamed application_id and updates everything *except* stock_status
// (which we never include in the upsert payload — see below).
for (const existing of existingRows) {
  const incomingAppId = incomingByTxn.get(existing.crm_txn_id)
  if (incomingAppId && existing.application_id !== incomingAppId) {
    await supabase.from('purchases')
      .update({ application_id: incomingAppId })
      .eq('crm_txn_id', existing.crm_txn_id)
  }
}
```

`application_id` remains the user-facing primary key; `crm_txn_id` is the
hidden anchor. Users never need to know it exists.

#### 3. Timezone footgun in WHERE clauses

The fastest WHERE clause in MySQL uses an index on the date column directly:
`WHERE date >= '2026-05-12 18:30:00' AND date < '2026-05-13 18:30:00'`.

This depends on MySQL interpreting the literal in the same timezone as the
column is stored. If session timezone differs (it often does on managed
hosts), the boundary shifts and you silently include/exclude rows.

The slow but **timezone-independent** alternative:

```sql
WHERE DATE(date + INTERVAL 330 MINUTE) = '2026-05-13'
```

The `+ INTERVAL 330 MINUTE` explicitly converts UTC to IST regardless of
session config. Costs a function call (no index use) but the result is
deterministic.

**Rule:** for filters that decide what data appears in the app's view of
"today", use the explicit-interval form. Index-friendly rewrites are
optimisations for *unimportant* queries, never for boundary-defining ones.

### Sync ownership: don't depend on browsers

Initial pattern: trigger sync from the dashboard every N seconds. Works during
business hours. Fails on weekends, lunch breaks, and when everyone has the
app closed.

**Pattern that works:** a separate, long-lived worker service.

```js
// scripts/cron-sync.mjs
const ENDPOINT = `${process.env.APP_URL}/api/sync-purchases?days=2`
const HEADERS  = { Authorization: `Bearer ${process.env.CRON_SECRET}` }

let inFlight = false

async function syncOnce() {
  if (inFlight) return    // guard prevents overlap on slow syncs
  inFlight = true
  try {
    const res = await fetch(ENDPOINT, { headers: HEADERS })
    console.log(await res.json())
  } finally {
    inFlight = false
  }
}

syncOnce()
setInterval(syncOnce, 60_000)
```

Deploy as a second service. Same repo, different start command. The endpoint
it hits authenticates with a shared secret (`CRON_SECRET` env var on both
services).

### Freshness contract

Be explicit about what "live" means for each surface:

| Surface | Acceptable lag |
|---|---|
| Headline counters that drive decisions | 30s |
| Detailed tables, reports | 60s |
| Historical aggregates | 5 minutes |
| "Real-time" feeds (walk-ins as they happen) | source-system latency only (no mirror) |

State these aloud with stakeholders. They'll surface their actual tolerance
(usually looser than you'd assume), which lets you simplify.

### Single source of truth — don't blend

Tempting design: "the dashboard shows Supabase counts, but for *today* we
patch them with a real-time CRM read so the number feels live."

Don't do this. Two paths producing one number is two paths that can disagree.
Every divergence becomes "is the number wrong, or is one of the paths buggy?"
You'll spend more time debugging the blend than the sync would lag.

**Rule:** pick one source per number, document it, accept the lag.

---

## 6. UI architecture & design language

### Stack

- React + Next.js App Router (filesystem routing, RSC where it makes sense)
- No CSS framework. Inline styles with theme tokens. Atomic CSS gets noisy at
  ~30 components; inline + tokens stays manageable past 100.
- One global `<style>` block per page for keyframes and global selectors.
- `recharts` for graphs. `lucide-react` for icons (some hand-rolled SVG too).

### Theme tokens

```js
const t = {
  bg: '#0a0a0a', panel: '#141210', panel2: '#1a1612', border: '#2a2520',
  text1: '#f0e6c8', text2: '#c8b890', text3: '#7a6a4a', text4: '#5a4a2a',
  gold: '#c9a84c', goldDim: 'rgba(201,168,76,.12)',
  green: '#3aaa6a', orange: '#e58a3b', red: '#e05555',
}
```

Pass `t` down explicitly. Light mode is the same structure with different
values. The whole app rebuilds visually from a few dozen tokens.

### Module structure

```js
// lib/modules.js — single source of truth for navigation
export const MODULES = [
  { id: 'purchases', label: 'Purchases', tabs: [
    { id: 'purchase-data', label: 'Live Data' },
    { id: 'purchase-reports', label: 'Reports' },
  ]},
  // ... more modules
]
```

The sidebar reads this, the mobile menu reads this, the dashboard "your
modules" tiles read this. Add a tab here once, it appears everywhere.

### Stale-while-revalidate

Background refreshes never show shimmer skeletons. Shimmer is reserved for
"this is the first time you've seen this view".

```js
const fetchData = async ({ silent = false } = {}) => {
  if (!silent) {
    setLoading(true)
    setRows([])  // only clear arrays on loud refresh
  }
  const data = await api.fetch(...)
  setRows(data.rows)
  if (!silent) setLoading(false)
}

// User-driven action (period change, filter change) → loud
useEffect(() => { fetchData() }, [period, filter])

// Background tick → silent
useEffect(() => {
  const id = setInterval(() => fetchData({ silent: true }), 10_000)
  return () => clearInterval(id)
}, [])
```

Result: numbers tick up smoothly. Headers update. Tables don't flash empty
then re-fill.

### Common chrome

Every operational page has:

1. **Header** — title + a "Live" pill + timestamp pill (`Synced 12s ago`)
2. **Period selector** for time-sliced data (Today / Yesterday / This Week / MTD)
3. **Filter row** (region / state / cluster / branch)
4. **Refresh button** — explicit user-driven sync trigger
5. **Empty state** with a faint icon + one-line explainer ("No activity this period")

The freshness pill is the single most important UI element after the data
itself. It tells operators whether they're looking at reality.

---

## 7. Permission system (RBAC)

### Three layers

1. **Static fallback** (`ROLE_PAGES` in `lib/context.js`) — a map of
   `role → [page IDs]`. Used when a role has no DB-stored permissions.
2. **DB-driven permissions** (`role_permissions` table) — granular
   `(role_name, permission_key, enabled)` rows. Override the static map.
3. **Server-side enforcement** (`lib/apiAuth.js`) — every API route declares
   what role group OR what page permission it requires.

### Permission keys

```
page.<page-id>                  → can navigate to this page
tab.<page-id>.<tab-id>          → can see this tab within a page
element.<page-id>.<feature-id>  → can see this UI element within a page
livefeed.<area>                 → granular tab in the live feed
action.<verb>                   → can perform this action (delete, edit, export)
```

This lets you say "manager can see Purchases page, but not the export
button". Granularity matters once you have 5+ roles.

### `canSee()` resolution

```
1. If super_admin and key in ALWAYS_ON_FOR_SUPER_ADMIN → true (god-mode).
2. If preview mode active → resolve against preview role's permissions.
3. If user's role has DB rows in role_permissions →
   - Element/tab/livefeed key: cascading resolution.
   - Page key: check 'page.<key>' or any 'tab.<key>.*' in the Set.
4. Else fall back to static ROLE_PAGES map.
5. Unknown role with no map entry → deny.
```

### `requireAuth` vs `requireAuthForPage` (server-side)

Two patterns:

```js
// Pattern A: role-based (legacy, hardcoded list)
const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })

// Pattern B: page-permission-based (respects role_permissions)
const auth = await requireAuthForPage(req, 'consignment-seeds')
```

Pattern B is the right default for any endpoint backing a page that gets
selectively delegated. Pattern A is fine for endpoints that semantically
belong to a fixed role group (e.g. accounts-only approval flows).

**Lesson:** if an admin grants a non-admin role access to a page via the UI
and the API still rejects them, you used Pattern A where Pattern B was
needed. Migrate one endpoint at a time as the need arises.

### Region scoping

Some users see only the regions they own. `user_profiles.allowed_regions`
holds a TEXT[] of region names. The server resolves the user's allowed
branches from this and applies them as a `p_region_branches` filter to every
aggregate RPC. Bypass roles: `super_admin`, `founders_office`, `admin`.

### What we don't do

- No row-level security (RLS) enforced at Postgres. All permission checks are
  in app code. RLS-first designs are theoretically purer but require deeper
  schema discipline than this team is willing to commit to right now.
- No per-user permissions. Permissions are per-role only.

---

## 8. Operational conventions

### Deploy on every change

`git push origin main` → Railway deploys. There's no staging environment.
This forces:

1. **Small commits.** Each commit ships independently.
2. **Idempotent migrations.** SQL files use `IF NOT EXISTS`. Re-running them
   is safe.
3. **Backwards-compatible schema changes.** Add nullable columns. Don't drop
   columns until you're sure nothing reads them. Two-deploy rename: add new
   column → migrate code → drop old column.

### Pre-deploy SQL migrations

If a commit needs a SQL migration:

1. Write the SQL file in `sql/`.
2. **Run the SQL in Supabase SQL editor *first*.**
3. Then `git push` the code that depends on it.

If you flip the order, the deploy lands with the code expecting a column
that doesn't exist, and the relevant endpoints fail for the duration of the
gap. Don't.

### Don't commit secrets

Local scripts that need to connect to dev databases use `.env.local` (gitignored).
Production env vars live in Railway dashboard. Never paste secret values in
chats with anyone, including AI assistants — every conversation log is one
breach away from public.

### Auto-refresh and in-flight guards

Anywhere you have a polling loop:

```js
let inFlight = false
const tick = async () => {
  if (inFlight) return
  inFlight = true
  try { await doWork() } finally { inFlight = false }
}
```

Without the guard, a slow request pile-up happens silently. With it, slow
requests just delay the next tick — visible in logs as "skipping tick"
instead of resource exhaustion.

### Pagination chunk size

Supabase's PostgREST has a `max_rows` ceiling (default 1000). If you paginate
with `CHUNK = 5000`, your loop never terminates because the server caps each
response at 1000 and your break condition (`data.length < CHUNK`) is never
true. **Set CHUNK to match `max_rows` exactly.**

### Background refresh ≠ visible refresh

State management rule:

- User-driven actions (filter change, period change, refresh button) → can
  show shimmer / loading states.
- Background ticks (interval, visibility-change, focus, post-sync refetch) →
  must not show shimmer. Update silently. Numbers tick in place.

Stakeholders watching the dashboard see flickers as bugs. They are, even if
the numbers are correct underneath.

---

## 9. Mistakes we made & what we learned

The honest list. Worth reading once.

### 1. The 25-bill gap

`smartDedup` was dropping records based on name + date + weight + amount + phone.
Walk-ins with NULL phone matched each other and got collapsed. 20-30 bills
per day silently disappeared.

**Lesson:** never drop, only ever rename. If the upsert key would collide,
suffix it. The fix unlocked consignment creation for the missing bills
overnight.

### 2. The wrong-weight override

Tried to make the dashboard panel "match the Live Feed flashcards exactly"
by overlaying a CRM-live fetch on top of the Supabase aggregate. The
overlay's NET weight calculation was wrong and the dashboard showed 35%
less weight than the report. Visible to stakeholders.

**Lessons:**
- One number, one source. Don't blend.
- "Visible to stakeholders" is a different correctness bar than "passes
  tests". Trust erodes faster than it builds.

### 3. The timezone-rewrite

Tried to speed up a slow `WHERE DATE(...)` clause by switching to a
range-based comparison. MySQL session was IST, not UTC, so my UTC-bound
literals meant something different than I assumed. The rewrite silently
included/excluded rows. Caught only when stakeholders noticed the dashboard
number was off.

**Lessons:**
- Boundary-defining queries are not the right place to optimise.
- When rewriting a query, diff the resulting row set against the original
  before declaring equivalence.
- Server context (timezone, locale, encoding) shifts how SQL literals are
  interpreted. Treat literal text as never timezone-safe across hosts.

### 4. Race condition in silent refresh

Refactored the dashboard to do parallel Supabase + CRM fetches, then commit
Supabase first and overlay CRM second. On every 10s tick the headline number
briefly regressed from CRM (143) to Supabase (140) for the ~1s CRM fetch,
then back. If anyone screenshotted in that window they saw the wrong number.

**Lesson:** background refreshes commit *once*, after all data has resolved.
Intermediate state visible only on user-driven loads.

### 5. The "no footprint" backdoor request

A request came in for an "owner" tier above super_admin with no audit log.
Declined. Built the alternative: an owner tier that's invisible in the
user list UI but every action is logged to an `owner_audit_log` table
visible only to other owners + a `security_auditor` role.

**Lesson:** "no footprint" is the part that makes a privilege tier
unsafe. Hidden-from-UI is fine. Hidden-from-logs is not.

(This is in active design as of the time of writing; not yet built.)

---

## 10. Future roadmap

Things on the backlog as of mid-2026. Useful as a list of "what does an app
like this evolve into?"

### Near-term

- **Supabase Realtime for live updates.** Currently we poll every 10s; with
  Realtime, dashboards subscribe to specific row changes and update on push.
  Requires paid Supabase plan + some refactor on the read side. Will cut
  background poll volume by 90%.
- **Server-side aggregation cache** with a longer TTL (60s) for heavy
  reports. Currently each user re-runs the same RPC; a small in-memory cache
  on the Next.js side would coalesce.
- **Live gold rates surface** (built, waiting on the new-CRM team's feeder
  to actually run continuously — schema and UI are ready).
- **Owner role** with hidden-UI + dedicated audit log + security_auditor
  read role. Design above.

### Medium-term

- **Movement Analytics module** — inter-branch gold movement flows, ageing
  analysis, anomaly detection (e.g. "this branch's stock has been at_branch
  for 30+ days, something's wrong").
- **Inventory Audit module** — physical count reconciliation against book
  values; currently stubbed as "coming soon" on the dashboard.
- **Melting module** — track gold through the melting workflow at HQ with
  before/after weights, purity assays, loss percentages.
- **Telesales bot integration** — automated outbound calls for repeat
  customers (Inbound Bot Testing exists as a stub today).

### Long-term

- **Multi-tenant** — currently single-org. Future plan to spin this up for
  other jeweller chains; requires significant schema work (org_id on every
  table, RLS for cross-org isolation, billing infrastructure).
- **Mobile app (React Native or PWA)** for branch employees doing the
  walk-in entry directly into the new CRM via the app, retiring the old
  CRM entirely.
- **ML-driven gold rate prediction** — feed historical buying rates +
  market spot prices into a model that predicts where rates will be in
  N hours; ops teams can use this for better margin decisions.

### Infrastructure debt

- **Staging environment.** Right now main = production. Risky for big
  refactors.
- **End-to-end tests.** Manual QA only. Smoke tests against the deployed
  staging would catch race conditions like the one in §9.4.
- **Centralised log aggregation** beyond Railway's per-service logs. When
  there are 5+ services, jumping between log tabs gets painful.
- **Database backups + restore drills.** Supabase has automated backups; we
  haven't tested a restore.

---

## 11. Files you'll touch most often

Cheat sheet for orientation:

```
app/
├── api/                          # Server-side route handlers (Next.js)
│   ├── consignments/route.js     # Most ops workflow APIs (one mega-router)
│   ├── crm-purchases/route.js    # Reads from old + new CRM
│   ├── sync-purchases/route.js   # The mirror sync — heart of the app
│   ├── report-aggregates/route.js # Server-side aggregation RPC wrapper
│   ├── gold-rates/route.js       # Reads new CRM GoldRate table
│   └── ...                       # ~30 other endpoints
└── dashboard/page.js             # Top-level router for the app

components/
├── dashboard/                    # Top-level home (DashboardHome, LiveFeed-
│   │                             # Flashcards, etc.)
├── consignments/                 # Branch Stock Overview, Consignment Data,
│   │                             # Report, Bidding Volume
├── purchases/                    # Live Data (PurchaseData), Reports
├── sales/                        # Cal Table, Live Market Rates
├── admin/                        # User mgmt, Role mgmt, Branch mgmt,
│   │                             # Logistics, Gold Buying Rate, etc.
├── Sidebar.js                    # Left nav (desktop)
└── Topbar.js                     # Top chrome (search, theme toggle, profile)

lib/
├── context.js                    # AppProvider — global state, auth, theme,
│   │                             # permissions, navigation
├── apiAuth.js                    # Server-side auth helpers
├── modules.js                    # Single source of truth for nav modules
├── consignmentTheme.js           # Theme tokens for the gold/cream design
├── dateIst.js                    # IST helpers (istNow, istToday, istStr)
├── authedFetch.js                # Client fetch wrapper that adds Bearer token
└── triggerSync.js                # Shared sync trigger with cooldown + in-flight

sql/                              # Idempotent migrations (run manually)
└── *.sql

scripts/                          # Developer tools (gitignored credentials)
├── sync-new-crm.mjs              # Pulls new CRM data into Supabase (cron'd)
├── cron-sync.mjs                 # Background sync worker (Railway service)
├── explore-new-crm.mjs           # Schema inspection
└── ...
```

Read top-down on first visit: `lib/context.js` → `app/dashboard/page.js` →
`components/Sidebar.js`. That gives you the routing model in 15 minutes.

Then look at one feature end-to-end:
`components/dashboard/DashboardHome.js` (UI) →
`app/api/report-aggregates/route.js` (API) →
the Supabase RPC `get_purchase_aggregates` (DB).

---

## 12. Working with Claude on this codebase

If you're handing this project to another developer who'll use Claude Code
as their pair, here's what's worth saving as memory or context:

- **All architecture decisions in §3 are load-bearing.** Don't let an AI
  "simplify" the three-database design without proposing a real migration
  plan.
- **The dedup-never-drops rule (§5.1) is sacred.** Same for the upsert-key-
  uses-stable-identity rule (§5.2). Both came from production bugs that
  affected stakeholders.
- **Deploy-after-every-change** is the explicit convention. Don't batch
  commits "to test together later" — there's no staging to test on.
- **Stakeholder-visible correctness wins over speed.** Shimmer for one extra
  second is fine. A wrong number for one second is not.
- **Run SQL migrations before pushing code that uses the new schema.**
  Otherwise the deploy goes red until you remember.

The `~/.claude/projects/<this-repo>/memory/` folder contains saved memories
from prior sessions. Read them on day one — they capture the gotchas that
aren't otherwise obvious from the code.

---

*End of playbook. Update sections as the project evolves; the structure
should remain stable.*
