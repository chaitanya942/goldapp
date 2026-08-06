# NEW CRM — Cluster 6: Post-Purchase Gold Handling, Release/Pledge, Melting & (Unused) Bidding

**Database:** `dbwhitegold_production` (AWS Lightsail/RDS Postgres, ap-south-1)
**Scope:** `Release`, `PledgeCompany`, `GoldCollection`, `Melting`, `MeltingSummary` (ACTIVE) and `Purchase`, `Batch`, `Bid`, `Bidder` (UNUSED — 0 rows).
**Method:** Read-only introspection (`information_schema`, `pg_enum`, live SELECTs). All identifiers are PascalCase and must be quoted.
**Captured:** 2026-08-06.

---

## 0. Cluster at a glance

| Table | Rows | Status | One-line purpose |
|---|---:|---|---|
| `Release` | 2,812 | ACTIVE | Thin approval/wrapper record for a RELEASED_GOLD (takeover) transaction. |
| `PledgeCompany` | 2,248 | ACTIVE | **Financial heart** — per finance/pledge company the customer's gold was pledged to; holds all the release valuation math. |
| `GoldCollection` | 17,450 | ACTIVE (mostly dormant) | Dual (Melting-team + Accounts) sign-off that physical gold for an Order was collected. 2 rows/Order. |
| `Melting` | 4 | ACTIVE (barely used) | Per-Order melting event; dual sign-off. |
| `MeltingSummary` | 118 | ACTIVE | One row **per melting day** — aggregate gross/net/deductions of everything melted that day. |
| `Purchase` | 0 | **UNUSED** | Intended: a bidder's purchase event in the in-CRM bidding module. |
| `Batch` | 0 | **UNUSED** | Intended: melting→market→bidder-sale batch lifecycle for the bidding module. |
| `Bid` | 0 | **UNUSED** | Intended: a bid placed by a Bidder. |
| `Bidder` | 0 | **UNUSED** | Intended: an external gold bidder/buyer. |

> The bidding module (`Purchase`/`Batch`/`Bid`/`Bidder`) was scaffolded in the CRM but never used. **GoldApp implements bidding/booking itself** — the NEW CRM contributes nothing here.

### Enum types used in this cluster

| Enum type | Labels |
|---|---|
| `SalesStatus` | `PENDING, REJECTED, APPROVED` |
| `SalesHeadStatus` | `PENDING, REJECTED, APPROVED` |
| `ReleasePaymentStatus` | `PENDING, COMPLETED` |
| `GoldCollectionStatus` | `PENDING, COMPLETED` |
| `OrderStatus` | `PENDING, RECEIVED` |
| `MeltingStatus` | `PENDING, MELTED, NOT_MELTED` |
| `BatchState` | `BEFORE_MELTING, AFTER_MELTING, MARKET, BIDDER_SALE, SOLD` |
| `Role` | `ADMIN, BRANCH, KYC, KYC_MAKER, KYC_CHECKER, CALL_CENTRE, CALL_CENTRE_LEAD, MELTING_TEAM, OPERATIONS, SALES, SALES_HEAD, TELE_SALES, TELE_SALES_HEAD, ACCOUNTS, GOLD_ASSAYER, OTHERS, ACCOUNTS_HEAD, SUPER_USER` |

---

## 1. The end-to-end flow (context)

A White Gold "takeover" (a.k.a. RELEASE) happens when a customer's gold is **already pledged to another finance company / bank / pawnbroker**. White Gold pays off that loan, takes physical possession of the released ornaments, and buys the gold. The lifecycle:

```
Transaction(type = RELEASED_GOLD)               ← the takeover deal
        │  1:1
   ┌────▼─────┐
   │ Release  │  approval wrapper (estimation sales approval)
   └────┬─────┘
        │  1:N  (usually 1)
   ┌────▼──────────┐
   │ PledgeCompany │  per finance company: loan_amount, per_gram_rate,
   └────┬──────────┘   net_weight, release_amount, final_amount, deduction,
        │               sales_approval → gold_collection_status → payment_status
        │
        ├──► Payment(type = RELEASE_PAYMENT)  ← money actually paid to the finance co
        │
        ▼  gold physically collected → Order → GoldCollection → Melting → MeltingSummary
```

State progression on a `PledgeCompany` row:
`sales_approval` (release valuation approved) → `gold_collection_status` (physical gold picked up from finance co) → `payment_sales_approval` + `payment_status` (release payment approved & disbursed).

---

## 2. `Release` — takeover approval wrapper (ACTIVE, 2,812 rows)

**Purpose.** One row per RELEASED_GOLD transaction. It is a **thin approval/rollup record**; the real money and weights live in the child `PledgeCompany` rows. Confirmed: 100% of `Release` rows link to a `Transaction` whose `transaction_type = RELEASED_GOLD` (2,812/2,812).

**PK:** `id` (text/uuid).
**FK out:** `transaction_id → Transaction.id`.
**FK in:** `PledgeCompany.release_id → Release.id`; `Agreement.release_id → Release.id` (1,371 agreements carry a release_id).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (uuid). |
| `transaction_id` | text | NO | — | FK → `Transaction.id`. Always a RELEASED_GOLD txn. |
| `estimation_sales_approval` | `SalesStatus` | YES | — | Sales approval of the release **valuation/estimation**. Counts: APPROVED 1643, NULL 830, PENDING 308, REJECTED 31. |
| `estimation_sales_head_approval` | `SalesHeadStatus` | YES | — | Second-tier (sales head) approval. **100% NULL — effectively unused.** |
| `estimation_sales_remark` | text | YES | — | Free-text remark from sales on the estimation approval. |
| `estimation_sales_head_remark` | text | YES | — | Free-text remark from sales head (unused alongside the approval). |
| `total_release_amount` | double | YES | — | Rollup of the release amount across child PledgeCompany rows. **Frequently NULL** and only matches `SUM(PledgeCompany.release_amount)` for 859 of 2,211 releases-with-children — treat as unreliable; prefer summing PledgeCompany. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | When the release record was created. |
| `updated_at` | timestamp | NO | — | Last modification (e.g., an approval flip). |

**Cardinality (PledgeCompany per Release):** 1 → 2,178 releases; 2 → 30; 3 → 2; 4 → 1. Only **2,211 of 2,812** releases have any PledgeCompany child (601 releases — ~21% — are rejected/abandoned before a pledge company row was created).

**Sample (real approvals/dates):**
```
id=faa3967d…  estimation_sales_approval=APPROVED  head=NULL  total_release_amount=NULL  created=2026-08-06 01:37
id=d3999796…  estimation_sales_approval=PENDING   head=NULL  total_release_amount=NULL  created=2026-08-06 01:34
id=b9c962ea…  estimation_sales_approval=REJECTED  head=NULL  total_release_amount=NULL  created=2026-08-06 01:30
```

---

## 3. `PledgeCompany` — release valuation & settlement (ACTIVE, 2,248 rows) ⭐

**Purpose.** One row **per finance company / bank / pawnbroker** that held the customer's pledged gold (usually one per release). This is where the takeover is **valued and settled**: the loan owed, the gold weight, the per-gram rate, the release amount, the final settled amount, plus the sales/collection/payment state machine.

**PK:** `id`.
**FK out:** `release_id → Release.id`; `employee_id → Employee.emp_id`; `sales_approved_by_id → Employee.emp_id`; `payment_sales_approved_by_id → Employee.emp_id`; `company_id → Companies.id`.
**FK in:** `BankAccount.pledge_company_id`, `File.pledge_receipt_id`, `File.purchase_bill_id`, `File.release_ornament_id` (photos/scans of the pledge receipt, purchase bill and released ornaments).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK. |
| `release_id` | text | NO | — | FK → `Release.id`. Parent takeover. |
| `company_id` | text | YES | — | FK → `Companies.id` (the finance company master, when matched). Usually NULL. |
| `company_name` | text | YES | — | Free-text finance-company name. **2,229 of 2,248 NULL**; the rest are one-off strings (e.g. "muthoottu mini financiers ltd", "Karnataka bank", "mannapuram finance"). Not normalised. |
| `name` | text | YES | — | Legacy/free-text name field (customer or company). |
| `pledge_location` | text | NO | — | Where the gold was pledged (branch address / area, free text, e.g. "Koramangala", full Google-style addresses). |
| `purity` | text | NO | — | **Free text**, not numeric. Values: `''` (1055), `91.6` (824), `916` (144), `22` (43), `91.66`, `90`, `75`… Consumers must regex-filter to numeric before using. |
| `gross_weight` | double | NO | — | Gross weight of the released ornaments (g). |
| `net_weight` | double | NO | — | **Net gold weight** used for valuation (g). Confirmed `net_weight = gross_weight − deduction` for **2,248/2,248** rows. |
| `deduction` | double | NO | — | Weight deducted from gross (stones/impurities), in grams. |
| `per_gram_rate` | double | NO | — | Rate per gram at release. **Derived**: `per_gram_rate ≈ loan_amount / net_weight` (see §8). |
| `loan_amount` | double | NO | — | The outstanding loan the finance company demands to release the gold. The anchor number. |
| `release_amount` | double | NO | — | Amount to release the gold. **Equals `loan_amount`** in 2,247/2,248 rows (and `= per_gram_rate × net_weight` in 2,245/2,248). |
| `final_per_gram_rate` | double | YES | — | **Revised** per-gram rate agreed at settlement (may differ from `per_gram_rate`). |
| `final_amount` | double | YES | — | **Final settled amount actually paid** = `final_per_gram_rate × net_weight` (holds for 1,248/1,264 non-null rows). NULL until settled (1,264 of 2,248 have it). |
| `delta` | double | YES | `0` | Intended as a valuation delta. **Always 0** across all 2,248 rows — defined but never populated. |
| `interest` | double | YES | — | Intended interest rate. **100% NULL — unused.** |
| `interest_amount` | double | YES | — | Intended interest amount. **100% NULL — unused.** |
| `sales_approval` | `SalesStatus` | NO | `'PENDING'` | Sales approval of the **release estimate**. APPROVED 1662, PENDING 547, REJECTED 39. |
| `sales_approved_by_id` | text | YES | — | FK → `Employee.emp_id` who approved the estimate. |
| `payment_sales_approval` | `SalesStatus` | YES | — | Sales approval of the **release payment** (second gate, before money goes out). APPROVED 1232, NULL 984, PENDING 23, REJECTED 9. |
| `payment_sales_approved_by_id` | text | YES | — | FK → `Employee.emp_id` who approved the payment. |
| `payment_sales_remark` | text | YES | — | Remark on the payment approval. |
| `payment_status` | `ReleasePaymentStatus` | YES | — | Whether the release payment to the finance co is done. COMPLETED 1210, NULL 1016, PENDING 22. |
| `gold_collection_status` | `GoldCollectionStatus` | YES | — | Whether the physical gold has been collected from the finance co. COMPLETED 1069, NULL 1020, PENDING 159. |
| `employee_id` | text | NO | — | FK → `Employee.emp_id` who created the pledge record. |
| `pledge_date` | timestamp | NO | — | Date the gold was **originally pledged at the finance company** (customer-supplied; ranges from an obviously-bogus 1953 up to 2026 — dirty, do not trust the tail). |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | When White Gold entered this pledge record (2025-06-18 onward). |
| `updated_at` | timestamp | NO | — | Last change (approval/collection/payment flip). |

### State machine (per PledgeCompany row)
1. **Created** — `sales_approval = PENDING` (default). Valuation entered: loan_amount, net_weight, per_gram_rate, release_amount.
2. **Estimate approved** — `sales_approval = APPROVED` (or REJECTED) by `sales_approved_by_id`.
3. **Gold collected** — `gold_collection_status: NULL → PENDING → COMPLETED` (physical ornaments picked up from the finance co).
4. **Payment approved** — `payment_sales_approval = APPROVED` by `payment_sales_approved_by_id`; `final_amount` / `final_per_gram_rate` finalised.
5. **Payment done** — `payment_status = COMPLETED`; a `Payment(type = RELEASE_PAYMENT)` row disburses the money to the finance company.

### Masked sample rows (weights/rates/amounts/statuses REAL)
```
# 1  loan=79000  release=79000  per_gram=10259.74  net=7.7  gross=7.9  ded=0.2  final_rate=10259.74  final=79000  delta=0
      sales=APPROVED  pay_sales=APPROVED  pay_status=COMPLETED  gold_coll=COMPLETED   (settled at par)

# 2  loan=500000 release=500000 per_gram=9090.91  net=55  gross=58.2 ded=3.2 final_rate=9000    final=495000 delta=0
      sales=APPROVED  pay_sales=APPROVED  pay_status=COMPLETED  gold_coll=PENDING      ← RELEASE LOSS 5,000 (revalued 90.91/g down)

# 3  loan=480000 release=480000 per_gram=7384.62  net=65  gross=70   ded=5   final_rate=7692.31 final=500000 delta=0
      sales=APPROVED  pay_sales=APPROVED  pay_status=COMPLETED  gold_coll=PENDING      ← GAIN 20,000 (revalued 307.69/g up)
```

---

## 4. `GoldCollection` — physical collection dual sign-off (ACTIVE but mostly dormant, 17,450 rows)

**Purpose.** Records that the physical gold for an `Order` was received/verified. Every `Order` gets **exactly 2 rows** (8,727 orders × 2 = 17,450): one for `emp_role = MELTING_TEAM` and one for `emp_role = ACCOUNTS` — a two-party confirmation. `gross_weight`/`difference` are the weight each party recorded and the discrepancy vs expected.

**PK:** `id`. **FK out:** `orderId → Order.id`, `emp_id → Employee.emp_id`. No incoming FKs.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK. |
| `orderId` | text | YES | — | FK → `Order.id` (never NULL in practice). |
| `gross_weight` | double | YES | — | Weight this party recorded on receipt (g). |
| `difference` | double | YES | — | Discrepancy vs expected weight (g). Negative in the few RECEIVED rows. |
| `emp_id` | text | YES | — | FK → `Employee.emp_id` who signed. |
| `emp_role` | `Role` | YES | — | Which party: `MELTING_TEAM` (8,726) or `ACCOUNTS` (8,726). |
| `status` | `OrderStatus` | YES | `'PENDING'` | `PENDING` (17,448) or `RECEIVED` (**only 4**). |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Row created (Order dispatched to collection). |
| `updated_at` | timestamp | NO | — | Same as created for almost all — rarely progressed. |

**Reality check:** Only **4 rows are RECEIVED**; the other 17,448 sit PENDING with `gross_weight = 0`. The collection confirmation workflow was set up (rows auto-created per order) but the CRM's melting/accounts teams essentially never advanced it — physical handling is tracked elsewhere (and, downstream, GoldApp/consignments). Treat as **dormant**.

The 4 RECEIVED rows (2 orders) carry real weights, e.g. order `5b6f7df4…`: MELTING_TEAM gross=30 diff=-1.92, ACCOUNTS gross=10 diff=-21.92.

---

## 5. `Melting` — per-order melting event (ACTIVE but barely used, 4 rows)

**Purpose.** Records the melting of a specific Order's gold: stone removal, melting weight and purity, plus the differences (loss) at each step. Like GoldCollection, **2 rows per order** (MELTING_TEAM + ACCOUNTS). Only **2 orders** were ever recorded here.

**PK:** `id`. **FK out:** `order_id → Order.id`, `emp_id → Employee.emp_id`.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK. |
| `order_id` | text | NO | — | FK → `Order.id`. |
| `status` | `MeltingStatus` | NO | `'PENDING'` | `MELTED` (2) or `NOT_MELTED` (2). No PENDING rows survive. |
| `stone_removal_weight` | double | YES | `0` | Weight of stones removed (g). |
| `stone_weight_difference` | double | YES | `0` | Discrepancy in stone weight (g). |
| `melting_weight` | double | YES | `0` | Weight after melting (g). |
| `melting_weight_difference` | double | YES | `0` | Weight lost in melting (g). |
| `melting_purity` | double | YES | `0` | Measured purity after melting (%). |
| `purity_difference` | double | YES | `0` | Purity vs expected (%). |
| `emp_id` | text | YES | — | FK → `Employee.emp_id`. |
| `emp_role` | `Role` | YES | — | `MELTING_TEAM` or `ACCOUNTS`. |
| `reason` | text | YES | — | Why NOT_MELTED — real values seen: `"Theft"`, `"Purity discrepancy"`. |
| `comment` | text | YES | — | Free-text note. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Melting event time. |
| `updated_at` | timestamp | NO | — | Last change. |

**All 4 rows (real):**
```
order 5b6f7df4… MELTED     stone_removal=30 stone_diff=1.3  melt_wt=26 melt_diff=5.3  purity=80 purity_diff=9.05  MELTING_TEAM
order 5b6f7df4… MELTED     stone_removal=20 stone_diff=11.3 melt_wt=10 melt_diff=21.3 purity=20 purity_diff=69.05 ACCOUNTS
order 6c8f5fae… NOT_MELTED reason="Theft"               stone/melt=NULL diff=14.91 purity_diff=91.69 MELTING_TEAM
order 6c8f5fae… NOT_MELTED reason="Purity discrepancy"  stone/melt=NULL diff=14.91 purity_diff=91.69 ACCOUNTS
```

---

## 6. `MeltingSummary` — daily melting batch aggregate (ACTIVE, 118 rows) ⭐

**Purpose.** The **one genuinely-live melting table.** One row per **melting day**, aggregating everything melted that day: total gross in, stone + wastage deductions, net gold out. 118 days from 2025-06-18 to 2026-08-05. Total across all days: **gross ≈ 187,916 g, net ≈ 178,651 g**.

**PK:** `id`. **FK out:** `updated_emp_id → Employee.emp_id`. No incoming FKs.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK. |
| `date` | timestamp | NO | — | The melting day (stored ~13:00 UTC = 18:30 IST; treat the date part as IST business day). |
| `gross_weight` | double | NO | — | Total gross gold melted that day (g). |
| `stone_deduction` | double | NO | — | Total stone weight removed (g). |
| `wastage_deduction` | double | NO | — | Total melting/refining wastage (g). |
| `net_weight` | double | NO | — | Net fine gold produced (g) = `gross_weight − total_deduction`. |
| `total_deduction` | double | YES | `0` | `stone_deduction + wastage_deduction` (confirmed on samples: 16.8+7.0073=23.8073). |
| `crushed_stone_weight` | double | YES | — | Weight of crushed stones. **All NULL — unused analytic field.** |
| `whole_stone_weight` | double | YES | — | Weight of whole stones. **All NULL.** |
| `physical_melting_waste` | double | YES | — | Physically-measured melting waste. **All NULL.** |
| `melting_waste` | double | YES | — | Computed melting waste. **All NULL.** |
| `total_collection` | double | YES | — | Total gold collected feeding this melt. **All NULL.** |
| `stone_wastage_difference` | double | YES | — | Stone-vs-wastage reconciliation. **All NULL.** |
| `am_weight` | double | YES | — | Assay-melt / after-melt weight. **All NULL.** |
| `updated_emp_id` | text | YES | — | FK → `Employee.emp_id` last editor. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Row insert (late that night IST). |

**Sample (real):**
```
date=2026-08-05  gross=509.67    stone_ded=16.8   wastage=7.0073  net=485.8627  total_ded=23.8073
date=2026-08-04  gross=3812.782  stone_ded=108.9  wastage=54.725  net=3649.157  total_ded=163.625
date=2026-08-03  gross=2543.53   stone_ded=72.55  wastage=42.637  net=2428.343  total_ded=115.187
```
Only the six core columns (`date, gross_weight, stone_deduction, wastage_deduction, net_weight, total_deduction`) are populated; the finer breakdown columns are dead.

---

## 7. THE MATH — how a RELEASE / TAKEOVER is valued

All formulas below were **verified against the full 2,248-row `PledgeCompany` table**, not just samples.

### 7.1 Weight
```
net_weight = gross_weight − deduction          ✔ 2248 / 2248 rows (100%)
```
`deduction` is the stone/impurity weight taken off the gross before gold is valued.

### 7.2 The loan is the anchor; per_gram_rate is derived
```
release_amount = loan_amount                    ✔ 2247 / 2248 rows (99.96%)
per_gram_rate × net_weight ≈ loan_amount        ✔ 2245 / 2248 rows
  ⇒  per_gram_rate = loan_amount / net_weight   (back-computed for display)
```
So at release time White Gold does **not** independently price the gold — it pays whatever loan the finance company demands (`loan_amount`), and `per_gram_rate` is just that loan spread over the net weight. `release_amount` is a synonym of `loan_amount`.

### 7.3 Settlement — the final amount (where loss/gain appears)
```
final_amount = final_per_gram_rate × net_weight ✔ 1248 / 1264 settled rows
```
At payment approval a **revised** rate (`final_per_gram_rate`) may be agreed, producing the actual `final_amount` paid.

### 7.4 RELEASE LOSS vs GAIN
```
result = final_amount − release_amount   ( = final_amount − loan_amount )

   final_amount = release_amount  → 909 rows  (settled at par)
   final_amount > release_amount  → 241 rows  (gain)
   final_amount < release_amount  → 114 rows  (RELEASE LOSS)
   avg(final − release) = +11,669   min = −6,849,000   max = +7,748,000
```
- **RELEASE LOSS** = White Gold ends up paying the finance company **more than the gold's revised worth** (`final_amount < loan_amount`). Example row #2 in §3: loan 500,000 but the gold revalued to 495,000 → a 5,000 loss. This is the "RELEASE LOSS" case GoldApp is built to surface.
- **Gain** = the gold was worth more than the loan cleared.
- `delta` was the intended column to store this difference but is **always 0** (dead); GoldApp/consumers must compute `final_amount − loan_amount` themselves.

### 7.5 Ties to Transaction & Payment
- **Transaction:** every `Release` → a `Transaction` with `transaction_type = RELEASED_GOLD` (2,926 such transactions cluster-wide; 2,812 have a Release). GoldApp maps `RELEASED_GOLD → 'TAKEOVER'` (vs `PHYSICAL_GOLD → 'PHYSICAL'`).
- **Payment:** the money actually leaving White Gold to the finance company is a `Payment` row with **`type = RELEASE_PAYMENT`** (1,205 rows; `PENNY_DROP` 10,403 and `FINAL_PAYMENT` 9,741 are the other two types). RELEASE_PAYMENT amounts line up with `loan_amount`/`final_amount` (e.g. 500,000 / 601,000 / 205,000). Note per MEMORY: RELEASED_GOLD/TAKEOVER final payments can settle with `Payment.status = CONFIRMED`, not COMPLETED — sync must accept it.

---

## 8. Timestamps — what each marks

| Column | Marks |
|---|---|
| `Release.created_at` / `updated_at` | Release record created / last approval change. |
| `PledgeCompany.pledge_date` | Original pledge date at the **finance company** (customer-supplied; dirty — 1953 floor). |
| `PledgeCompany.created_at` | When White Gold entered the pledge record. |
| `PledgeCompany.updated_at` | Last state change (estimate/collection/payment approval). |
| `GoldCollection.created_at` / `updated_at` | Collection row created (Order dispatched to collection); rarely updated. |
| `Melting.created_at` | The melting event. |
| `MeltingSummary.date` | The melting **business day** (IST). |
| `MeltingSummary.created_at` | When the daily summary was saved (late night IST). |

---

## 9. UNUSED bidding module (0 rows — schema + intended purpose only)

These four tables form an in-CRM **gold bidding / resale** module that was scaffolded but **never populated**. GoldApp implements bidding/booking itself, so these are inert. Documented for completeness.

### 9.1 `Bidder` (0 rows) — an external gold bidder/buyer
PK `id`. Columns: `id`, `name` (NOT NULL), `created_at` (default now), `updated_at`.
**FK in:** `Bid.bidder_id`, `Purchase.bidder_id`.

### 9.2 `Bid` (0 rows) — a bid placed by a Bidder
PK `id`. Columns: `id`, `bid_date` (NOT NULL), `market_rate` (double, NOT NULL), `weight` (double, NOT NULL), `bidder_id` (FK → Bidder.id), `emp_id` (FK → Employee.emp_id), `created_at`, `updated_at`.
**FK in:** `Batch.bid_id`.
*Intended:* record a bidder's quoted `market_rate` for a given `weight` of gold on `bid_date`.

### 9.3 `Purchase` (0 rows) — a bidder purchase event
PK `id`. Columns: `id`, `bidder_id` (FK → Bidder.id), `date` (NOT NULL), `updated_emp_id` (FK → Employee.emp_id), `created_at`, `updated_at`.
**FK in:** `Batch.purchase_id`.
*Intended:* the header for a batch of gold sold to a winning bidder on `date`. (This is the CRM's **sell-side** Purchase — unrelated to a customer purchase.)

### 9.4 `Batch` (0 rows) — melting→market→bidder-sale batch lifecycle
**Composite PK:** (`name`, `created_date`, `state`). ~30 columns tracking a batch of melted gold through a `BatchState` machine (`BEFORE_MELTING → AFTER_MELTING → MARKET → BIDDER_SALE → SOLD`), with weight + purity + image + editor + date captured at each stage:
- Before-melting: `before_melting_weight/_image/_date/_updated_emp_id`.
- After-melting: `after_melting_weight/_image/_purity/_purity_image/_date/_updated_emp_id`.
- Market: `market_weight/_image/_purity/_purity_image/_rate/_date/_updated_emp_id`, `net_market_weight`.
- Bidder sale: `bidder_market_weight/_purity`, `bidder_slip`, `bidder_sale_date/_updated_emp_id`, `gross_sale_amount`.
- Links: `bid_id` (FK → Bid.id), `purchase_id` (FK → Purchase.id), `purchase_date`.
- `state` (`BatchState`, NOT NULL), `created_date` (NOT NULL), `created_at`, `updated_at`.
*Intended:* trace a physical batch of White Gold's melted gold from the melting room to sale to an external bidder.

---

## 10. How GoldApp uses these tables (repo grep)

**Active, load-bearing usage:**
- **`app/api/crm-purchases/route.js` (lines ~995–1067)** — the main consumer. Computes each takeover's net gold weight and value from **`Release` JOIN `PledgeCompany`**:
  - `pledge AS (SELECT r.transaction_id, SUM(pc.net_weight) … FROM "Release" r JOIN "PledgeCompany" pc ON pc.release_id = r.id GROUP BY r.transaction_id)`.
  - Weight resolver coalesces **ornament → pledge (PledgeCompany) → order** so takeover deals (which have no Ornament rows) still get a real weight/value; also sums `pc.final_amount` and computes a weighted purity, explicitly regex-guarding `pc.purity` because it is free text.
  - `rel AS (SELECT transaction_id, SUM(total_release_amount) …)` is also read (with the caveat above that it's often NULL).
- **`app/api/sync-new-crm/route.js` (line 27)** and **`app/api/sync-purchases/route.js`, `app/api/backfill-purchases/route.js`, `lib/purchaseRegisterData.js`** — `mapTxnType`: `transaction_type.includes('RELEASED') → 'TAKEOVER'` else `'PHYSICAL'`. This is how the RELEASED_GOLD → TAKEOVER label reaches GoldApp's purchases.
- **`app/api/billed-vs-paid/route.js`** — sums `Payment` where `type='RELEASE_PAYMENT' AND action='DEBITED'` as the takeover disbursement, netting reversals.
- **`app/api/productivity/route.js`** — stage labels `RELEASE_PENDING` ("Release / Ops") and `RELEASE_PAYMENT_PENDING` ("Accounts (release payment)"); classifies txns as TAKEOVER when `ttype='RELEASED_GOLD'`.
- **UI:** `components/purchases/PurchaseData.js`, `components/consignments/ConsignmentData.js` & `CollectionAudit.js`, `PurchaseReports.js`, `ReportBranches.js`, `ReportCharts.js` — badge/filter/split rows by `transaction_type === 'TAKEOVER'` (purple) vs physical (gold/green).

**Not referenced anywhere in GoldApp:** `GoldCollection`, `Melting`, `MeltingSummary`, and the bidding tables (`Purchase`/`Batch`/`Bid`/`Bidder`). GoldApp consumes the **release valuation** (Release + PledgeCompany + RELEASE_PAYMENT) but not the physical collection/melting records.

---

## 11. Key takeaways

1. **`PledgeCompany` is the only financially-rich table** in this cluster; `Release` is a thin approval wrapper and `total_release_amount` is unreliable (prefer `SUM(PledgeCompany.release_amount)`).
2. **Valuation formula:** `net_weight = gross − deduction`; `release_amount = loan_amount = per_gram_rate × net_weight`; `final_amount = final_per_gram_rate × net_weight`. **RELEASE LOSS = final_amount < loan_amount** (114 rows). `delta`, `interest`, `interest_amount` are dead columns.
3. **Two settlement gates:** `sales_approval` (estimate) then `payment_sales_approval` + `payment_status` (payment), with `gold_collection_status` for physical pickup. Money out = `Payment.type='RELEASE_PAYMENT'`.
4. **GoldCollection & Melting are essentially dormant** (4 RECEIVED collections, 4 melting rows). **MeltingSummary is the live daily-melt ledger** (118 days, ~178.6 kg net).
5. **The bidding module (Purchase/Batch/Bid/Bidder) is unused (0 rows)** — GoldApp does bidding itself.
6. **GoldApp integration point:** `RELEASED_GOLD → TAKEOVER` mapping + `Release⋈PledgeCompany` weight/value join in `crm-purchases`, and `RELEASE_PAYMENT` in `billed-vs-paid`.
