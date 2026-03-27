# GoldApp Master Reference Document v17
**Last Updated:** 2026-03-28

---

## PROJECT OVERVIEW
- **App:** GoldApp — White Gold operations platform
- **Stack:** Next.js + Supabase + Vercel + MySQL (AWS RDS CRM)
- **Live URL:** https://goldapp-xi.vercel.app
- **Local:** C:\Users\chaithanya\goldapp
- **Supabase:** https://snrsusghktrapplbtthh.supabase.co
- **GitHub (main):** https://github.com/chaitanya942/goldapp
- **GitHub (proxy):** https://github.com/chaitanya942/goldapp-rates-proxy
- **Login:** chaitanya@whitegold.money (super_admin)

---

## SERVICES & COSTS
| Service | Plan | Cost | Where to check |
|---------|------|------|----------------|
| Vercel | Hobby (free) | $0 | vercel.com/account/billing |
| Supabase | Free tier | $0 | supabase.com/dashboard |
| Railway | Hobby ($5 credit) | ~$0.50/month | railway.app/account/billing |
| AWS RDS | Existing | Existing | billing.aws.amazon.com |
| AWS S3 | Existing | Existing | billing.aws.amazon.com |
| cron-job.org | Free | $0 | No billing |
| Groq | Free tier | $0 | console.groq.com |
| Anthropic API | Pay per use | ~negligible | console.anthropic.com |
| GitHub | Free | $0 | — |

---

## ENVIRONMENT VARIABLES

### GoldApp (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
CRM_DB_HOST / CRM_DB_PORT / CRM_DB_NAME / CRM_DB_USER / CRM_DB_PASSWORD
ANTHROPIC_API_KEY
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
GROQ_API_KEY
CRON_SECRET=whitegold123
```

### Railway Proxy
```
SUPABASE_URL = https://snrsusghktrapplbtthh.supabase.co
SUPABASE_SERVICE_ROLE_KEY = (same as GoldApp)
PORT = auto-set by Railway
```

---

## SUPABASE TABLES

### purchases
Key columns: `id`, `application_id` (UNIQUE), `purchase_date`, `branch_name`, `customer_name`, `phone_number`, `gross_weight`, `stone_weight`, `wastage`, `net_weight`, `purity`, `total_amount`, `final_amount_crm`, `service_charge_pct`, `transaction_type`, `bank_name`, `payment_ref`, `stock_status`, `is_deleted`, `dispatched_at`

**stock_status values:**
- `at_branch` — gold sitting at outside-Bangalore branch
- `at_ho` — gold at head office / Bangalore
- `in_consignment` — gold in transit (branch → HO)

**UNIQUE constraint:** `purchases_application_id_unique` on `application_id`

### branches
Columns: `id`, `name`, `city`, `state`, `model_type`, `is_active`, `region`, `cluster`, `opening_date`

**Regions:**
- `Bangalore` — 32 branches (excluded from consignment module)
- `Rest of Karnataka` — 16 branches
- `Kerala` — 33 branches
- `Andhra Pradesh` — 12 branches
- `Telangana` — 8 branches

**Source of truth for branch management.** Consignment module uses `region != 'Bangalore'` to filter outside-Bangalore branches.

### consignments
Columns: `id`, `tmp_prf_no` (WG000001 format), `external_no` (6-digit), `internal_no` (6-digit, optional), `challan_no` (WGKA/KA-TUM/MAR/2026/001850 format), `branch_name`, `branch_code`, `state_code`, `movement_type` (EXTERNAL/INTERNAL), `status` (draft/dispatched/received), `total_bills`, `total_net_wt`, `total_amount`, `total_gst`, `dispatched_at`, `created_at`

### consignment_items
Columns: `id`, `consignment_id` (FK → consignments), `purchase_id` (FK → purchases), `added_at`

### gold_rates
Columns: `id`, `fetched_at`, `kalinga_sell_rate`, `ambica_sell_rate`, `aamlin_sell_rate`, `augmont_buy_rate`
RLS: DISABLED

### telesales_calls
Key columns: `gnani_call_id`, `customer_number`, `call_date`, `language`, `duration_seconds`, `s3_key`, `summary`, `transcript` (jsonb)

---

## LIVE MARKET RATES MODULE

### Architecture
```
cron-job.org (every minute)
  → /api/fetch-gold-rates
    → Kalinga Kawad (plain text) ✅
    → Ambicaa Firebase REST ✅
    → INSERT one row into gold_rates

Railway proxy (always-on)
  → Ambicaa Firebase REST (backup) ✅
  → Aamlin Socket.IO (blocked) ❌
  → INSERT separate row

Browser (page open)
  → Aamlin Socket.IO direct ✅
  → Updates latest gold_rates row
```

### Data Sources
- **Kalinga Kawad:** `https://bcast.kalingakawad.com:7768/...` → plain text → `GOLD 999 IMP WITH GST FOR REF` → numbers[2]
- **Ambicaa:** Firebase REST `https://rsbl-spot-gold-silver-prices.firebaseio.com/liverates/GOLDBLR999IND.json` → `Sell` field
- **Aamlin:** `http://starlinebulltech.in:10001` Socket.IO → browser-side only (blocked on server)

### PENDING FIXES
- [ ] Double row insertion (cron + Railway both insert) — consolidate
- [ ] Delete `app/api/debug-rates/route.js`
- [ ] Verify `augmont_buy_rate` column purpose

---

## CRM SYNC MODULE

### File: `app/api/sync-crm/route.js`

### Key fixes applied
- `normalizeAppId()` — strips double `WGKA` prefix if already present
- Dedup check uses `.in()` against normalized IDs in chunks of 500
- `upsert` with `ignoreDuplicates: true` — concurrent sync safe
- UNIQUE constraint on `application_id` — DB-level guarantee
- CRM query pulls from `2026-03-15` onwards

### Stock status on sync
New records come in as `at_branch`. Need to manually update to `at_ho` or `in_consignment` for historical records.

---

## CONSIGNMENT MODULE

### Pages
1. **Consignment Data** (`components/consignments/ConsignmentData.js`) — Stock in Branch
2. **Consignment Report** (`components/consignments/ConsignmentReport.js`) — DEL-CHALLANS log
3. **Movement Report** (`components/consignments/ConsignmentSummary.js`) — BR-CONSIGNY (today's movements)

### API: `app/api/consignments/route.js`

### Business Flow
```
CRM sync → purchases (at_branch)
  → Consignment Data page
    → Select bills from ONE outside-Bangalore branch
    → Create Consignment → auto-generates TMP PRF No + Challan No
    → Bills move to in_consignment (disappear from At Branch view)
    → Movement Report shows today's movements
```

### Number Generation
- **TMP PRF No:** `WG000001` — global sequential, 6 digits, auto-increments from last used
- **External No:** `001850` — sequential per branch per month
- **Challan No:** `WG{STATE}/{STATE}-{BRANCH_CODE}/{MMM}/{YYYY}/{EXTNO}` e.g. `WGKA/KA-TUM/MAR/2026/001850`
- **Internal No:** optional, sequential per branch per month, only for selective branches (branch → hub movement)
- **Branch code:** auto-derived from branch name (KL-THRISSUR → THR, AP-GUNTUR → GNT, TUMKUR → TUM)
- **State code:** derived from region (Rest of Karnataka/Bangalore → KA, Andhra Pradesh → AP, Telangana → TS, Kerala → KL)

### ⚠️ CRITICAL: Number Seeding (TODO Sunday 2026-03-29)
Physical sticker rolls are used for TMP PRF and external numbers. The webapp must start from where the stickers left off.

**Action required Sunday:**
1. Share last TMP PRF number used physically (e.g. WG000289)
2. Share last external number per branch (e.g. TUMKUR: 001850, MYSURU: 001234)
3. Run UPDATE on consignments table to seed starting points
4. From Monday user can generate from webapp

Format to share:
```
TMP PRF last used: WG000XXX
Branch external numbers last used:
  TUMKUR: 001850
  MYSURU: 001XXX
  ... (all active branches)
```

### UI Features (ConsignmentData.js)
- Two tabs: **At Branch** | **In Consignment**
- Drill-down: All Regions → Region → Branch → Bills
- Back button + breadcrumb navigation
- Click anywhere on card to drill down
- KPI cards: Bills count, Active branches, Oldest bill age, Heaviest branch
- Age badges: 🟢 <7d, 🟠 7-14d, 🔴 >14d
- Branches sorted by highest net weight
- Unknown branch warning banner (branches in purchases not in Branch Management)
- Confirmation modal shows TMP PRF + Challan No preview before creating

### Bangalore Exclusion
Uses `region != 'Bangalore'` from `branches` table. No hardcoded list. Any new branch added to Branch Management automatically included/excluded based on region.

---

## INBOUND BOT MODULE

### Files
- `app/api/sync-gnani/route.js`
- `app/api/presign-recording/route.js`
- `app/api/transcribe-call/route.js` — Groq Whisper + Claude Haiku
- `app/api/summarize-call/route.js`

### Status
- 61 calls synced (Mar 18–23, 2026)
- Duration shows `—` — waiting for Gnani metadata.json (Pranjal Bhalla)
- S3 bucket: `whitegold-call-recordings` (ap-south-1)

---

## ROLE_PAGES (lib/context.js)
```javascript
super_admin/founders_office: all pages
admin:       ['dashboard','purchase-data','purchase-reports','cal-table','live-market-rates']
manager:     ['dashboard','purchase-data','purchase-reports','live-market-rates']
branch_staff: ['dashboard','purchase-data','purchase-reports']
telesales:   ['dashboard','inbound-bot']
```

---

## KEY FILES
```
app/api/sync-crm/route.js                  — CRM sync (dedup fixed)
app/api/fetch-gold-rates/route.js          — Kalinga + Ambicaa Firebase → one row/min
app/api/consignments/route.js              — Consignment CRUD + number generation
app/api/debug-rates/route.js               — DELETE when done
components/consignments/ConsignmentData.js  — Stock in Branch (drill-down UI)
components/consignments/ConsignmentReport.js — DEL-CHALLANS log
components/consignments/ConsignmentSummary.js — Movement report (BR-CONSIGNY)
components/sales/LiveMarketRates.js         — Live rates + Aamlin browser socket
goldapp-rates-proxy/index.js               — Railway proxy (Ambicaa Firebase)
```

---

## NPM PACKAGES ADDED
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `tar`, `archiver`
- `socket.io-client` — Aamlin browser socket

---

## THEME TOKENS
```javascript
dark:  { bg:'#0a0a0a', card:'#111111', card2:'#161616', text1:'#f0e6c8', text2:'#c8b89a', text3:'#9a8a6a', text4:'#6a5a3a', gold:'#c9a84c', border:'#1e1e1e', green:'#3aaa6a', red:'#e05555', blue:'#3a8fbf', orange:'#c9981f', purple:'#8c5ac8' }
light: { bg:'#f0ebe0', card:'#e8e2d6', card2:'#e0d9cc', text1:'#1a1208', text2:'#5a4a2a', text3:'#7a6a4a', text4:'#9a8a6a', gold:'#a07830', border:'#d0c8b8', green:'#2a8a5a', red:'#c03030', blue:'#2a6a9a', orange:'#a07010', purple:'#6a3a9a' }
```

---

## RECENT CHANGES (v17 - 2026-03-28)

### Purchase Module Fixes ✅
1. **PurchaseData.js - Critical Security Fix**
   - Changed hard delete to soft delete (sets `is_deleted = true` instead of permanent deletion)
   - Added `is_deleted = false` filter to buildQuery to exclude deleted records
   - Prevents accidental permanent data loss

2. **PurchaseData.js - Theme System Update**
   - Updated THEMES to match ConsignmentData theme (added card2, border2, blue, orange, purple)
   - Consistent theme system across entire app

3. **PurchaseData.js - Date Range Filters**
   - Added fromDate and toDate state variables
   - Added date range inputs in filters section
   - Updated buildQuery to filter by purchase_date range
   - Added transaction type (filterTxn) filter

4. **PurchaseData.js - Quick Filter Buttons**
   - Added quick filter buttons: Today, Yesterday, This Week, This Month
   - Added Clear All button when filters are active
   - Added Transaction Type filter dropdown (Physical/Takeover)
   - Added IST helper functions (istNow, istStr) for date handling

5. **ReportCharts.js - MoM Bug Fix** ✅
   - Fixed Month-over-Month growth calculation bug
   - Changed `monthly[i - 1]` to `monthly[i + 1]` (line 74)
   - Monthly data is sorted newest-first, so previous month is at i+1, not i-1

6. **PurchaseReports.js - Error Handling**
   - Added try-catch block around fetchAll()
   - Added error state to display user-friendly error messages
   - Shows which RPC functions may be missing if reports fail to load
   - Prevents app crash when database functions are missing

---

## PENDING BACKLOG

### Sunday 2026-03-29 (planned)
- [ ] Seed TMP PRF and external number starting points from physical stickers
- [ ] Delivery Challan PDF generation (same format as Excel)

### Consignment Module remaining
- [ ] Delivery Challan PDF generation — replicate Excel format exactly
- [ ] Internal number support (branch → hub)
- [ ] Consignment Report (DEL-CHALLANS full build)
- [ ] Movement Report (BR-CONSIGNY full build)

### Live Rates
- [ ] Fix double row insertion
- [ ] Delete debug-rates route
- [ ] Verify augmont_buy_rate

### Other
- [ ] Live Margin Calculation
- [ ] Fix MoM column RPC bug
- [ ] Custom SMTP noreply@whitegold.money
- [ ] Custom domain goldapp.whitegold.money
- [ ] Gnani metadata.json (Pranjal Bhalla)
- [ ] Melting Module (Phase 2)
- [ ] Full Sales Module (Phase 3)

---

## GOTCHAS
- Vercel Hobby — daily crons only, use cron-job.org for per-minute
- Firebase REST is public read — no auth needed for rsbl-spot-gold-silver-prices
- Aamlin Socket.IO blocked on Railway AND Vercel — browser-side only
- RLS DISABLED on: gold_rates, consignments, consignment_items
- UNIQUE constraint on purchases.application_id — prevents duplicates
- Bangalore branches excluded via `region = 'Bangalore'` in branches table
- Branch codes auto-derived from name — no manual entry needed
- stock_status values: `at_branch`, `at_ho`, `in_consignment` (not in_branch/in_transit)
- Railway auto-redeploys on git push to main
- New sync route uses upsert — safe to run multiple times