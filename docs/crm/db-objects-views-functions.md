# NEW CRM — database objects beyond the 69 base tables

> Found during a coverage self-audit: the original schema pull filtered to `BASE TABLE`, so it skipped the database's **view**, **functions**, and **sequences**. This doc closes that gap. (Base tables + enums are 100% covered in the cluster docs; overall column coverage is 96% — the remaining misses are enumerated at the bottom and are all unused/NULL.)

## 1. Views

### `latest_gold_transaction_report` — the CRM's built-in per-transaction purchase report (10,126 rows)

A **read-only reporting view**, one row per Transaction, that materialises the deal's final figures by joining the **latest Quotation per transaction** with its **approved Ornaments**. This is effectively the CRM's own purchase-register / deal-summary and is the most report-ready object in the database — directly useful for margin & purchase analytics.

**How it's built (from the view definition):**
- `latest_quotations` CTE: `row_number() OVER (PARTITION BY transaction_id ORDER BY updated_at DESC)` on `Quotation`, keeping `rn = 1` → the current quotation per transaction. (Note it aliases `q.rate_22k AS margin_22k` — consistent with the rate-band shift documented in the master doc.)
- `approved_ornaments` CTE: aggregates `Ornament` (gross/net/stone/wastage weights, purity) — approved items only.
- Joined back to `Transaction` → `Customer` / `Branch` for names.

**Columns:**

| Column | Type | Meaning |
|---|---|---|
| `Transaction ID` | text | `Transaction.id` (UUID) |
| `Customer ID` | text | `CUST-#####` |
| `IST Date` / `IST Time` | text | deal timestamp, IST |
| `Customer Name` | text | KYC/walk-in name |
| `Branch Name` | text | branch |
| `Gold Source` | enum | `PHYSICAL_GOLD` \| `RELEASED_GOLD` (= `TransactionType`) |
| `Total Gross Weight` | float | Σ ornament gross |
| `Total Net Weight` | float | Σ ornament net (gross − stone − wastage) |
| `Total Stone Weight` | float | Σ stone |
| `Total Wastage` | float | Σ wastage |
| `Ornament Count` | bigint | # approved ornaments |
| `Weighted Avg Purity` | numeric | net-weighted mean purity |
| `Service Charge` | float | service charge **%** |
| `Service Charge Amount` | float | ₹ deducted |
| `Gross Amount` | float | payout **before** service charge (Σ ornament amounts) |
| `Final Amount` | float | **customer payout** (Gross − Service Charge Amount) |
| `Rate` | numeric | blended ₹/g applied |
| `ist_sort_date` | date | sort key (IST calendar day) |

**Sample row (PII masked) — and it confirms the money-math:**
```
Gold Source PHYSICAL_GOLD · Gross 34.40 g · Net 34.00 g · Wastage 0.40 g · Purity 91.17%
Rate 13,088.91 · Gross Amount ₹445,022.87 · Service Charge 1.12% → ₹4,984.26 · Final Amount ₹440,038.61
```
Check: `445,022.87 × (1 − 1.12/100) = 440,038.6` ✓ — matches the `final_amount = Σamount × (1 − service_charge/100)` formula from the Valuation cluster.

**⚠ For analytics:** this view already gives you a clean per-deal fact table (weights, purity, rate, gross, service charge, final). It's `PHYSICAL_GOLD`-oriented (built off Quotation/Ornament); **takeovers (`RELEASED_GOLD`) are valued in `PledgeCompany`**, not here — so a complete purchase report unions this view with the release valuation. Also note it keys on the *latest* quotation, and carries **no payment/settlement** columns — join to `Payment` (final-payment day) for the paid figure.

## 2. Functions (ID minting)

The CRM mints its human-readable IDs via Postgres functions backed by sequences (so IDs are gap-tolerant and concurrency-safe):

| Function | Produces | Logic |
|---|---|---|
| `generate_transaction_id(prefix)` | Transaction code | `prefix || nextval('transaction_id_seq')` |
| `generate_customer_id(prefix, padding)` | `CUST-#####` | `prefix || lpad(nextval('customer_id_seq'), padding, '0')` |
| `generate_ornament_id(prefix, padding)` / `(prefix, start, increment)` | ornament code | sequence-based, padded |
| `generate_transport_id()` | transport/consignment code | sequence-based |
| `generate_custom_id(prefix, start_value, padding_length)` | generic | parameterised sequence id |

Backing **sequences (3):** `transaction_id_seq`, `customer_id_seq`, `ornament_id_seq`.

> Note: `Transaction.code` in the data is `WGKA-#####` (with the hyphen that distinguishes NEW-CRM from OLD-CRM); the raw `generate_transaction_id` only concatenates prefix+sequence, so the branch/hyphen formatting is applied by the app layer around this function.

## 3. Remaining column-coverage gaps (all benign)

96% of columns (869/901) are named in the docs. The un-named 4% are all on **unused or empty** columns:

- **`Batch` (unused, 0 rows — dead bidding module, GoldApp does bidding itself).** For completeness its full column set: `id, name, state, created_date, created_at, updated_at, purchase_id, bid_id, purchase_date, market_rate, market_weight, market_purity, market_date, market_weight_image, market_purity_image, market_updated_emp_id, net_market_weight, bidder_market_weight, bidder_market_purity, bidder_sale_date, bidder_sale_updated_emp_id, bidder_slip, gross_sale_amount, before_melting_weight, before_melting_purity, before_melting_date, before_melting_image, before_melting_updated_emp_id, after_melting_weight, after_melting_purity, after_melting_date, after_melting_image, after_melting_purity_image, after_melting_updated_emp_id` — a batch's journey `BEFORE_MELTING → AFTER_MELTING → MARKET → BIDDER_SALE → SOLD` (the `BatchState` enum), all unpopulated.
- **`Settings`** — the threshold **ceilings** `gold_rate_7058_max`, `gold_rate_8790_max`, `gold_rate_9987_max`, `service_charge_max`, `wastage_max` (and their `_min` twins). **All `Settings` threshold columns are NULL** in prod (only `edit_goldrates` is meaningful), per cluster-1.
- **`AuditTrails` (0 rows, empty)** and the `_BranchToUserRole` / `_StateToUserRole` join tables' `A`/`B` columns — trivial/empty.

Nothing functional is missing.
