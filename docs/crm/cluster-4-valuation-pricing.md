# NEW CRM — Cluster 4: Valuation / Pricing Engine

**Database:** `dbwhitegold_production` (PostgreSQL, AWS Lightsail, `ls-…ap-south-1`)
**Scope:** `Estimation`, `Ornament`, `Quotation`, `Spectrometer`, `GoldRate`, `Agreement`
**Access:** read-only (`nighthack`, full R/W creds but app only SELECTs). All identifiers are **PascalCase and must be quoted**: `SELECT * FROM "Estimation"`.
**Captured:** 2026-08-06. Row counts and samples are live snapshots.

> This is the **pricing engine** of the CRM — how a customer's gold is weighed, purity-tested, priced by purity band, negotiated, and turned into the final payout figure. The money-math section below is reconstructed and **arithmetically verified against real rows** (see §MONEY MATH).

---

## 0. Cluster map — how the tables link

```
                       Transaction (1)  ── the customer visit / deal
                          │  id
        ┌─────────────────┼───────────────────────────┐
        │ transaction_id  │ transaction_id             │ (via Release)
        ▼                 ▼                            ▼
   Estimation (16,180)  Quotation (10,122)        Agreement (1,370)
     │ id                 │ id                     Agreement.release_id → Release.id
     │                    │                        (Release.transaction_id → Transaction)
     │ estimation_id      │ quotation_id
     ▼                    ▼
   Ornament (54,151) ─────┘   each gold item; FK to EITHER Estimation OR Quotation
     ▲
     │ estimation_id / quotation_id
   Spectrometer (932)  ── purity-tester readings; FK to Estimation and/or Quotation, plus Customer

   GoldRate (64) ── per-STATE per-band buying rates (the rate card). state_id → State.
```

**Lifecycle in one line:** Branch weighs items → **Spectrometer** reads purity → an **Estimation** is built (one per Transaction, holds the rate bands + N Ornaments) → sales **negotiation** updates rates → a **Quotation** is generated (the final priced figure, its own copy of the Ornaments) → on takeover deals an **Agreement** PDF locks the rates. `Ornament` rows migrate: created against `estimation_id`, later re-linked/re-created against `quotation_id`.

**Key FKs (verified from `information_schema`):**

Outgoing:
- `Estimation.transaction_id → Transaction.id`
- `Estimation.service_charge_approved_id → Employee.emp_id`, `Estimation.negotiation_approved_id → Employee.emp_id`
- `Ornament.estimation_id → Estimation.id`, `Ornament.quotation_id → Quotation.id`
- `Ornament.valuated_by_id → Employee.emp_id`, `Ornament.approved_by_id → Employee.emp_id`
- `Quotation.transaction_id → Transaction.id`, `Quotation.quotation_approved_id → Employee.emp_id`
- `Spectrometer.customer_id → Customer.id`, `Spectrometer.estimation_id → Estimation.id`, `Spectrometer.quotation_id → Quotation.id`
- `GoldRate.state_id → State.id`, `GoldRate.updated_emp_id → Employee.emp_id`
- `Agreement.release_id → Release.id`

Incoming (who points at us): `Ornament`, `Spectrometer`, and many `File.*` columns (`total_weight_id`, `estimation_total_ornament_id`, `spectro_ornament_id`, `ornament_id`, `quotation_total_ornament_id`, `quotation_total_weight_id`, `total_spectrometer_id`, `agreement_id`) — i.e. the `File` table stores the generated PDFs/images for each valuation artifact.

---

## ⚑ THE MONEY MATH (verified) — read this first

Everything downstream (branch payout, margin analysis) reduces to **three formulas**, each checked against real rows.

### Formula 1 — Ornament net weight
```
net_weight = gross_weight − stone_weight − wastage
```
Verified: 51,077 / 54,158 rows match exactly (`ABS(diff) < 0.001`). Mismatches are rows where stone/wastage were entered as null or the net was manually overridden.

### Formula 2 — Ornament amount (the per-item payout)
```
amount = net_weight × (gold_rate + delta) × (branch_purity / 100)
```
Verified: **49,684 / 54,155 rows match exactly** (`ABS(diff) < ₹1`). With `delta = 0` (the default, ~99% of rows) this is simply `net_weight × gold_rate × branch_purity/100`.

- `gold_rate` is a **per-gram rupee rate** already selected for this item's purity band (see Formula 3). It is roughly the 24k-equivalent rate (~₹11,600–₹14,400/g in 2026 rows).
- `branch_purity` (NOT `purity`) is the fineness fraction actually used for payment — the branch-agreed purity. Using `purity` instead fails: only 18,590 rows match on `purity` vs 49,538 on `branch_purity`.
- `delta` is a **manual per-gram rate override/adjustment** (defaults 0). When an assayer/ops overrides the rate for one item, they store the signed difference in `delta` rather than editing `gold_rate`. Example ORN-33810: `gold_rate=14301.31, delta=−547.11` → effective `13754.20`; `7.66 × 13754.20 × 0.84 = 88,500.00 = amount` ✓.

**Worked example — Ornament ORN-33727 (real, quotation cca9119d):**
`gross 16.54 − stone 0.80 − wastage 0.20 = net 15.54 g`. `branch_purity 91.6`, `gold_rate 14355.61`, `delta 0`.
`amount = 15.54 × 14355.61 × 0.916 = ₹204,346.94` — matches stored `amount = 204346.9403304` to the paisa. ✓
(Note `purity = 91.84` was the *tested* fineness; the *paid* fineness `branch_purity = 91.6` is what the money uses — a real margin lever.)

### Formula 3 — Which rate band feeds `gold_rate` (⚠ the important gotcha)

The Estimation/Quotation hold **three band rates**, but **the column names are shifted one band below the value they actually price.** Confirmed by matching every ornament's `gold_rate` to its parent's rate fields, grouped by purity:

| Item purity (karat)            | `gold_rate` is copied from the field named… | Match rate |
|--------------------------------|---------------------------------------------|------------|
| ≥ 88 (≈22K, hallmark 91.6)     | **`margin_24k`**  (the 24k-equivalent rate) | 15,427/16,000 (96%) |
| 70.8 – 88 (18–21K)             | **`rate_22k`**                              | 4,862/5,220 (93%)   |
| 58.3 – 70.8 (14–17K)           | **`rate_17k_21k`**                          | 108/109 (99%)       |
| < 58.3                         | (rare; `rate_14k_17k` is 0 / band disabled) | —                   |

So on `Estimation`/`Quotation`/`Agreement`:
- **`margin_24k`** = the effective per-gram rate paid for **22K / hallmarked (≥88%) gold** — the highest, ~₹14,300–14,400.
- **`rate_22k`** = the per-gram rate for the **18–21K band** (~₹11,600–12,500).
- **`rate_17k_21k`** = the per-gram rate for the **14–17K band** (~₹10,500, often a flat floor).
- **`rate_14k_17k`** = **almost always 0** — the lowest band is disabled (company doesn't buy it, or 0 = "not offered").

This mislabelling matters: naïvely reading `rate_22k` as "the 22K rate" understates the real 22K payout by ~₹2,700/g. **The 22K payout uses `margin_24k`.**

> Contrast: on the **`GoldRate`** rate-card table, `margin_24k` means something *different* — a small per-gram **spread/margin** (values 0, 1, 100, −984), not a full rate. There, `rate_24k` (~₹13,500–14,700) is the spot-equivalent and `rate_22k`/`rate_17_21k` are the discounted buy rates. The Estimation's `margin_24k` ≈ `GoldRate.rate_24k` net of margin. **Same column name, opposite meaning across tables — do not conflate.**

### Formula 4 — Quotation / Estimation final amount (after service charge)
```
service_charge_amount = Σ(ornament.amount) × service_charge / 100      -- service_charge is a PERCENT
final_amount          = Σ(ornament.amount) − service_charge_amount
                      = Σ(ornament.amount) × (1 − service_charge/100)
```
Verified across many rows, exact to the paisa. Examples:

| Quotation | Σ ornament amount | service_charge % | service_charge_amount | final_amount | Σ − sc |
|-----------|-------------------|------------------|-----------------------|--------------|--------|
| cca9119d  | 340,841.23        | 1                | 3,408.41              | 337,432.82   | 337,432.82 ✓ |
| b9516715  | 95,088.92         | 2                | 1,901.78              | 93,187.14    | 93,187.14 ✓ |
| ee35d067  | 217,844.49        | 1.5              | 3,267.67              | 230,100.57*  | 214,576.82 |
| 47cded24  | 578,069.21        | 0.85             | 4,913.59              | 573,155.62   | 573,155.62 ✓ |
| d642687b  | 49,501.00         | 0                | 0                     | 49,501.00    | 49,501.00 ✓ |

\* ee35d067's `final_amount` (230,100.57) exceeds Σ−sc because one ornament (ORN-33773) was manually re-priced after the sum was cached — an example of the ~8% override rows. The **formula is exact whenever ornament amounts aren't hand-edited afterward.**

**End-to-end worked payout (Quotation cca9119d, 2 items, real):**
1. ORN-33727: net 15.54 × 14355.61 × 0.916 = **204,346.94**
2. ORN-33729: (gross 13.38 − stone 2.8 − wastage 0.2 = net 10.38) × 14355.61 × 0.916 = **136,494.29**
3. Σ = 340,841.23 · service_charge 1% → sc_amount = 3,408.41
4. **final_amount = 340,841.23 − 3,408.41 = ₹337,432.82** → matches stored `337432.816…` ✓

That `final_amount` is the number that flows to `Quotation.final_amount`, then into GoldApp's purchase register as the deal value.

### Negotiation overlay (`updated_rate_*`)
When sales negotiates, `is_rates_updated` flips to `true` (only **624 / 16,180** estimations) and the agreed new rates land in `updated_rate_22k` / `updated_margin_24k` / `updated_rate_17k_21k` / `updated_rate_14k_17k`. Of the 624, 517 carry a non-zero `updated_rate_22k` and 97 a non-zero `updated_margin_24k`. The ornament `gold_rate` is then recomputed from the updated band and amounts re-derived with the same Formula 2. `customer_expected_amount` records what the customer asked for (the negotiation target).

---

## 1. `Estimation` — the valuation of one customer's gold

**Purpose:** One row per `Transaction` (the "walk-in valuation"). Holds the **rate bands** applied to that visit, the service charge, the negotiation/approval state, and the rolled-up `final_amount`. Parent of the pre-quotation `Ornament` rows.
**Row count: 16,180.** PK `id` (text/uuid).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | no | — | PK (uuid). |
| `transaction_id` | text | no | — | FK → `Transaction.id`. One estimation per transaction. |
| `final_amount` | float8 | yes | — | Rolled-up payout after service charge (Formula 4). |
| `service_charge` | float8 | **no** | `3` | Service charge **as a percent** (0–3 typical). |
| `service_charge_amount` | float8 | yes | — | ₹ deducted = Σamount × service_charge/100. |
| `customer_expected_amount` | float8 | yes | — | What the customer wants (negotiation target). |
| `rate_22k` | float8 | yes | — | Per-gram rate for the **18–21K** band (see Formula 3 — misnamed). |
| `rate_17k_21k` | float8 | yes | — | Per-gram rate for the **14–17K** band. |
| `rate_14k_17k` | float8 | yes | — | Lowest band; almost always 0 (disabled). |
| `margin_24k` | float8 | yes | — | Per-gram rate for **22K / ≥88% (hallmark)** gold — the real 22K rate. |
| `updated_rate_22k` | float8 | yes | — | Negotiated override of `rate_22k`. |
| `updated_rate_17k_21k` | float8 | yes | — | Negotiated override. |
| `updated_rate_14k_17k` | float8 | yes | — | Negotiated override. |
| `updated_margin_24k` | float8 | yes | — | Negotiated override of the 22K rate. |
| `is_rates_updated` | bool | **no** | `false` | True once negotiation changed the rates (624 rows). |
| `release_amount` | float8 | yes | — | For takeover/pledge-release deals: amount to settle the pledge. |
| `difference_amount` | float8 | yes | — | final_amount − release_amount (net paid to customer on takeovers). |
| `status` | `EstimationStatus` | **no** | `PENDING` | Workflow state (see below). |
| `assayer_status` | `AssayerStatus` | yes | `PENDING` | Purity-test/assay progress. |
| `gold_rate_approval` | `SalesHeadStatus` | yes | — | Sales-head sign-off on rate. **100% NULL in prod — unused.** |
| `negotiation_approval` | `SalesStatus` | yes | — | Sales sign-off on negotiated rate. |
| `service_charge_approval` | `SalesStatus` | yes | — | Sign-off on a non-standard service charge (only 73 rows APPROVED). |
| `negotiation_approved_id` | text | yes | — | FK → `Employee.emp_id` who approved negotiation. |
| `service_charge_approved_id` | text | yes | — | FK → `Employee.emp_id` who approved the service charge. |
| `gold_rate_remark` / `negotiation_remark` / `service_charge_remark` | text | yes | — | Free-text notes per approval. |
| `reject_reason` | text | yes | — | Why rejected. |
| `gold_assayer_remark` / `sales_head_remark` / `sales_remark` | text | yes | — | Stage remarks. |
| `created_at` | timestamp | **no** | `CURRENT_TIMESTAMP` | Estimation opened. |
| `updated_at` | timestamp | **no** | — | Last change (used by productivity TAT). |

### Enums & distributions (live counts)

**`EstimationStatus`** (12 defined; only 8 seen in data):
`PENDING, VALUATION_PENDING, SALES_NEGOTIATION_PENDING, SALES_NEGOTIATION_REJECTED, SALES_NEGOTIATION_COMPLETED, SALES_APPROVAL_PENDING, SALES_REJECTED, SALES_APPROVED, SALES_HEAD_APPROVAL_PENDING, SALES_HEAD_REJECTED, SALES_HEAD_APPROVED, VALUATION_COMPLETED, COMPLETED`

| status | n |
|---|---|
| SALES_NEGOTIATION_COMPLETED | 8,867 |
| PENDING | 5,516 |
| COMPLETED | 854 |
| SALES_NEGOTIATION_PENDING | 394 |
| VALUATION_COMPLETED | 357 |
| SALES_NEGOTIATION_REJECTED | 118 |
| SALES_APPROVED | 45 |
| VALUATION_PENDING | 30 |

Meaning / order: `PENDING` (created) → `VALUATION_PENDING`/`VALUATION_COMPLETED` (assayer weighing & purity) → `SALES_NEGOTIATION_PENDING` (waiting on sales) → `SALES_NEGOTIATION_COMPLETED` (rate agreed) or `SALES_NEGOTIATION_REJECTED` → `SALES_APPROVED` (rare higher sign-off) → `COMPLETED` (quotation generated, deal done). The `SALES_HEAD_*` and `SALES_APPROVAL_PENDING`/`SALES_REJECTED` states exist in the enum but are effectively unused in prod.

**`AssayerStatus`** = `PENDING, COMPLETED, REQUESTED`. On Estimation: PENDING 12,953 · COMPLETED 2,170 · null 1,058. Marks whether the spectrometer/assay purity test is done.

**`SalesStatus`** = `PENDING, REJECTED, APPROVED` — used by `negotiation_approval` (APPROVED 9,118 · null 5,173 · PENDING 1,772 · REJECTED 118) and `service_charge_approval` (APPROVED 73 · null 16,108).

**`SalesHeadStatus`** = `PENDING, REJECTED, APPROVED` — used by `gold_rate_approval`, which is **null in all 16,180 rows** (feature dormant).

**`service_charge`** distribution: `1`=3,794 · `3`=3,517 (the default) · `0`=2,750 · `1.5`=2,168 · `2`=1,046 · … (continuous 0–3%).

### Approval state machine
1. **Assay** (`assayer_status`): PENDING → (REQUESTED) → COMPLETED. Assayer confirms weight & purity per ornament.
2. **Negotiation** (`negotiation_approval`, a `SalesStatus`): a salesperson reviews the customer's counter-offer; sets APPROVED/REJECTED, stamps `negotiation_approved_id` (emp) + `negotiation_remark`. Drives status → `SALES_NEGOTIATION_COMPLETED` / `_REJECTED`.
3. **Service charge** (`service_charge_approval`): only invoked when the charge deviates from standard; approver in `service_charge_approved_id`. Rare (73).
4. **Gold-rate / sales-head** (`gold_rate_approval`): designed for a sales-head to sign off the base rate — **not in use** (all null).

Crosstab `status × negotiation_approval` confirms the coupling: `SALES_NEGOTIATION_COMPLETED` is APPROVED 8,169 / PENDING 700; `SALES_NEGOTIATION_REJECTED` is REJECTED 118; bare `PENDING` is mostly null/PENDING.

### 3 masked sample rows (weights/rates/amounts REAL)
> These three are early test/QA transactions (remarks "dgds"/"test"/"fdsa", rates like 6913/8500 are non-production); shown to illustrate columns. See §Ornament and §MONEY MATH for real production numbers.

```
id 01adb5b3… tx b982d6b8… final_amount 53,360.94  sc% 3  sc_amt 1,650.34
  rate_22k 6913.19  margin_24k 9743.66  rate_17k_21k 6000  rate_14k_17k 0
  updated_rate_22k 7000  is_rates_updated true  status SALES_NEGOTIATION_COMPLETED
  negotiation_approval APPROVED (emp WG00433, remark "dgds")  assayer COMPLETED
  created 2025-08-06  updated 2026-04-09   customer_expected 78,000

id 25c01df6… tx ed40bc3d… final_amount 346,269.37  sc% 1  sc_amt 3,497.67
  rate_22k 8500  margin_24k 10693.56  rate_17k_21k 6000  updated_rate_22k 8500
  is_rates_updated true  status SALES_NEGOTIATION_COMPLETED  neg APPROVED (WG00433)
  assayer null  customer_expected 0

id e3d11625… tx a7ec2b34… final_amount 528,618.05  sc% 1  sc_amt 5,339.58
  rate_22k 7929.52  margin_24k 10855.18  rate_17k_21k 6000  updated_margin_24k 10855.18
  is_rates_updated true  status SALES_NEGOTIATION_COMPLETED  neg APPROVED (WG00433)
  assayer COMPLETED  customer_expected 560,000
```

**Real production reconciliation** (Estimation-linked, single-item, exact):
`f34e932f` final 253,688.06 = Σorn 261,534.08 − sc(3%) 7,846.02 ✓ · `85b985dd` final 127,180.88 = 131,114.31 − 3,933.43 ✓ · `d93b84ad` final 100,010.96 ≈ 100,906.50 − 1,009.07 (tiny rounding).

---

## 2. `Ornament` — one gold item (the atomic priced unit)

**Purpose:** Each physical item (chain, coin, earring…). Carries its own weights, tested & agreed purity, the band rate assigned to it, and its computed `amount`. Belongs to **either** an Estimation (pre-quote) **or** a Quotation (post-quote) — the same item is often re-created against the quotation.
**Row count: 54,151.** PK `id`. Human id `ornament_id` (e.g. `ORN-33727`) via `generate_ornament_id('ORN-', 5)`.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | no | — | PK (uuid). |
| `ornament_id` | text | yes | `generate_ornament_id('ORN-',5)` | Human code, e.g. ORN-33727. Not globally unique across dup rows. |
| `estimation_id` | text | yes | — | FK → `Estimation.id` (pre-quotation link). |
| `quotation_id` | text | yes | — | FK → `Quotation.id` (post-quotation link). Exactly one of the two is set. |
| `name` | text | **no** | — | Item description ("Chain HM", "coins", "Earrings HM"). HM = hallmarked. |
| `quantity` | int4 | **no** | `1` | Count of identical pieces. |
| `gross_weight` | float8 | **no** | — | Total weighed grams. |
| `stone_weight` | float8 | yes | — | Grams of stones/non-gold subtracted. |
| `wastage` | float8 | yes | `0` | Grams deducted for solder/wastage. |
| `net_weight` | float8 | yes | — | Payable gold grams = gross − stone − wastage (Formula 1). |
| `with_stone` | bool | yes | `false` | Item contains stones. |
| `purity` | float8 | **no** | — | **Tested** fineness % (spectrometer/assay), e.g. 91.76. |
| `purity_value` | float8 | **no** | — | Mirror of tested purity (≈ `purity`). |
| `branch_purity` | float8 | **no** | — | **Agreed/paid** fineness % — the one used in the money math (Formula 2). |
| `base_rate` | float8 | yes | — | **NULL in all 54,154 rows** — legacy/unused. |
| `gold_rate` | float8 | **no** | — | Per-gram ₹ rate assigned from the parent's band (Formula 3). |
| `delta` | float8 | yes | — | Signed per-gram manual rate adjustment (default effectively 0). |
| `amount` | float8 | **no** | — | Item payout = net × (gold_rate+delta) × branch_purity/100 (Formula 2). |
| `approve` | bool | yes | — | Assayer/ops approval. true 20,987 · false 209 · **null 32,958**. Only `approve=true` count for the sync weight. |
| `retest` | bool | yes | — | Flagged for a purity re-test. |
| `assayer_status` | `AssayerStatus` | yes | — | Per-item assay state (PENDING/REQUESTED/COMPLETED). |
| `assayer_remark` | text | yes | — | Assayer note. |
| `branch_remark` | text | yes | — | Branch note. |
| `valuated_by_id` | text | yes | — | FK → `Employee.emp_id` who valued it. |
| `approved_by_id` | text | yes | — | FK → `Employee.emp_id` who approved. |
| `purity_image` / `weight_image` | text | yes | — | Photo refs of the tester/scale readouts. |
| `valuation_requested_at` | timestamp | yes | — | When valuation was requested. |
| `valuation_submitted_at` | timestamp | yes | — | When the valuer submitted (TAT for the valuation step). |
| `created_at` | timestamp | yes | `CURRENT_TIMESTAMP` | Row created. |
| `updated_at` | timestamp | yes | — | Last change. |

`purity` distribution (top): 91.6 = 27,076 (standard 22K hallmark) · 91.66 = 3,986 · 83.33 = 2,239 (20K) · 79.16 = 1,958 · 74.99 = 1,828 (18K) · 87.49 = 1,398 · 75 = 1,178 · 99.99 = 452 (pure) · … Continuous, clustered at the karat marks. `base_rate` is 100% null. `gold_rate` clusters at the band rates (11600, 12000, 10500 …) plus computed 24k-equivalents (14064.35, 13758.97 …).

### 3 masked sample rows (real numbers)
```
ORN-33729  gross 13.38  stone 2.80  wastage 0.20  net 10.38  quantity 1
   purity 91.76  branch_purity 91.60  gold_rate 14355.61  delta 0  amount 136,494.29
   quotation_id cca9119d…  approve true  assayer COMPLETED  valuated_by WG00421
   valuation_requested 2026-08-06 00:53  submitted 00:54  name "Earrings HM"  with_stone true

ORN-33727  gross 16.54  stone 0.80  wastage 0.20  net 15.54  quantity 1
   purity 91.84  branch_purity 91.60  gold_rate 14355.61  delta 0  amount 204,346.94
   quotation_id cca9119d…  approve true  assayer COMPLETED  valuated_by WG00862  name "Necklace HM"

ORN-33810  gross 7.66  stone 0  wastage 0  net 7.66  quantity 1
   purity 87.50  branch_purity 84.00  gold_rate 14301.31  delta -547.1138  amount 88,500.00
   quotation_id 7210224a…  (delta override: eff rate 13754.20 → 7.66×13754.20×0.84 = 88,500) ✓
```

---

## 3. `Quotation` — the final priced offer

**Purpose:** The finalized quote for a Transaction — a snapshot of the band rates, service charge and `final_amount` that the customer accepts. One (latest) per transaction; its own `Ornament` set (`quotation_id`). This `final_amount` is the value GoldApp treats as the purchase amount.
**Row count: 10,122.** PK `id`.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | no | — | PK (uuid). |
| `transaction_id` | text | **no** | — | FK → `Transaction.id`. |
| `rate_22k` | float8 | yes | — | 18–21K band per-gram rate (misnamed, per Formula 3). |
| `rate_17k_21k` | float8 | yes | — | 14–17K band per-gram rate. |
| `rate_14k_17k` | float8 | yes | — | Lowest band (usually null/0). |
| `margin_24k` | float8 | yes | — | 22K / ≥88% per-gram rate — the real 22K rate. |
| `service_charge` | float8 | **no** | `3` | Percent charged. |
| `service_charge_amount` | float8 | yes | — | ₹ = Σamount × service_charge/100. |
| `final_amount` | float8 | yes | — | Σ(ornament.amount) − service_charge_amount (Formula 4). |
| `release_amount` | float8 | yes | — | Pledge settlement amount (takeover deals). |
| `difference_amount` | float8 | yes | — | final − release (net to customer). |
| `status` | `QuotationStatus` | yes | — | APPROVED 10,038 · null 66 · PENDING 11 · REQUESTED 9. |
| `quotation_approved_id` | text | yes | — | FK → `Employee.emp_id` who approved. |
| `operations_remark` / `branch_remark` | text | yes | — | Notes. |
| `created_at` | timestamp | **no** | `CURRENT_TIMESTAMP` | Quote created. |
| `updated_at` | timestamp | **no** | — | Last change. |

**`QuotationStatus`** = `PENDING, APPROVED, REQUESTED`. Almost everything ends APPROVED (10,038/10,122) — the quote is the terminal, accepted figure.

### 3 masked sample rows (real)
```
id 7210224a…  tx 3b530662…  final 140,900.00  sc% 0  sc_amt 0
   rate_22k 14301.31  rate_17k_21k 14301.31  margin_24k 14301.31  status null
   (2 ornaments ORN-33810 + ORN-33804 sum to 140,900.00)

id 8703dda4…  tx 78bbc83f…  final 24,081.28  sc% 2  sc_amt 491.45
   rate_22k 11600  rate_17k_21k 10500  margin_24k 14345.52  status null

id ee35d067…  tx 1c652cb3…  final 230,100.57  sc% 1.5  sc_amt 3,267.67
   rate_22k 12510  rate_17k_21k 10500  margin_24k 14340.91  status null
```

---

## 4. `Spectrometer` — purity-tester readings

**Purpose:** Raw output of the XRF spectrometer used to measure karat/purity of a customer's item, plus its sync state to the CRM. Stores the tester image (base64) and the derived ornament JSON. One row per test (customer can have many).
**Row count: 932.** PK `id`.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | no | — | PK (uuid). |
| `customer_id` | text | **no** | — | FK → `Customer.id` (e.g. CUST-04232). |
| `estimation_id` | text | yes | — | FK → `Estimation.id` (when linked to a valuation). |
| `quotation_id` | text | yes | — | FK → `Quotation.id`. |
| `can_subscribe` | bool | **no** | `false` | Whether the client app may subscribe to live tester events. |
| `request_json` | jsonb | yes | — | Payload sent to the tester/service. Keys: `id, karat, purity, gross_weight, ornament_type, spectrometer_image` (image = base64 JPEG). |
| `response_json` | jsonb | yes | — | The derived ornament object: full ornament shape (`purity, purity_value, branch_purity, gold_rate, net_weight, amount, estimation_id, spectrometer_image[]{id,name,thumb}` …). At capture, `gold_rate`/`amount` are 0 (priced later). |
| `sync_status` | `SpectrometerSyncStatus` | **no** | `PENDING` | PENDING → SYNCED → ACKNOWLEDGED (device↔server handshake). |
| `created_at` | timestamp | **no** | `CURRENT_TIMESTAMP` | Reading taken. |
| `updated_at` | timestamp | **no** | — | Last change. |

**`SpectrometerSyncStatus`** = `PENDING, SYNCED, ACKNOWLEDGED`.

Sample (image stripped):
```
id 90779822…  customer CUST-04232  estimation eef04e6b…  sync PENDING  can_subscribe true
  request  { karat 18.041, purity 75.17, gross_weight 0, ornament_type "" }
  response { purity 75.17, purity_value 75.17, branch_purity 75.17, gold_rate 0, amount 0,
             estimation_id eef04e6b…, spectrometer_image:[{name "spectrometer/…jpg"}] }

id 1bdb5e48…  customer CUST-04027  estimation 6d3255b7…  sync SYNCED
  request  { karat 22.021, purity 91.75 }
  response { purity 91.75, branch_purity 91.75, gold_rate 0, … }
```
Note the tester reports **karat** (18.041, 22.021) and **purity%** (75.17, 91.75); purity% ≈ karat/24×100. The `branch_purity` starts equal to tested purity, then may be adjusted down at the branch (the margin lever seen in §MONEY MATH).

---

## 5. `GoldRate` — the per-state rate card

**Purpose:** The company's **buying rate card**, one set of band rates per State, versioned by insert (newest `created_at` per `state_id` is live). This is what the branch/estimation seeds its rates from. GoldApp's Live Rates reads this table directly.
**Row count: 64** (many historical versions across 5 states).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | no | — | PK (uuid). |
| `state_id` | text | yes | — | FK → `State.id`. |
| `rate_24k` | float8 | yes | — | 24K spot-equivalent per-gram (~₹9,621–14,791). |
| `rate_22k` | float8 | yes | — | Buy rate for 22K band (~₹8,813–13,549) — **discounted vs 24k**. |
| `rate_17_21k` | float8 | **no** | — | Buy rate for 17–21K band (0–₹13,275; often flat 10,500). |
| `rate_14_17k` | float8 | **no** | — | Buy rate for 14–17K band — mostly 0 (disabled). |
| `margin_24k` | float8 | **no** | — | Per-gram **spread/margin** for 24K (range −984 … +14,441; usually small: 0/1/100). ⚠ NOT a rate here — differs from Estimation.margin_24k. |
| `margin_22k` | float8 | yes | — | Per-gram spread for 22K (can be negative). |
| `is_offline` | bool | **no** | `false` | Rate captured while the pricing feed was offline. |
| `updated_emp_id` | text | yes | — | FK → `Employee.emp_id` who set it (null in samples — system-set). |
| `created_at` | timestamp | **no** | `CURRENT_TIMESTAMP` | Version timestamp (used to pick the latest). |
| `updated_at` | timestamp | **no** | — | Last change. |

States present: **Karnataka, Telangana, Andhra Pradesh, Kerala** (+ one row with null/blank state). Value ranges: `rate_24k` 9,621–14,791 · `rate_22k` 8,813–13,549 · `rate_17_21k` 0–13,275 · `margin_24k` −984–14,441.

### 3 sample rows (real, latest per state)
```
state Karnataka       rate_24k 13495.11  rate_22k 11600  rate_17_21k 10500  rate_14_17k 0  margin_24k 0     created 2026-06-25
state Telangana       rate_24k 13933.45  rate_22k 12000  rate_17_21k 10500  rate_14_17k 0  margin_24k 1     created 2026-06-23
state Andhra Pradesh  rate_24k 13923.80  rate_22k 12000  rate_17_21k 10500  rate_14_17k 0  margin_24k 0     created 2026-06-23
state Kerala          rate_24k 14734.90  rate_22k 13497.16 rate_17_21k 13275 rate_14_17k 0  margin_24k 0    created 2026-05-06
```

---

## 6. `Agreement` — takeover agreement PDF + locked rates

**Purpose:** For **takeover / pledge-release** deals, the signed agreement that locks the band rates used to settle. One per `Release`. Stores the generated PDF path and a snapshot of the rate bands + service charge.
**Row count: 1,370** (signed=true 1,315 · signed=false 56).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | no | — | PK (uuid). |
| `release_id` | text | **no** | — | FK → `Release.id` (→ `Release.transaction_id → Transaction`). |
| `name` | text | **no** | — | PDF object path (`takeover_agreement/…‑….pdf`). |
| `signed` | bool | **no** | `false` | Customer signed. |
| `margin_24k` | float8 | yes | — | 22K / ≥88% locked per-gram rate (same semantics as Estimation). |
| `rate_22k` | float8 | yes | — | 18–21K locked rate. |
| `rate_17k_21k` | float8 | yes | — | 14–17K locked rate. |
| `rate_14k_17k` | float8 | yes | — | Lowest band (usually 0). |
| `service_charge` | float8 | yes | `3` | Percent (0–3). |
| `created_at` | timestamp | **no** | `CURRENT_TIMESTAMP` | Agreement generated. |
| `updated_at` | timestamp | **no** | — | Last change (e.g. when signed). |

### 3 sample rows (real)
```
id 27b751ac…  signed false  margin_24k 14356.86  rate_22k 11600  rate_17k_21k 10500  rate_14k_17k 0  sc% 0   release a7135864…
id 19909f1a…  signed true   margin_24k 14341.87  rate_22k 13157  rate_17k_21k 11000  rate_14k_17k 0  sc% 3   release e7f03d3a…
id eeb4ecb3…  signed true   margin_24k 14371.00  rate_22k 11600  rate_17k_21k 10500  rate_14k_17k 0  sc% 1   release 36256ce9…
```
The rate columns mirror the Estimation/Quotation band layout (`margin_24k` = the 22K rate). Row 2 of the earlier dump even had all three set equal (14164.85) — a flat-rate takeover.

---

## 7. How GoldApp uses this cluster (repo grep)

All reads are over the NEW-CRM Postgres (`getSql()` / `pg` `client.query`), tables quoted PascalCase.

- **`app/api/gold-rates/route.js`** — the **Live Rates** source of truth. `SELECT DISTINCT ON (gr.state_id) … FROM "GoldRate" gr LEFT JOIN "State" s … ORDER BY gr.state_id, gr.created_at DESC` → latest rate card per state (`rate_22k, rate_24k, rate_17_21k, rate_14_17k, margin_22k, margin_24k`). Cached (`CACHE_TTL_MS`). Consumed by `components/purchases/LiveRates.js`, `components/sales/LiveMarketRates.js`, `components/admin/GoldBuyingRate.js`, `components/ui/LiveTicker.js`, `hooks/useAamlinRate.js`, `app/api/fetch-gold-rates`, `gold-rates-standalone/`.

- **`app/api/sync-new-crm/route.js`** (+ `scripts/sync-new-crm.mjs`) — the **purchase sync**. Aggregates **approved** `Ornament` rows (`approve = true`) joined via **both** `Quotation.quotation_id` and `Estimation.estimation_id`, **dedupes by `(transaction_id, ornament_id)` keeping the latest** (the documented duplicate-ornament footgun — a leftover `approve=false` row would double the weight). Sums `gross/stone/wastage/net_weight`, computes net-weighted average `purity`, sums `amount`. Pulls the latest `Quotation`'s `service_charge, service_charge_amount, final_amount` as the deal value. This feeds Supabase `purchases`.

- **`app/api/crm-purchases/route.js`** — live CRM purchase views (pipeline/pending bands). Same approved-ornament + dedup pattern via `Quotation`/`Estimation`; reads `Quotation.final_amount` (latest by `updated_at`) as `done_val`; cross-checks ornament net weight against `Release`/`Order`/`PledgeCompany`.

- **`app/api/productivity/route.js`** — **stage-timing / TAT** analytics reconstructed from timestamps (Timer table is dead — see memory). Reads `Estimation` (`min(created_at)`, `max(updated_at)`, `negotiation_approved_id`, `service_charge_approved_id`), `Quotation` (`created_at/updated_at`, `quotation_approved_id`), `Ornament` (count + `with_stone`/`stone_weight` flag), and `Agreement` (via `Release`, `bool_or(signed)`). Stages: 1 Valuation · 2 Estimation+negotiation · 3 Quotation prep · 4 Quotation approval …

- **`scripts/gen-crm-case-timeline.mjs`**, **`scripts/check-rates-freshness.mjs`** — ops tooling: per-case timeline and a check that `GoldRate.created_at` is fresh.

**Not yet surfaced in GoldApp:** `Spectrometer` (no repo reads — purity images/JSON stay CRM-side), and the `delta`/`branch_purity` override mechanics aren't independently recomputed by GoldApp (it trusts `Ornament.amount` / `Quotation.final_amount`).

---

## 8. Gotchas & margin-analysis cautions

1. **Band labels are shifted one level down** on Estimation/Quotation/Agreement: the **22K payout rate lives in `margin_24k`**, not `rate_22k`. `rate_22k` prices 18–21K, `rate_17k_21k` prices 14–17K, `rate_14k_17k` ≈ 0. (Formula 3.)
2. **`margin_24k` means two different things**: a full per-gram rate on Estimation/Quotation/Agreement, but a small per-gram spread on `GoldRate`. Don't join/compare them naively.
3. **Payment purity = `branch_purity`, not `purity`.** The tested purity (`purity`/`purity_value`) is usually higher than the paid `branch_purity` — that gap is a deliberate margin lever and the money math depends on `branch_purity`.
4. **`delta`** is a per-gram manual rate override baked into `amount`; ignore it and ~8% of amounts won't reconcile.
5. **`base_rate` is 100% null** and `gold_rate_approval` is 100% null — dormant columns; don't build on them.
6. **Ornaments live under estimation OR quotation**, and the same physical item is often duplicated across both plus a stale `approve=false` copy — **always filter `approve = true` and dedupe by `ornament_id`** (as the sync does) before summing weights or amounts.
7. **`final_amount` = Σamount × (1 − service_charge/100)** holds exactly unless an ornament amount was hand-edited after the quote was cached.
```
