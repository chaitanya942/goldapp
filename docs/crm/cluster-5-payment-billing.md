# NEW CRM — Cluster 5: Payment & Billing

**Scope:** `Payment`, `BankAccount`, `Invoice`, `TaxInvoice`, `Order`, `QRCode`, `EWayBill`
**DB:** `dbwhitegold_production` (AWS RDS Postgres, ap-south-1), schema `public`, PascalCase quoted identifiers.
**Access used:** read-only (`SELECT` only). Snapshot date: 2026-08-06.
**Cluster role:** this is **where money leaves the company** (`Payment` = actual disbursements to customers/NBFCs) and **where bills are generated** (`Invoice`, `TaxInvoice`, `QRCode`) and goods move out (`Order`, `EWayBill`). Everything hangs off `Transaction` (the case), which is the GoldApp "bill".

All timestamps are `timestamp without time zone` storing **UTC** wall-clock (the values come back with a `Z`; GoldApp converts to `Asia/Kolkata` for the "purchase day"). IST = UTC + 5:30, so an early-morning UTC time (e.g. `01:40Z`) is `07:10` IST **the same calendar day**.

---

## 0. The one-paragraph mental model

A customer walks in → gold is estimated/quoted → a **penny-drop** (₹1) verifies their bank account → the **final payment** (the gold's value) is **DEBITED** from White Gold to the customer → an **Invoice** (purchase receipt) + **TaxInvoice** (GST invoice on WG's *service fee*) + a **QRCode** (UPI collect QR for that service fee) are generated in the same instant → an **Order** row records the physical gold weights for melting/dispatch → for inter-branch transport an **EWayBill** is raised. **Takeover** cases (gold pledged at an NBFC) instead pay the NBFC via **RELEASE_PAYMENT**; if the released loan exceeded the gold value the shortfall is booked as a negative **FINAL_PAYMENT / CREDITED** ("release loss"). GoldApp keys a purchase to the **FINAL_PAYMENT DEBITED `created_at` day** and computes PAID = `FINAL_PAYMENT.DEBITED + RELEASE_PAYMENT.DEBITED − FINAL_PAYMENT.CREDITED`.

---

## 1. `Payment` — the money-out ledger  ⭐ (the important one)

### Purpose
Every actual or attempted movement of money tied to a `Transaction`: the ₹1 penny-drop verification, the real final disbursement to the customer, the NBFC release payment for takeovers, and reversals/loss adjustments. One `Transaction` has **many** `Payment` rows.

### Row count: **21,337** (10,030 distinct `transaction_id`)

### Columns
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text (uuid) | NO | — | PK |
| `pay_id` | text | YES | — | Razorpay payout id (`pout_…`). NULL for OFFLINE payments and reversals/release entries. |
| `customer_id` | text | YES | — | Razorpay contact id (`cont_…`), **not** an FK to `Customer`. |
| `fund_id` | text | YES | — | Razorpay fund-account id (`fa_…`) = the tokenised payout bank account. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | When the payment row was created = **when the money moved**. For `FINAL_PAYMENT`/`DEBITED` this is the load-bearing **"final-payment day"** GoldApp keys purchases on. |
| `updated_at` | timestamp | NO | — | Last status change (e.g. `processing`→`processed`). |
| `amount` | double precision | NO | — | Rupees. Penny-drop = `1`. Finals/releases positive. **Reversals stored mostly negative** (see §sign convention). |
| `status` | enum `PaymentStatus` | NO | `'PENDING'` | Lifecycle state — see below. |
| `provider_status` | text | YES | — | Raw Razorpay status: `processed` (19,049), NULL (1,671), `processing` (489), `reversed` (92), `failed` (34), `queued` (3). |
| `type` | enum `PaymentType` | NO | — | `PENNY_DROP` / `FINAL_PAYMENT` / `RELEASE_PAYMENT`. |
| `transaction_id` | text | NO | — | **FK → `Transaction.id`**. The case this money belongs to. |
| `verify_id` | text | YES | — | Penny-drop verification reference (mostly NULL). |
| `employee_id` | text | YES | — | **FK → `Employee.emp_id`** — who executed the payout. |
| `account_holder_name` | text | YES | — | Payee name (PII). |
| `account_number` | text | YES | — | Payee account (PII). On penny-drop rows this is the account being verified. |
| `ifsc_code` | text | YES | — | Payee IFSC (PII). |
| `bank_name` | text | YES | — | Payee bank. |
| `action` | enum `PaymentAction` | NO | `'DEBITED'` | `DEBITED` = money **out** of WG; `CREDITED` = money **back to** WG (reversal / loss). |
| `utr` | text | YES | — | Bank UTR of the disbursement. Populated on RAZORPAY finals/penny-drops; NULL for OFFLINE and CREDITED rows. This is what GoldApp matches against RazorpayX payouts. |
| `virtual_number` | text | YES | — | Razorpay virtual account/number (mostly NULL). |
| `processor` | enum `PaymentProvider` | NO | `'RAZORPAY'` | `RAZORPAY` (19,424) or `OFFLINE` (1,914, manual bank transfer). |
| `remarks` | text | YES | — | Free text (e.g. `"Paid"` on OFFLINE releases). |
| `bank_account_id` | text | YES | — | **FK → `BankAccount.id`** — the verified payout account used. |
| `sales_emp_id` | text | YES | — | **FK → `Employee.emp_id`** — sales attribution (mostly NULL). |
| `sales_remark` | text | YES | — | Free text (mostly NULL). |

### Enums (definitions from `pg_enum`)
- **`PaymentType`**: `PENNY_DROP`, `FINAL_PAYMENT`, `RELEASE_PAYMENT`
- **`PaymentAction`**: `DEBITED`, `CREDITED`
- **`PaymentProvider`**: `RAZORPAY`, `OFFLINE`
- **`PaymentStatus`**: `PENDING`, `COMPLETED`, `FAILED`, `OTP_FAILED`, `OTP_PENDING`, `CONFIRMATION_PENDING`, `CONFIRMED`, `DROP_INVALIDATED`, `DROP_SKIPPED`

### ⭐ Every `type` × `action` combination (real counts + real totals)
| type | action | rows | Σ amount (₹) | meaning |
|---|---|---:|---:|---|
| `PENNY_DROP` | `DEBITED` | 10,398 | 10,398.00 | ₹1 account-verification transfers (₹1 each → total = row count). |
| `FINAL_PAYMENT` | `DEBITED` | 9,713 | 2,522,114,121.88 | Real money paid **to the customer** for their gold. **This is "PAID".** |
| `RELEASE_PAYMENT` | `DEBITED` | 1,203 | 600,748,818.49 | Takeover: money paid to the **NBFC/pledge company** to release pledged gold. |
| `FINAL_PAYMENT` | `CREDITED` | 24 | −7,466,358.95 | Reversal / release-loss adjustment (money coming **back to** WG). |

There are **no** `PENNY_DROP/CREDITED`, `RELEASE_PAYMENT/CREDITED`, or negative `FINAL_PAYMENT/DEBITED` rows (verified: 0). CREDITED exists only on `FINAL_PAYMENT`.

### `status` counts + meaning
| status | rows | meaning |
|---|---:|---|
| `COMPLETED` | 12,895 | Money moved successfully (all real finals/releases + successful penny-drops). |
| `DROP_SKIPPED` | 7,635 | Penny-drop deliberately skipped (all are `PENNY_DROP`). |
| `FAILED` | 617 | Payout/verification failed (591 penny-drops, 26 finals). |
| `OTP_PENDING` | 167 | Awaiting OTP (all penny-drops). |
| `CONFIRMED` | 23 | **Reversal/loss confirmed** — the state CREDITED reversals settle in (also `RELEASED_GOLD`/takeover finals per MEMORY). |
| `CONFIRMATION_PENDING` | 1 | Reversal awaiting confirmation. |

`type × status` cross-tab: `FINAL_PAYMENT` is `COMPLETED` 9,687 / `FAILED` 26 / `CONFIRMED` 23 / `CONFIRMATION_PENDING` 1. `RELEASE_PAYMENT` is `COMPLETED` 1,203 (always). `PENNY_DROP` is `DROP_SKIPPED` 7,635 / `COMPLETED` 2,005 / `FAILED` 591 / `OTP_PENDING` 167. (Enum values `PENDING`, `OTP_FAILED`, `DROP_INVALIDATED` are **defined but unused** in current data.)

`processor` by type: `FINAL_PAYMENT` → RAZORPAY 8,952 / OFFLINE 786; `RELEASE_PAYMENT` → OFFLINE 1,130 / RAZORPAY 75 (releases are mostly manual bank transfers to NBFCs, hence usually no UTR).

### Keys / FKs
- **PK:** `id`.
- **FK out:** `transaction_id → Transaction.id`, `employee_id → Employee.emp_id`, `sales_emp_id → Employee.emp_id`, `bank_account_id → BankAccount.id`.
- **FK in:** `File.payment_id → Payment.id` (payout proof/screenshot files).

### Payment lifecycle / state machine
```
PENNY_DROP (₹1):  created → OTP_PENDING → COMPLETED | FAILED | DROP_SKIPPED
FINAL_PAYMENT:    created → (RazorpayX processing) → COMPLETED        [normal purchase]
                                             ↘ FAILED
                  COMPLETED → [over/wrong pay] → CREDITED reversal (status CONFIRMED)
RELEASE_PAYMENT:  created → COMPLETED  (takeover; paid to NBFC, usually OFFLINE)
                  ↘ if released loan > gold value → FINAL_PAYMENT/CREDITED "release loss"
```

### Sign convention for CREDITED reversals (load-bearing subtlety)
`FINAL_PAYMENT/CREDITED` amounts are stored with **mixed sign**: 21 of 24 are **negative** (min −4,794,266.56), 3 are **positive** (203.90 … 295,411.75). GoldApp's PAID formula is `fin + rel − rev` (see §9), so:
- positive-stored reversal (₹203.90) → correctly **subtracted** from paid.
- negative-stored reversal (−7,831.42) → `− (−7,831.42)` = **added** to paid.

This means the "− CREDITED reversals" wording in the code is only literally a subtraction of the *stored signed value*; for the majority (negative-stored) rows it increases the computed net-out by the loss magnitude. Documented here because §8's release-loss example lands exactly on this case.

### Masked sample rows (type/action/amount/status/processor/dates REAL)
```
1) FINAL_PAYMENT / DEBITED / COMPLETED — normal purchase payout
   id=b0133d48… pay_id=pout_TMOf5uGkB2LaGK  amount=337432.82  processor=RAZORPAY
   utr="UTRxxxx"  account_holder_name="Name"  account_number="xxxxxx4270"  ifsc="XXXX0######"
   employee_id=WG00949  transaction_id=39bd93d7-511a-44e0-8aca-fa16c6c9a8bb
   created_at=2026-08-06T01:40:45Z  updated_at=2026-08-06T01:41:00Z   ← final-payment day = 2026-08-06 IST

2) PENNY_DROP / DEBITED / COMPLETED — ₹1 account verification
   id=37968a52… pay_id=pout_SZPsooxnGfdO5E  amount=1  processor=RAZORPAY
   utr="UTRxxxx"  account_number="xxxxxx4270"  ifsc="XXXX0######"
   transaction_id=5a0fdfc9…  created_at=2026-04-04T07:01:21Z

3) FINAL_PAYMENT / CREDITED / CONFIRMED — release-loss reversal (negative)
   id=5169889c…  amount=-7831.42  processor=RAZORPAY  utr=NULL  pay_id=NULL
   transaction_id=2032d7b3-78dc-4abd-9ed3-07395ccd407c  created_at=2026-08-03T03:16:11Z
```

---

## 2. `BankAccount` — customer/NBFC payout accounts

### Purpose
The penny-drop-verified bank account that a payout goes to. Belongs to a `Customer`, a `PledgeCompany` (NBFC, for takeovers), and/or a `Transaction`.

### Row count: **13,955**

### Columns
| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text | NO | PK. Referenced by `Payment.bank_account_id`, `File.bankAccountId`, `File.payoutbankAccountId`. |
| `created_at` / `updated_at` | timestamp | NO | Row create / update. |
| `bank_name` | text | YES | e.g. "State Bank of India [SBI]", "ICICI Bank". |
| `account_holder_name` | text | YES | PII. |
| `account_number` | text | YES | PII. |
| `ifsc_code` | text | YES | PII. |
| `account_type` | enum `AccountType` | NO | `CUSTOMER` (13,446) or `NBFC` (510). |
| `virtual_number` | text | YES | Razorpay VPA/virtual number (mostly NULL). |
| `remark` | text | YES | Free text. |
| `customer_id` | text | YES | **FK → `Customer.id`**. |
| `pledge_company_id` | text | YES | **FK → `PledgeCompany.id`** (set for NBFC accounts / takeovers). |
| `transactionId` | text | YES | **FK → `Transaction.id`** (note camelCase column). |

- **PK:** `id`. **FK out:** `customer_id`, `pledge_company_id`, `transactionId`. **FK in:** `Payment.bank_account_id`, `File.bankAccountId`, `File.payoutbankAccountId`.

### Masked samples
```
1) id=5bff7b1d…  bank="Union Bank of India"  type=CUSTOMER  pledge_company_id=ea3e7cf8…  txn=NULL   created=2026-08-06T01:41:22Z
2) id=f44fc58f…  bank="State Bank of India [SBI]"  type=CUSTOMER  txn=3b530662…  created=2026-08-06T01:38:32Z
3) id=58fe8a3c…  bank="ICICI Bank"  type=CUSTOMER  txn=9c4e4500…  created=2026-08-06T01:36:41Z
   (account_number="xxxxxx####", ifsc="XXXX0######", account_holder_name="Name" masked)
```

---

## 3. `Invoice` — customer purchase invoice (receipt)

### Purpose
The purchase receipt PDF given to the customer for the gold sale. One per `Transaction`, generated at final-payment time.

### Row count: **9,632** (range 2025-06-19 → 2026-08-06, tracks `Payment` finals)

### Columns
| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text | NO | PK. |
| `created_at` / `updated_at` | timestamp | NO | **`created_at` ≈ the invoice date / purchase moment** (same instant as the `FINAL_PAYMENT` row). |
| `pdf_generated` | boolean | YES | PDF rendered? (true in samples). |
| `sms_sent` | boolean | YES | Receipt SMS delivered? (false in samples). |
| `file_name` | text | YES | S3 key `invoice/<uuid>-<transaction_id>.pdf`. |
| `transaction_id` | text | NO | **FK → `Transaction.id`**. |

- **PK:** `id`. **FK out:** `transaction_id → Transaction.id`.

### Samples
```
id=942e78aa…  pdf_generated=true sms_sent=false  file=invoice/…-39bd93d7….pdf  txn=39bd93d7…  created=2026-08-06T01:40:58Z
id=178d5f6c…  pdf_generated=true sms_sent=false  txn=631abd4f…  created=2026-08-06T01:34:43Z
```

---

## 4. `TaxInvoice` — GST tax invoice on WG's service fee

### Purpose
White Gold's **GST tax invoice** for the *service charge* it levies on the customer (not for the gold value itself). Carries the statutory invoice number, branch code, and monthly running counter.

### Row count: **7,362**

### Columns
| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text | NO | PK. |
| `file_name` | text | YES | S3 key `tax_invoice/<uuid>-<transaction_id>.pdf`. |
| `created_at` / `updated_at` | timestamp | NO | Invoice generation time. |
| `pdf_generated` | boolean | YES | PDF rendered? |
| `sms_sent` | boolean | YES | SMS delivered? |
| `transaction_id` | text | NO | **FK → `Transaction.id`**. |
| `branch` | text | YES | Branch code, e.g. `KA-HAS`, `KA-MYS`, `KL-EDA`, `AP-VIJ` (`<STATE>-<BRANCH>`). |
| `count` | integer | YES | Per-branch, per-month running serial (the `NNNN` in `number`). |
| `month_year` | text | YES | `MMYY`, e.g. `0826` = Aug 2026. |
| `number` | text | YES | Statutory invoice no. `<branch>-<MMYY>-<NNNN>`, e.g. `KA-HAS-0826-0013`. Resets monthly per branch. |

- **PK:** `id`. **FK out:** `transaction_id → Transaction.id`.

### Samples
```
number=KA-HAS-0826-0013  branch=KA-HAS  month_year=0826  count=13  txn=39bd93d7…  created=2026-08-06T01:40:58Z
number=KA-MAL-0826-0011  branch=KA-MAL  month_year=0826  count=11  txn=631abd4f…  created=2026-08-06T01:34:43Z
```

---

## 5. `Order` — physical gold order (weights, for melting/dispatch)

### Purpose
The physical-gold line for a purchase: the **branch-declared weights/purity** that feed melting and accounts reconciliation. One per `Transaction`.

### Row count: **8,725**

### Columns
| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text | NO | PK. Referenced by `GoldCollection.orderId`, `Melting.order_id`. |
| `created_at` / `updated_at` | timestamp | NO | Order create/update. |
| `transaction_id` | text | NO | **FK → `Transaction.id`**. |
| `branch_gross_weight` | double | YES | Gross weight declared at branch (g). |
| `branch_net_weight` | double | YES | Net weight (g). |
| `branch_stone_weight` | double | YES | Stone weight (g). |
| `branch_wastage` | double | YES | Wastage (g). |
| `billing_purity` | double | YES | Purity % used for billing (e.g. 91.8, 99.8). |
| `emp_id` | text | YES | **FK → `Employee.emp_id`**. |
| `accounts_order_status` | enum `OrderStatus` | YES | `PENDING` (8,723) / `RECEIVED` (2) — HO accounts has physically received the gold. |
| `gpm_order_status` | enum `OrderStatus` | YES | `PENDING` (8,723) / `RECEIVED` (2) — GPM (gold-processing/melting) received it. |

- **`OrderStatus`** enum: `PENDING`, `RECEIVED`. Both status columns are essentially all `PENDING` (only 2 `RECEIVED`) → the receive-tracking workflow is barely used in prod.
- **PK:** `id`. **FK out:** `transaction_id`, `emp_id`. **FK in:** `GoldCollection.orderId`, `Melting.order_id`.

### Samples
```
txn=39bd93d7…  gross=29.92 net=25.92 stone=3.6 wastage=0.4 purity=91.8  acct=PENDING gpm=PENDING  created=2026-08-06T01:40:56Z
txn=631abd4f…  gross=2 net=2 stone=0 wastage=0 purity=99.8              acct=PENDING gpm=PENDING  created=2026-08-06T01:34:41Z
```

---

## 6. `QRCode` — UPI collect QR for the service fee

### Purpose
A short-lived QR / short-code URL that lets the customer **pay WG's service fee (+ GST) by UPI**. The `payload` jsonb carries the full invoice/UPI collect detail; links to a `TaxInvoice.number`.

### Row count: **7,314**

### Columns
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK. |
| `url` | text | NO | — | Public short URL `https://crm.whitegold.money/qr/<short_code>`. |
| `short_code` | text | NO | — | The slug in the URL. |
| `payload` | jsonb | NO | — | Invoice+UPI collect data (see below). |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Generated at. |
| `updated_at` | timestamp | NO | — | Updated at. |
| `expiry` | timestamp | NO | — | Valid until (**created_at + ~90 days** in samples). |
| `click_count` | integer | NO | `0` | Scan/click counter. |

- **PK:** `id`. No FK constraints (linked to a case via `payload.transaction_id`/`payload.invoice_number`).
- **`payload` keys:** `cgst`, `sgst`, `service_fee`, `total_amount` (= service_fee + cgst + sgst), `gstin` (WG's `29AAPCA3170M1Z5`), `company_name` (`WHITE GOLD BULLION PVT LTD`), `payee_ifsc`/`payee_bank_account`/`payee_upi_id` (WG HDFC collection account), `invoice_number` (→ `TaxInvoice.number`), `invoice_date`, `transaction_id`.

### Samples (WG's own bank/UPI kept real; these are the *payee* = White Gold, not customer PII)
```
url=https://crm.whitegold.money/qr/231_K1cYKtNYdkPPDgJHM  clicks=0  created=2026-08-06T01:40:58Z  expiry=2026-11-04
  payload: service_fee=2888.48 cgst=259.96 sgst=259.96 total=3408.41  invoice=KA-HAS-0826-0013  txn=39bd93d7…
url=https://crm.whitegold.money/qr/5XC8DoydplFHwpKh6nR7L  created=2026-08-06T01:40:24Z
  payload: service_fee=16207.73 cgst=1458.7 sgst=1458.7 total=19125.12  invoice=KA-JAL-0826-0014  txn=8a170010…
```

---

## 7. `EWayBill` — GST e-way bill for inter-branch gold transport

### Purpose
The government e-way bill raised when gold is moved (branch → HO/GPM). Only 362 rows — used for larger consignments, not every purchase.

### Row count: **362**

### Columns
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | `generate_transport_id()` | PK (a generated transport id). Referenced by `Transaction.eway_bill_id`. |
| `bill_no` | text | YES | — | The 12-digit government E-Way Bill number. |
| `generated_at` | timestamp | YES | — | When the EWB was generated on the GST portal. |
| `bill_validity` | timestamp | YES | — | EWB validity expiry. |
| `status` | text | YES | — | `GENERATED` (354), NULL (6), `CANCELLED` (2). Plain text, **not** an enum. |
| `branch` | text | YES | — | Origin branch (free text, uppercase, e.g. `MYSURU`, `KODIGEHALLI`). |
| `created_at` / `updated_at` | timestamp | NO | — | Row create/update. |
| `trans_id` | text | YES | — | GST transaction/consignment id: `<GSTIN>_<id>_CHL_<year>`. |

- **PK:** `id`. **FK in:** `Transaction.eway_bill_id → EWayBill.id` (794 transactions carry an `eway_bill_id`; note that's more than the 362 EWayBill rows, i.e. many transactions share/reference the same consignment bill).

### Samples
```
id=17042612171  bill_no=182403742021  status=GENERATED  branch=MYSURU       generated=2026-04-17T12:17Z  validity=2026-04-18T18:29Z  trans_id=29AAPCA3170M1Z5_17042612171_CHL_2026
id=15042608552  bill_no=182401498267  status=GENERATED  branch=KODIGEHALLI  generated=2026-04-15T08:55Z
```

---

## 8. THE MONEY-OUT MATH (reconstructed from real rows)

**PAID (net cash out for a case) = Σ FINAL_PAYMENT.DEBITED + Σ RELEASE_PAYMENT.DEBITED − Σ FINAL_PAYMENT.CREDITED.**
Penny-drops (₹1) are *not* part of paid — they're verification only.

### (a) Normal purchase — penny-drop + final payment
`transaction_id = 788bb8c8-3bd1-41f7-9b7f-f5b0ea7ddf7d`
```
RELEASE_PAYMENT DEBITED  235000.00   2025-06-19 02:56Z   (takeover: paid the NBFC to release gold)
PENNY_DROP      DEBITED       1.00   2025-06-19 05:56Z   utr=UTRxxxx  (₹1 verify customer account)
FINAL_PAYMENT   DEBITED  158018.80   2025-06-19 05:58Z   utr=UTRxxxx  (real payout to customer)
→ PAID = 158018.80 (fin) + 235000.00 (rel) − 0 (rev) = 393,018.80 ; penny ₹1 excluded.
```
*(This case is both a takeover **and** a customer payout: WG paid ₹235k to the NBFC to release the pledged gold, then ₹158,018.80 to the customer for the residual value.)*

**PENNY_DROP explained:** exactly ₹1 (10,398 rows sum to ₹10,398). It is a Razorpay penny-drop that both confirms the account number/IFSC are valid and returns the beneficiary name for matching, before the large final payout is released. Many are `DROP_SKIPPED` (7,635) when the account was already verified or verification was bypassed.

### (b) Release-loss scenario — negative CREDITED final  ⭐
`transaction_id = 2032d7b3-78dc-4abd-9ed3-07395ccd407c`
```
RELEASE_PAYMENT DEBITED   175985.00   2026-08-03 01:23Z   (WG pays NBFC to release pledged gold)
FINAL_PAYMENT   CREDITED   -7831.42   2026-08-03 03:16Z   status=CONFIRMED  (release LOSS)
→ The released loan (₹175,985) exceeded the gold's assessed value by ₹7,831.42.
  There is NO positive FINAL_PAYMENT to the customer — the settlement was negative,
  booked as a CREDITED (money owed back to WG / loss absorbed).
```
Second example `688e0cbf…`: RELEASE_PAYMENT 1,003,000 + FINAL_PAYMENT/CREDITED −46,993.80 (release loss of ₹46,993.80).

**Note on the formula's sign handling:** GoldApp computes `paid = fin + rel − rev`. Here `rev` = the *stored* CREDITED sum = −7,831.42, so `fin + rel − rev` = `0 + 175985 − (−7831.42)` = **183,816.42**. Because 21 of 24 CREDITED rows are stored **negative**, the "− reversal" step *adds* the loss magnitude to the computed net-out for those rows (only the 3 positive-stored reversals, e.g. ₹203.90 on txn `4d07d207…`, get truly subtracted). Aggregate CREDITED = −₹7,466,358.95 across 24 rows. Flagged because §9's PAID number inherits this.

### (c) How Invoice / TaxInvoice / QRCode amounts relate to what was paid
- **`FINAL_PAYMENT.amount`** = the gold value paid to the customer; it derives from the latest **`Quotation.final_amount`** (Estimation → Quotation chain in Cluster "Estimation/Quotation").
- **`Invoice`** = the customer's purchase receipt for that gold sale (no amount column here; the PDF renders the quotation/payment figures).
- **`TaxInvoice` + `QRCode.payload`** are about WG's **service fee**, a *separate* charge: `total = service_fee + cgst + sgst` (e.g. 2,888.48 + 259.96 + 259.96 = 3,408.41). GST = 18% split 9% CGST + 9% SGST. The QR is a UPI *collect* so the customer pays that fee **to** WG's HDFC account — opposite direction to the FINAL_PAYMENT.

---

## 9. How GoldApp uses these tables (exact repo logic)

### `app/api/billed-vs-paid/route.js` — the PAID rollup (function `newCrmPayments`)
Connects directly to the NEW CRM Postgres and runs (verbatim core):
```sql
WITH pays AS (
  SELECT transaction_id,
    SUM(CASE WHEN type='PENNY_DROP'      AND action='DEBITED'  THEN amount ELSE 0 END) penny,
    SUM(CASE WHEN type='FINAL_PAYMENT'   AND action='DEBITED'  THEN amount ELSE 0 END) fin,
    SUM(CASE WHEN type='RELEASE_PAYMENT' AND action='DEBITED'  THEN amount ELSE 0 END) rel,
    SUM(CASE WHEN type='FINAL_PAYMENT'   AND action='CREDITED' THEN amount ELSE 0 END) rev,
    array_remove(array_agg(DISTINCT CASE WHEN action='DEBITED'
        AND type IN ('FINAL_PAYMENT','RELEASE_PAYMENT') THEN utr END), NULL) utrs,
    string_agg(DISTINCT processor::text, ',') processors
  FROM "Payment" GROUP BY transaction_id
),
fa AS (  -- final payout account (most recent FINAL_PAYMENT DEBITED)
  SELECT DISTINCT ON (transaction_id) transaction_id, account_number, ifsc_code, account_holder_name, bank_name
  FROM "Payment" WHERE type='FINAL_PAYMENT' AND action='DEBITED'
  ORDER BY transaction_id, created_at DESC
),
pa AS (  -- penny-drop verified account
  SELECT DISTINCT ON (transaction_id) transaction_id, account_number, ifsc_code
  FROM "Payment" WHERE type='PENNY_DROP' AND account_number IS NOT NULL AND account_number <> ''
  ORDER BY transaction_id, created_at DESC
),
fp AS (  -- THE FINAL-PAYMENT DATE (IST)
  SELECT DISTINCT ON (transaction_id) transaction_id,
         (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date d
  FROM "Payment" WHERE type='FINAL_PAYMENT' AND action='DEBITED'
  ORDER BY transaction_id, created_at DESC
)
SELECT t.code, p.penny, p.fin, p.rel, p.rev,
       (p.fin + p.rel - p.rev) AS paid_crm,        -- ← PAID
       p.utrs, p.processors, fa.*, pa.*, fp.d AS pay_date
FROM "Transaction" t
JOIN pays p ON p.transaction_id = t.id
JOIN fp    ON fp.transaction_id = t.id
LEFT JOIN fa ON fa.transaction_id = t.id
LEFT JOIN pa ON pa.transaction_id = t.id
WHERE fp.d BETWEEN $1 AND $2;                       -- window on final-payment day (IST)
```
Then in JS: `paidCrm = fin + rel − rev`; **account-match** = did the FINAL_PAYMENT payout account (`fa`) equal the penny-drop-verified account (`pa`)? UTRs are matched against RazorpayX payouts (`matchPayouts`) to get the true bank-side paid amount and validate `|paidBank − (fin+rel)| ≤ 1`. This route is the "**billed vs paid**" reconciliation.

### `scripts/sync-new-crm.mjs` — the purchase-date decision (mirrored in `app/api/sync-new-crm/route.js`)
The purchase day GoldApp stores comes straight from the final-payment timestamp:
```sql
LEFT JOIN LATERAL (
  SELECT MAX(created_at) fp FROM "Payment"
  WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT'
) fpay ON true
...
WHERE (t.created_at >= $1 OR fpay.fp >= $1)   -- so a bill walked-in earlier but PAID recently still syncs
```
```js
purchase_date:    fmtDate(r.final_payment_at || r.created_at),   // final-payment day (== invoice date); else walk-in
transaction_time: fmtTime(r.final_payment_at || r.created_at),
```
Code comment (verbatim): *"Final-payment timestamp = the day the purchase actually happened (== invoice date). Used as purchase_date for completed bills; null for in-progress ones."* Status mapping: `FINAL_PAYMENT_COMPLETED → 'approved'`. This matches MEMORY note *project_new_crm_purchase_date_basis*.

### Other consumers (grep hits)
`lib/purchaseRegisterData.js`, `lib/reports/purchaseReport.js`, `app/api/crm-purchases/route.js`, `app/api/productivity/route.js`, `app/api/branch-employees/insights/route.js`, `scripts/gen-crm-case-timeline.mjs` all reference the same `FINAL_PAYMENT`/`RELEASE_PAYMENT`/`PENNY_DROP` semantics. The `CONFIRMED` status on takeover/release finals is explicitly accepted per MEMORY note *project_confirmed_payment_takeover* (else those bills show ₹0).

---

## Appendix — quick FK map for this cluster
```
Transaction (case) ─┬─< Payment.transaction_id          (many: penny/final/release/reversal)
                    ├─< Invoice.transaction_id          (1 purchase receipt)
                    ├─< TaxInvoice.transaction_id       (1 GST service-fee invoice)
                    ├─< Order.transaction_id            (1 physical-gold order)
                    ├─< BankAccount.transactionId       (payout account)
                    └──> Transaction.eway_bill_id → EWayBill.id
Payment.bank_account_id → BankAccount.id ;  BankAccount.customer_id → Customer.id ;
BankAccount.pledge_company_id → PledgeCompany.id
Payment.employee_id / sales_emp_id → Employee.emp_id ;  Order.emp_id → Employee.emp_id
File.payment_id → Payment.id ;  File.bankAccountId / payoutbankAccountId → BankAccount.id
Order.id ─< GoldCollection.orderId, Melting.order_id
QRCode: no FK (linked via payload.transaction_id / payload.invoice_number → TaxInvoice.number)
```
```
Legend: "A ─< B.x" = B.x is an FK into A (B many-to-one A).
```
