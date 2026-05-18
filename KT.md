# Building Production Operations Software — A Field Manual

> An A-to-Z engineering manual for building, shipping, and running serious
> production apps — the kind that mirror a legacy system you don't own,
> carry real money/inventory state, enforce role-based access, and must
> stay fresh while a small team ships to prod with no staging.
>
> It is written as **transferable principles first**, with a real system
> ("GoldApp" — gold-buying operations for a jeweller chain) as the running
> case study. Every principle has the same rhythm:
>
> **Principle → Why it's true → How it bit a real system → How to apply it.**
>
> You can lift any section into a completely different app. Part XI is a
> project-specific appendix so the concrete GoldApp reference isn't lost.
>
> Audience: a competent full-stack developer. Assumes JS/React. Assumes
> nothing about your stack, your domain, or this one.

---

## Table of contents

- **I. When this manual applies**
- **II. The phased build**
- **III. Choosing stack & infrastructure**
- **IV. Source-of-truth discipline**
- **V. The sync engine** ← the crown jewel; read twice
- **VI. Identity, keys & time** (the silent-data-loss trio)
- **VII. Access control (RBAC) that survives delegation**
- **VIII. UI & UX discipline for operational software**
- **IX. Operational discipline (deploy, migrate, run, triage)**
- **X. War stories → universal lessons**
- **XI. Working with an AI pair**
- **XII. GoldApp appendix** (the concrete reference)

---

## I. When this manual applies

Use this if your app has **most** of these properties. The more it has, the
more of this manual is load-bearing for you.

1. **You don't own the upstream source of truth.** Data is born in some
   other system (a legacy CRM, an ERP, a partner API, a POS) that you
   cannot change. You mirror it.
2. **You add workflow + state on top.** Your app advances things through
   stages the upstream system knows nothing about (fulfilment status,
   approval state, movement tracking).
3. **It carries consequential state.** Money, inventory, compliance — a
   wrong number isn't a cosmetic bug, it's a trust and operations problem.
4. **It needs to feel fresh.** Stakeholders watch dashboards; ops act on
   what they see. Stale or contradictory numbers cause real mistakes.
5. **Multiple roles, selectively delegated.** Admins, operators, viewers,
   accounts — and someone wants to grant a non-standard person access to
   one screen.
6. **Small team, fast cadence, thin (or no) safety net.** Push-to-deploy,
   maybe no staging, manual QA.

If you have 4+ of these, the failure modes in Part X **will** happen to
you. This manual is mostly about not learning them the expensive way.

---

## II. The phased build

Build order matters. Get the data flowing and correct before you make it
pretty or fast. Each phase is shippable.

**Phase 1 — Read-only mirror.**
Pick the upstream source of truth. Get read credentials. Identify the
minimal tables/columns. Build *one* idempotent sync endpoint: pull →
upsert. Build the dumbest possible view ("today's records"). **Stop and
verify the count matches the upstream system exactly.** If it doesn't, the
sync is wrong — fix it before anything else. Counts diverging is the single
earliest warning you'll get and the cheapest to act on.

**Phase 2 — Workflow on top.**
Add your own columns to the mirror (status, workflow timestamps, links).
Set sane defaults on insert; existing rows keep their value on re-sync.
Build the UI that mutates *your* columns. Do **not** write back to the
upstream system unless you fully own that write path.

**Phase 3 — Auth & permissions.**
Use managed auth from day one (don't roll your own — you'll get it subtly
wrong and lose months). Start with hard-coded role→pages in source. Move to
DB-driven permissions only when you have 3+ roles and people want to tweak
without a deploy. Keep the hard-coded map as the fallback.

**Phase 4 — Aggregation & insight.**
Push aggregation into the database (server-side functions/RPCs). One
aggregation function feeding *every* surface (dashboard, reports, widgets)
so numbers cannot disagree by construction.

**Phase 5 — Freshness.**
Start with client polling (30–60 s). Add a sync trigger when users open
key pages. When freshness must survive "nobody has the app open", add a
server-side worker that does not depend on a browser session.

**Phase 6 — Real-time-direct surfaces (only if needed).**
A few surfaces may need to read the upstream system directly, bypassing
the mirror, to feel live. Accept the cost: you can't join with app-owned
data and you pay upstream latency. Keep this the exception.

**Phase 7 — Operational tooling.**
Health signals, audit logs, background-job status, freshness badges. These
exist to answer "is everything still working?" without reading raw logs.
Build them before you think you need them; you already do.

---

## III. Choosing stack & infrastructure

The specific products matter less than the properties. Choose for:

- **Managed everything.** A two-person team cannot run its own Postgres,
  auth, and object storage. Pick a platform that bundles them. Every hour
  not spent on infra is an hour on the product.
- **Push-to-deploy from main.** Friction kills cadence on a small team.
  Accept that this means main == production and design *around* it
  (idempotent migrations, backwards-compatible schema, small commits) —
  see Part IX.
- **One repo, multiple runtime services.** Your web app and your
  background workers can be separate deployables from the same repository.
  Don't cram a 60-second loop into a request handler.
- **Stateless app servers.** Anything you cache in app memory is
  per-instance; it will diverge across instances under scale. Fine for
  short TTLs, never for correctness.

**The tradeoff you're explicitly accepting with no staging:** you trade a
safety net for speed. Pay it back with discipline (Part IX), not with
hope. The bugs in Part X that reached stakeholders are largely the
unpaid interest on this loan.

---

## IV. Source-of-truth discipline

**Principle.** For every fact in your system, exactly one place is
authoritative. Write it down. Never let a number have two independent
production paths.

**Why.** Two paths producing one value is two paths that can disagree.
Every divergence becomes an unanswerable "is the number wrong, or is one
path buggy?" You will spend more time adjudicating the blend than the lag
you were trying to eliminate ever cost you.

**How it bit GoldApp.** The dashboard's "purchased today" came from the
mirror (Supabase). Someone overlaid a *second*, real-time read from the
upstream CRM "to make the dashboard match the live widget instantly." The
overlay computed weight slightly differently and showed **35% less than
the official report — twice, in front of the PM.** The fix was deletion:
remove the overlay, accept that the mirror lags by one sync interval,
let every surface read the one aggregate.

**How to apply.**
- Maintain an explicit "who owns what" table (Appendix XII has GoldApp's).
- Pick one source per number. Document the lag. State the lag to
  stakeholders out loud — their real tolerance is almost always looser
  than you assume, which lets you simplify.
- The only legitimate second source is data that genuinely does not exist
  in the first (GoldApp's walk-in counts only exist in the CRM, so those —
  and only those — are read CRM-direct).
- Mirror upstream data **read-only** and **extend** it with your own
  columns. Never treat your app as authoritative for transactional data
  you didn't originate.

---

## V. The sync engine

If you mirror an upstream system, this is the most important code you will
write and where ~80% of your serious bugs will live. The canonical flow:

```
1. PULL    upstream rows in a bounded window (e.g. last 2 days).
2. MAP     upstream fields → your schema (incl. the immutable upstream id).
3. DEDUPE  make your unique key unique WITHOUT dropping any source row.
4. RECONCILE IDENTITY  detect upstream key edits; rename in place.
5. UPSERT  on your conflict key. NEVER put workflow state in the payload.
6. RECONCILE DELETES  rows in your window absent from this pull → mark deleted.
```

Five hard-won laws follow. Each is a section of Part VI or below.

### V.1 Law: dedupe by disambiguation, never by deletion

**Principle.** When two source rows would collide on your unique key,
**keep both** and make one unique (suffix it). Never silently drop one.

**Why.** "These two look like duplicates" is a heuristic, and real-world
operational data violates every heuristic: missing phone numbers, default
names, the same customer transacting twice, legitimate re-entries the
upstream system will later void (and you must mirror the void). A dropped
row is invisible data loss — the worst kind, because nothing errors.

**Bit GoldApp:** dedup matched on name+date+weight+amount+phone and
dropped "duplicates." Walk-ins with NULL phone matched each other.
**~25 bills vanished per day.** Downstream workflow couldn't be created
for gold that physically existed.

**Apply:** group by your conflict key; within a group, the smallest
immutable upstream id keeps the bare key, the rest get a deterministic
suffix (`KEY-<sourceId>`). Output count must equal input count, always.

### V.2 Law: the sync loop must not depend on a human

**Principle.** Freshness that only happens when someone has the app open
is not freshness.

**Why.** Lunch, nights, weekends, everyone in a meeting — the data goes
stale exactly when no one is watching, which is when drift compounds
unnoticed.

**Bit GoldApp:** sync was browser-triggered. Off-hours the mirror fell
arbitrarily behind. Fix: a separate long-lived worker service (same repo,
different start command) hitting the sync endpoint on a fixed interval,
authenticated by a shared secret, with an in-flight guard so a slow run
doesn't stack. The browser still boosts it when open; the worker is the
floor.

**Apply:** background worker for the floor; opportunistic client triggers
for the boost; coalesce them (shared trigger with a short cooldown +
in-flight guard) so N surfaces don't stampede the upstream system.

### V.3 Law: define an explicit freshness contract

**Principle.** For every surface, state the maximum acceptable lag —
aloud, to stakeholders — and design to it. Surface the actual freshness
in the UI.

**Why.** "Live" is not a spec. Different surfaces have wildly different
real tolerances. Unspecified, you'll either over-engineer everything to
real-time or ship contradictions.

**Apply:** a per-surface table (Appendix XII §5 has GoldApp's). A visible
"synced N ago" health badge with green/amber/red thresholds tuned to the
worker interval — so a stalled worker is *seen*, not silently absorbed.

### V.4 Law: never put workflow state in the upsert payload

**Principle.** The fields your app owns (status, workflow timestamps) must
be excluded from the columns the sync writes. The sync updates
upstream-derived facts only.

**Why.** A re-sync of an existing row must not stomp the state your
operators advanced. If `status` is in the payload, every sync silently
resets it to the default.

**Apply:** the upsert writes weights/amounts/names; it never writes
`status`/`*_at` workflow columns. Defaults apply on INSERT only; existing
rows keep their app-owned state across updates. (This is the other half of
why VI.1's identity fix works.)

---

## VI. Identity, keys & time — the silent-data-loss trio

These three cause *silent* corruption — no error, wrong data. They deserve
their own part.

### VI.1 Never key identity off a mutable upstream field

**Principle.** Your conflict/identity key must be the upstream system's
**immutable** primary key, not any human-editable field (bill number,
order code, anything typed).

**Why.** If you key off the editable field and a user edits it upstream
(same underlying record, new label), your sync sees a "new" record:
fresh row at default state, original orphaned, **all app-owned workflow on
it lost.** Silent.

**Bit GoldApp (twice, two distinct shapes):**
- *Edit-in-place:* staff renamed a bill_no on the same transaction. Fixed
  by storing the immutable `txn_id` as a hidden anchor column and, before
  upsert, detecting "same anchor, different label" and **renaming the row
  in place** so its status survives.
- *Delete-and-recreate:* staff deleted the transaction and made a new one
  (new immutable id) for the same physical thing. The anchor can't help —
  there is no shared id. **Fixed in GoldApp** (sync route, post-reconcile
  "Carry-forward" block + `sql/backfill_carryforward_stock_status.sql` for
  already-orphaned rows): when a row is marked deleted *and* it had been
  moved past default state, find exactly one fresh default-state row with
  matching business attributes (customer+location+date+quantity within
  tolerance) and a different label; carry state (and booking link)
  forward; log it; skip ambiguous (0 or >1) and NULL-keyed rows.

**Apply:** add the immutable upstream id as a column from day one even if
you key on the friendly id (you can migrate the key later; you cannot
recover the lost state). Build rename-detection. For delete-recreate,
accept you need a *constrained* fuzzy match — and constrain it hard (only
when state would be lost, only on an unambiguous single match) so you
don't reintroduce V.1's over-merge.

### VI.2 Never trust how another system interprets your literals

**Principle.** A datetime/number literal you send to another system means
whatever *that system's* session/locale says it means — not what you
intended.

**Why.** Database session timezones, locale decimal separators, implicit
casts — all silently shift the meaning of boundary values. A filter that
"looks equivalent" can include/exclude a slice of rows.

**Bit GoldApp:** a slow `WHERE DATE(col + INTERVAL …) = ?` (timezone-
independent by construction, because it does explicit arithmetic) was
"optimised" to an index-friendly `col >= '<utc>' AND col < '<utc>'`. The
upstream MySQL session was IST, not UTC, so the bounds meant a different
window. **~35% of weight silently dropped, shipped to stakeholders.**

**Apply:** express cross-system boundaries in a form whose meaning is
context-independent (explicit arithmetic, ISO-8601 with offset, integer
epochs). Treat literal text as never safe across a system boundary.
**Before declaring any query rewrite equivalent, diff the actual result
rows old-vs-new** — not the plan, not the count, the rows.

### VI.3 Date-bucketing happens in *some* timezone — know which

**Principle.** "Which day does this record belong to" is a timezone
decision. Decide it explicitly and apply it consistently on read and
write.

**Bit GoldApp (open, minor):** a Date object formatted with server-local
(UTC) components buckets early-morning-local records onto the previous
day. Rare enough to defer, but it's a real edge and it's documented so it
isn't rediscovered as a "mystery."

**Apply:** pick the business timezone, centralise the helpers, never
format dates with ambient server-local methods for business bucketing.

---

## VII. Access control that survives delegation

**The three-layer model that works for small teams:**

1. **Static fallback** in source: role → allowed pages. Ships working
   defaults with zero config.
2. **DB-driven overrides**: a `(role, permission_key, enabled)` table.
   When a role has rows here, they win; when it has none, fall back to (1).
3. **Server enforcement**: every endpoint declares what it needs.

**Namespace your permission keys** so you can be granular later without a
rewrite: `page.*`, `tab.<page>.<tab>`, `element.<page>.<feature>`,
`action.<verb>`.

**Trap 1 — the super-admin allowlist.** Once a role has DB-driven
permissions, the static fallback never runs for it. A *new* page you add
in code is invisible to that role until explicitly granted — including
your own super-admin, mid-incident. Keep a small "always visible to the
owner role" allowlist and **add every new privileged page to it.** (Bit
GoldApp: super_admin couldn't see a freshly-shipped admin page.)

**Trap 2 — role-group vs delegated-permission.** An endpoint gated by "is
the caller in role-group ADMIN" will reject a non-admin you *granted* the
page to via the permission UI. The sidebar shows them the page (permission
check passes client-side); the API 403s them. Provide a server helper that
authorises by the **granted permission**, not the role name, and use it
for any endpoint behind a delegable page. (Bit GoldApp: consignment-seeds
delegation looked granted but every API call 403'd.)

**Scoping (region/tenant):** store the scope on the user, resolve it to a
concrete filter server-side, and apply it inside every aggregate — not as
an afterthought in the UI. Bypass roles (org-wide visibility for incident
response) are explicit.

---

## VIII. UI & UX discipline for operational software

**Stakeholder-visible correctness beats speed. Always.** This is the
single most important UX principle in this manual. A skeleton shimmer for
one more second is forgivable. A *wrong number* for one second is not —
trust erodes far faster than it rebuilds, and operations act on what they
see. Optimise perceived latency only after correctness is unconditionally
guaranteed.

**Stale-while-revalidate, with intent-awareness.**
- *User-driven* changes (filter, period, explicit refresh) → may show a
  loading state; the placeholder correctly signals "different data
  coming."
- *Background* refreshes (interval, tab-focus, post-sync) → must be
  **silent**: keep the current numbers on screen, swap atomically when the
  new data resolves. Never blank to a skeleton on a background tick.
- *Critical corollary:* a background refresh commits its result **once,
  after everything resolves.** If you write an intermediate value and
  patch it a beat later, there's a window where the screen is wrong — and
  someone will screenshot exactly that window. (Bit GoldApp: a headline
  flickered to the stale value every interval tick.)

**One navigation source of truth.** Sidebar, mobile menu, dashboard tiles
all read one structure. Add a destination once.

**Theme by tokens, not hardcoded colour.** A small token object per theme;
pass it down. The whole app re-skins from a few dozen values.

**Animation is for legibility, not decoration.** Use it to make state
*tangible* (a gauge that fills as you type a quantity against a ceiling is
worth more than the raw numbers). Stagger reveals so the eye lands in
order. Always gate behind `prefers-reduced-motion`.

**Make the abstract physical.** When an operator commits a quantity
against a pool, show the pool, show the commitment eating into it, turn it
red when it overflows. The best operational UI turns arithmetic into
something you can *see* being right or wrong.

---

## IX. Operational discipline (the no-staging tax, paid in process)

**Deploy.** Small commits, each independently shippable. Watch the deploy.
Separate worker services only redeploy on their own watched paths.

**Migrations — ordering is not optional.**
1. Idempotent (`IF NOT EXISTS`, no destructive drops, two-deploy renames:
   add nullable → migrate code → drop later).
2. **Run the migration on the database first.**
3. **Then** deploy the code that depends on it.
Reverse that and prod 500s for the gap. (You can additionally write reads
to degrade gracefully pre-migration — a "missing → 0" path — but never
rely on it as the plan.)

**Recurring operator tasks → a safe, fixed SQL ritual.** Operations will
hand you bulk mutations (mark these N ids done) constantly. Never freehand
it. Always three statements: **PREVIEW** (count what you'll touch, assert
it equals the expected list size) → **UPDATE** → **VERIFY** (read it
back). Touch only the column you mean to; extra columns that don't exist
will error and abort. If PREVIEW < expected, something upstream is off —
flag it, don't force.

**Health signals over log-diving.** A visible freshness badge; worker
logs that print status+timing each tick; an in-flight guard whose
"skipping" line is *information*, not an error. Triage order when "data
looks stale": badge → worker logs → auth mismatch → worker down → if
worker healthy but one record wrong, it's the identity/delete-recreate
class (Part VI).

**Secrets hygiene.** Never in chat, never in commits, never echoed back.
Local `.env` (gitignored) for scripts; platform vars for prod. A
guessable secret is no secret — rotate weak ones immediately. Treat any
secret that ever appeared in a conversation log as compromised.

**No backdoors — and what to build instead.** You will, eventually, be
asked for "master access above admin, no footprint." Decline the
*unlogged* part, on principle and on self-interest: an undetectable access
path is the one with your name on it when something goes wrong, and a
security team cannot do its job around it. The legitimate version of the
real need is a higher privilege tier that is *hidden from the user-list
UI* but *fully audited* to a log only that tier + a security-auditor role
can read. Hidden-from-UI is fine. Hidden-from-logs is the part that makes
it a weapon against you. (This exact request came up in GoldApp; the
audited design was specified, the unlogged one refused.)

---

## X. War stories → universal lessons

Every serious production bug, abstracted to the lesson that transfers.

| Lesson (universal) | How it manifested |
|---|---|
| Dedupe by disambiguation, never deletion | Heuristic dedup silently dropped ~25 records/day |
| One number, one source — never blend | A second real-time overlay showed 35% wrong, twice, to the PM |
| Cross-system literals aren't context-free; diff rows before claiming equivalence | A "harmless" index-friendly WHERE rewrite dropped 35% of data |
| Background refresh commits once, after all data resolves | Headline flickered to the stale value every refresh tick |
| Anchor identity on the immutable upstream key | Editing a friendly id reverted workflow state to default |
| Constrained fuzzy match for delete-recreate | Same but with a *new* upstream id — no shared anchor; rescued by a single-match-only carry-forward + one-time backfill |
| Validate at the boundary; defend downstream too | Upstream form copied a phone number into a weight field; one row poisoned a total by ~9 billion |
| Authorise by granted permission, not role name | Delegated page visible in UI, every API call 403'd |
| New privileged pages must be added to the owner allowlist | Super-admin couldn't see a freshly-shipped admin page |
| Distinguish *kinds* of "bad", don't collapse them | "Overbooked: bookings exceed pool" shown with zero bookings |

**The meta-lessons, in priority order:**
1. Stakeholder-visible correctness > speed.
2. One number, one source.
3. Silent data loss is the worst failure class — design dedupe, identity,
   and boundary queries so loss is impossible, not unlikely.
4. Diff result sets before trusting a "refactor that can't change
   behaviour."
5. Migrate the DB before deploying the code that needs it.
6. Process is how you pay back the no-staging loan. Skip it and the
   interest is charged in front of stakeholders.

---

## XI. Working with an AI pair

This system was largely built with an AI coding agent. What transfers to
any AI-paired project:

- **Mark the load-bearing invariants explicitly** (in a doc like this and
  in a persistent memory the agent reads). Otherwise a future session will
  helpfully "simplify" the very code that prevents silent corruption.
- **Memory is point-in-time, not live truth.** A note that says "X is
  unaddressed" can outlive the fix. Always re-verify a remembered claim
  against current code before acting on it.
- **The agent will be confidently wrong sometimes** (a query rewrite that
  "must be equivalent"). The defence is the same as for a human:
  diff-before-trust, preview-before-mutate, correctness-before-speed. Hold
  the AI to the process in this manual exactly as you would a person.
- **Delegate execution, never understanding.** Have it do the search, the
  scaffolding, the mechanical edit. Keep the "is this actually correct for
  the domain" judgement yours.
- **Refuse to help build the thing that hurts the owner** (the backdoor).
  A good pair — human or AI — pushes back and offers the legitimate
  version.

---

## XII. GoldApp appendix — the concrete reference

Everything project-specific, so the manual stays general but nothing real
is lost. Cross-references point back to the principle.

### XII.1 Domain
Jeweller chain buys gold from walk-ins across ~110 branches (Bangalore,
Rest of Karnataka, Kerala, Andhra Pradesh, Telangana, Tamil Nadu). Bills
born in **old CRM (MySQL)**; gold ships branch → HQ → melt. App = the
management/workflow/analytics layer (Part I).

### XII.2 Stack
Next.js 16 (App Router) + React on Railway (`goldapp` web service);
`goldapp-cron` worker service (`scripts/cron-sync.mjs`); Supabase
(Postgres+Auth+Storage); old CRM MySQL + new CRM Postgres (both Lightsail
ap-south-1); ClearTax/NIC for tax docs. Push-to-deploy, no staging
(Part III).

### XII.3 Who owns what (Part IV table)
| Data | Source of truth | Mirrored? |
|---|---|---|
| Bills (`purchases`) | old CRM `transac_tbl`+`ornments_tbl` | yes (sync) |
| Walk-ins | old CRM `customer_walkin` | no — CRM-direct |
| Gold rates | new CRM `GoldRate` | no — CRM-direct |
| Consignment workflow, `stock_status`, bookings (`cal_quotas`), `bidding_pending_delivery`, users/roles, branch master | Supabase | n/a (app-owned) |

### XII.4 Sync specifics (Part V/VI)
`app/api/sync-purchases/route.js`. `smartDedup` keeps every txn (suffix on
bill_no collision). `crm_txn_id` = immutable `t.id`; rename-detection
updates `application_id` in place; `stock_status` never in the upsert
payload. Window = `days=2`, filtered by the timezone-independent
`DATE(t.date + INTERVAL 330 MINUTE) = ?` — **do not rewrite this**.
`scripts/cron-sync.mjs` on `goldapp-cron` hits it every 60 s with
`Bearer ${CRON_SECRET}`; `lib/triggerSync.js` coalesces browser triggers
(8 s cooldown). Single source for "purchased": Supabase
`get_purchase_aggregates` RPC, everywhere.

### XII.5 Freshness contract
Flashcards Purchased ≤10 s (Supabase RPC); walk-ins real-time (CRM-direct);
dashboard/reports ≤10 s active / ≤60 s idle (cron); Branch Stock /
Consignment Data force-sync on mount + 15 s poll. Badge under the
greeting: green <30 s / amber 30–60 s / red ≥60 s (= cron down → check
`goldapp-cron` logs).

### XII.6 RBAC specifics
`lib/context.js` `ROLE_PAGES` (static fallback) + `role_permissions`
table + `lib/apiAuth.js`. `ALWAYS_ON_FOR_SUPER_ADMIN` — add new admin
page ids here. `requireAuthForPage()` for delegated admin endpoints
(consignment-seed migrated; migrate others as needed). Region scope via
`user_profiles.allowed_regions`; bypass = super_admin/founders_office/
admin. Adding an admin page = 5 touch points (context ROLE_PAGES +
allowlist, `lib/modules.js`, `Sidebar.js`, `app/dashboard/page.js` switch,
`RoleManagement.js` perm tree).

### XII.7 Bidding Volume
`Available = Incoming + Gain ± Pending`, `Remaining = Available − Booked`.
Pending = shared server-side signed carry-over (`bidding_pending_delivery`,
one row/arrival_date, no sign constraint) — **not** localStorage (whole
team books against one number). Two deficit states: `poolNegative`
(Available<0) vs `overbooked` (pool≥0 but commitments exceed; only with
bookings). Booking modal: committed weight is a *negotiated* figure vs the
pool, animated gauge; selected branches saved as a note, not a block.
Bookings in `cal_quotas` (Sales→Cal Table Quotas tab is read-only mirror).

### XII.8 Open items (Part VI/X)
1. ~~Delete-recreate carry-forward~~ **DONE** — sync route post-reconcile
   "Carry-forward" block (single-match only, NULL-keyed skipped, bounded
   to this run, idempotent) + `sql/backfill_carryforward_stock_status.sql`
   (PREVIEW/PREVIEW-ambiguous/UPDATE/VERIFY) for already-orphaned rows.
   Run the backfill once in Supabase. Response now reports
   `carriedForward` / `carryAmbiguous`.
2. Gold-rate feeder not running on new-CRM side (app correct, degrades to
   0).
3. `purchase_date` UTC-vs-IST edge (VI.3) — deferred.
4. No staging / no E2E — biggest infra debt.

### XII.9 Runbook quick-ref
- Bulk `at_ho`: PREVIEW/UPDATE/VERIFY on `application_id IN (…)`, only
  touch `stock_status` (Part IX).
- Stale data triage: badge → `goldapp-cron` logs → `FAIL 401`=secret
  mismatch → worker down → else identity class.
- One-off CRM probes: copy `scripts/find-walkin-bad-weight.mjs` /
  `explore-new-crm.mjs` pattern (`.env.local`-loaded).

### XII.10 File map
```
app/api/sync-purchases/route.js   ★ the mirror sync (Part V/VI)
app/api/consignments/route.js     mega-router (bidding_*, create_*, …)
app/api/crm-purchases/route.js    CRM reads (?action=live|flashcards)
app/api/report-aggregates/route.js  the single aggregate (Part IV)
app/api/gold-rates/route.js       new CRM GoldRate
app/dashboard/page.js             top-level router
components/dashboard|consignments|purchases|sales|admin
lib/context.js  apiAuth.js  modules.js  triggerSync.js  dateIst.js
scripts/cron-sync.mjs  ★  + CRM probe scripts
sql/  idempotent migrations (run first, Part IX)
```
First-day reading order: `lib/context.js` → `app/dashboard/page.js` →
`components/Sidebar.js`, then one feature end-to-end:
`DashboardHome.js` → `/api/report-aggregates` → the Supabase RPC.

---

*This is a manual, not scripture. The code and `git log` are
authoritative; this is the map. Keep the principles (Parts I–XI) stable;
grow the appendix (XII) as the system evolves. If you only remember three
things: **one number one source · never silently drop data · stakeholder-
visible correctness over speed.***
