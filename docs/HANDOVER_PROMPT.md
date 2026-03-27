# GoldApp — Claude Code Handover Prompt
**Date:** 2026-03-28 | **Handover from:** Claude.ai | **Handover to:** Claude Code (VS Code)

---

## WHO YOU ARE WORKING WITH
- **User:** Chaitanya (chaitanya@whitegold.money) — super_admin
- **Company:** White Gold Bullion Pvt Ltd — gold trading company
- **App:** GoldApp — internal operations platform

---

## PROJECT STACK
- **Framework:** Next.js (App Router)
- **Database:** Supabase (Postgres) + MySQL (AWS RDS — CRM, read-only)
- **Deployment:** Vercel (Hobby)
- **Local path:** `C:\Users\chaithanya\goldapp`
- **Live URL:** https://goldapp-xi.vercel.app
- **GitHub:** https://github.com/chaitanya942/goldapp
- **Railway proxy:** https://github.com/chaitanya942/goldapp-rates-proxy

---

## MASTER REFERENCE DOCUMENT
The full architecture, schema, pending tasks, and gotchas are in:
`MASTER_REFERENCE_v16.md`

**Always read this first before making any changes.**
**Always update this document at the end of every session.**
The current version is v16. When updating, increment to v17, v18 etc.

---

## CURRENT STATE (as of 2026-03-28)

### What's working ✅
1. **Dashboard** — home page
2. **Purchase Data + Reports** — CRM sync working, dedup fixed
3. **Live Market Rates** — Kalinga Kawad ✅, Ambicaa Firebase ✅, Aamlin (browser-side only) ✅
4. **Inbound Bot Testing** — 61 calls synced, duration pending Gnani metadata
5. **Branch Management** — full CRUD
6. **Consignment Module** — partially built (see below)

### Consignment Module — current state
- **ConsignmentData.js** — Stock in Branch page ✅
  - Two tabs: At Branch | In Consignment
  - Drill-down: All Regions → Region → Branch → Bills
  - Back button + breadcrumb navigation
  - KPI cards, age badges, sort by net weight
  - Create Consignment flow with auto-generated TMP PRF + Challan No
  - Unknown branch warning banner

- **ConsignmentReport.js** — DEL-CHALLANS log (basic, needs full build)
- **ConsignmentSummary.js** — BR-CONSIGNY movement report (basic, needs full build)

### ⚠️ CRITICAL PENDING — Sunday 2026-03-29
Physical sticker rolls are used for TMP PRF numbers and external (challan) numbers.
The webapp must continue from where stickers left off.

**User will share on Sunday:**
```
TMP PRF last used: WG000XXX
Branch external numbers last used:
  TUMKUR: 001850
  MYSURU: 001XXX
  ... all active branches
```

**Action:** Run UPDATE on consignments table to seed starting numbers so next auto-generated number continues from there.

---

## SUPABASE TABLES (key ones)

### purchases
- `application_id` — UNIQUE constraint exists
- `stock_status` values: `at_branch` | `at_ho` | `in_consignment`
- New CRM syncs come in as `at_branch`

### branches
- `region` column — used to identify Bangalore vs outside Bangalore
- Outside Bangalore = `region != 'Bangalore'`
- Regions: Bangalore (32), Rest of Karnataka (16), Kerala (33), Andhra Pradesh (12), Telangana (8)

### consignments
- `tmp_prf_no` — WG000001 format, global sequential
- `external_no` — 6-digit, sequential per branch per month
- `challan_no` — `WGKA/KA-TUM/MAR/2026/001850` format
- `internal_no` — optional, only for hub branches

### consignment_items
- Links purchases to consignments

### gold_rates
- `kalinga_sell_rate`, `ambica_sell_rate`, `aamlin_sell_rate`
- RLS DISABLED

---

## KEY FILES TO KNOW
```
app/api/sync-crm/route.js                   — CRM sync (dedup fixed, upsert safe)
app/api/fetch-gold-rates/route.js           — Kalinga + Ambicaa → gold_rates
app/api/consignments/route.js               — Consignment CRUD + number generation
app/api/debug-rates/route.js                — DELETE THIS (leftover debug route)
components/consignments/ConsignmentData.js  — Main consignment UI
components/consignments/ConsignmentReport.js
components/consignments/ConsignmentSummary.js
components/sales/LiveMarketRates.js         — Live rates with Aamlin browser socket
lib/context.js                              — Role-based page access (ROLE_PAGES)
goldapp-rates-proxy/index.js                — Railway proxy (separate repo)
```

---

## NUMBER GENERATION LOGIC (consignment API)
```javascript
// TMP PRF: WG + 6 digits, global sequential
// e.g. WG000001, WG000002...

// External No: sequential per branch per month (6 digits)
// e.g. 001850, 001851...

// Challan No format: WG{STATE}/{STATE}-{BRANCH_CODE}/{MMM}/{YYYY}/{EXTNO}
// e.g. WGKA/KA-TUM/MAR/2026/001850

// Branch code: auto-derived from name
// KL-THRISSUR → THR, AP-GUNTUR → GNT, TUMKUR → TUM

// State code: derived from region
// Rest of Karnataka → KA, Andhra Pradesh → AP, Telangana → TS, Kerala → KL
```

---

## DEPLOYMENT COMMANDS
```bash
# Deploy to Vercel
git add .
git commit -m "your message"
git push
npx vercel --prod

# Railway proxy (separate repo)
cd C:\Users\chaithanya\goldapp-rates-proxy
git add .
git commit -m "your message"
git push
# Railway auto-redeploys on push
```

---

## IMMEDIATE NEXT TASKS (in priority order)

### 1. Sunday 2026-03-29 — Seed sticker numbers
Wait for user to share last TMP PRF + external numbers, then seed them.

### 2. Delete debug route
```
DELETE: app/api/debug-rates/route.js
```

### 3. Delivery Challan PDF generation
- Replicate Excel delivery challan format exactly
- Generate PDF when consignment is created
- Same layout as `DELIVERY CHALLAN` sheet in the Excel

### 4. Fix Live Rates double row insertion
- cron-job.org inserts one row (Kalinga + Ambicaa)
- Railway proxy inserts another row
- Fix: Either disable Railway proxy OR have it update existing row instead of insert

### 5. Consignment Report (DEL-CHALLANS) full build
### 6. Movement Report (BR-CONSIGNY) full build
### 7. Fix MoM column bug in purchase reports
### 8. Custom domain: goldapp.whitegold.money
### 9. Custom SMTP: noreply@whitegold.money

---

## CODING CONVENTIONS

### Theme system
```javascript
const THEMES = {
  dark:  { bg:'#0a0a0a', card:'#111111', card2:'#161616', text1:'#f0e6c8', text2:'#c8b89a', text3:'#9a8a6a', text4:'#6a5a3a', gold:'#c9a84c', border:'#1e1e1e', green:'#3aaa6a', red:'#e05555', blue:'#3a8fbf', orange:'#c9981f', purple:'#8c5ac8' },
  light: { bg:'#f0ebe0', card:'#e8e2d6', card2:'#e0d9cc', text1:'#1a1208', text2:'#5a4a2a', text3:'#7a6a4a', text4:'#9a8a6a', gold:'#a07830', border:'#d0c8b8', green:'#2a8a5a', red:'#c03030', blue:'#2a6a9a', orange:'#a07010', purple:'#6a3a9a' },
}
const { theme } = useApp()
const t = THEMES[theme]
```

### Supabase client in API routes
```javascript
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
```

### No market hours restriction on Live Rates
### No hardcoded branch lists — always use `branches` table
### stock_status values: `at_branch`, `at_ho`, `in_consignment` (never in_branch/in_transit)
### RLS must be DISABLED on consignment tables and gold_rates

---

## GOTCHAS
- Vercel Hobby = daily crons only → use cron-job.org for per-minute
- Aamlin Socket.IO blocked on server → browser-side only
- `normalizeAppId()` in sync route handles double WGKA prefix
- Bangalore branches excluded via `region = 'Bangalore'` — NOT a hardcoded list
- UNIQUE constraint on `purchases.application_id` — never insert duplicates
- Railway proxy auto-redeploys on every git push to main
- `consignment_branches` table exists but is unused — using `branches` table instead
- `augmont_buy_rate` column in gold_rates — purpose unclear, don't delete yet

---

## END OF HANDOVER
Read MASTER_REFERENCE_v16.md for full details.
Always update it at session end.