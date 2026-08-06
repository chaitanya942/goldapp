# NEW CRM — Cluster 3: Transaction core, Walk-in, KYC, Customer

**Database:** `dbwhitegold_production` (AWS RDS Postgres, ap-south-1) — the White Gold **NEW CRM** (go-live 2026-06-15).
**Scope:** the transactional heart of the CRM. `Transaction` is the central hub; nearly every other table FKs to `Transaction.id`.
**Access:** READ-ONLY. All identifiers are PascalCase and MUST be quoted (`SELECT * FROM "Transaction"`).
**Snapshot date:** 2026-08-06 (live DB; counts drift by a few rows as new walk-ins arrive).

Convention notes that hold across the whole cluster:
- Every PK `id` is a **text** column. On the hub/child tables it is an application-generated UUID (e.g. `2237b00e-e505-…`). On `Customer` it is a human code `CUST-#####`. `Transaction` additionally carries a human code in `code` (`WGKA-#####`).
- `created_at` / `updated_at` are `timestamp WITHOUT time zone`, stored as **UTC**. IST = UTC + 5:30. GoldApp always converts with `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'` (or +5.5h in JS).
- `new_crm boolean DEFAULT true` appears on `Walkin`, `Customer`, `Document`. It marks a row as born in the new CRM vs migrated. In this DB it is `true` for effectively everything (the migration tables below are empty).

---

## Cluster row counts (exact, 2026-08-06)

| Table | Rows | Role |
|---|---:|---|
| `Transaction` | 18,701 | Central hub — one customer deal/visit |
| `Walkin` | 18,701 | Physical walk-in event; holds KYC-facing name (1:1 with Transaction) |
| `WalkinSync` | 558 | Google-Sheets → CRM walk-in import cursor (ops plumbing) |
| `Kyc` | 16,907 | One KYC case per Transaction |
| `KycLog` | 25,141 | KYC audit trail (maker/checker actions) — reconstructs KYC timeline |
| `KycChecklist` | 71,946 | Per-KYC verification questions (6 questions × answered KYCs) |
| `Document` | 68,911 | Uploaded proofs + ornament records + reference contacts |
| `Talkument` | 285 | OCR/AI document-extraction job records (KYC Aadhaar/PAN OCR) |
| `ApplicationForm` | **0** | Generated KYC application PDF metadata (unused so far) |
| `CustomerForm` | **0** | Generated customer-form PDF metadata (unused so far) |
| `OLDKyc` | **0** | Legacy-migration staging (empty) |
| `OLDTransaction` | **0** | Legacy-migration staging (empty) |
| `Customer` | 18,884 | Person master (dedup by mobile); `CUST-#####` id |
| `CustomerAuditLog` | 100,010 | Field-level change history for `Customer` |

The four empty tables (`ApplicationForm`, `CustomerForm`, `OLDKyc`, `OLDTransaction`) **exist in schema but hold zero rows** — see §OLD/Form tables.

---

## 1. `Transaction` — the hub

### Purpose
One row = one customer deal at a branch (a walk-in that may become a gold purchase). It anchors the whole workflow: the same `Transaction.id` ties together the `Walkin`, the `Kyc`, and later `Estimation` / `Quotation` / `Payment` / `Invoice` / `Release` / `Order`. Status walks a long state machine from `WALKIN` to `FINAL_PAYMENT_COMPLETED` (a booked purchase) or `WALKOUT` (customer left).

### Row count: 18,701

### Columns
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK, UUID. Referenced by ~15 child tables. |
| `customer_id` | text | NO | — | FK → `Customer.id` (`CUST-#####`). The person. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | **Walk-in / deal-open moment** (UTC). Productivity uses this as stage-1 start; sync uses it as purchase_date for *in-progress* bills. |
| `updated_at` | timestamp | NO | — | Last state change. For completed deals ≈ final-payment/completion time. |
| `status` | enum `TransactionStatus` | NO | `WALKIN` | Current workflow stage (see §state machine). |
| `transaction_type` | enum `TransactionType` | NO | `PHYSICAL_GOLD` | `PHYSICAL_GOLD` (buy loose gold) vs `RELEASED_GOLD` (takeover of pledged gold). |
| `branch_id` | text | NO | — | FK → `Branch.id`. Where the deal happened. |
| `emp_id` | text | NO | — | FK → `Employee.emp_id` (`WG#####`). The opener / branch employee. |
| `kyc_reject_reason` | text | YES | — | Free text if KYC rejected. |
| `sales_reject_reason` | text | YES | — | Free text if sales negotiation/approval rejected. |
| `walk_out_reason` | text | YES | — | Free text reason customer left (e.g. "Price Dissatisfaction"). |
| `customer_status` | enum `CustomerStatus` | NO | `WALKIN` | `WALKIN` (came to branch) vs `LEAD` (call-centre/tele lead converted). |
| `code` | text | NO | `generate_transaction_id('WGKA-')` | **Human bill code `WGKA-#####`** (range WGKA-50000 … WGKA-68731). This is GoldApp's `application_id`. The **hyphen** distinguishes new-CRM (`WGKA-####`) from old-CRM (`WGKA####`). |
| `eway_bill_id` | text | YES | — | FK → `EWayBill.id`. E-way bill for the gold shipment to HO. |
| `shipment_status` | enum `ShipmentStatus` | YES | — | `PENDING` / `SHIPPED` — has the branch shipped the gold to HO yet. NULL until relevant. |
| `walk_out_status` | enum `TransactionStatus` | YES | — | **The stage the deal was in when the customer walked out** (snapshot of `status` at walk-out). Lets ops see how far a lost deal got. |

### Keys
- **PK:** `id`.
- **FK out:** `customer_id`→`Customer.id`, `branch_id`→`Branch.id`, `emp_id`→`Employee.emp_id`, `eway_bill_id`→`EWayBill.id`.
- **FK in (children pointing at `Transaction.id` via `transaction_id`):** `Walkin`, `Kyc`, `Estimation`, `Quotation`, `Payment`, `Invoice`, `TaxInvoice`, `Release`, `Order`, `Lead`, `Notification`, `Timer`, `ActionControl`, `BankAccount.transactionId`.

### `TransactionType` — every value (2 total)
| Value | Count | Meaning |
|---|---:|---|
| `PHYSICAL_GOLD` | 16,003 | **Purchase of loose/physical gold** the customer owns. GoldApp maps → `PHYSICAL`. |
| `RELEASED_GOLD` | 2,698 | **Takeover**: gold currently pledged at an NBFC/bank; White Gold pays off the loan, releases the ornaments, then buys them. GoldApp maps → `TAKEOVER`. Note: the CRM does NOT have separate PURCHASE/RELEASE/TAKEOVER enum values — the *type* is just physical-vs-released; the *release/takeover mechanics* live in the `Release`/`Payment(type=RELEASE_PAYMENT)` tables and in `RELEASED_GOLD`-specific statuses like `PLEDGE_*` / `RELEASE_*`.

The legacy productivity note ("PURCHASE / RELEASE / TAKEOVER / RELEASED_GOLD") maps to reality as: **PURCHASE = `PHYSICAL_GOLD`**; **TAKEOVER/RELEASE = `RELEASED_GOLD`** (which runs the pledge→release→final-payment sub-flow).

### `TransactionStatus` — full state machine (24 enum values)
Enum order (pg_enum) roughly follows the workflow. Live distribution by (status × type):

| status | PHYSICAL | RELEASED | Meaning / stage |
|---|---:|---:|---|
| `WALKIN` | 328 | 93 | Just walked in; nothing done yet (default). Sync **excludes** these. |
| `WALKOUT` | 223 | 25 | Customer left without selling. `walk_out_reason`/`walk_out_status` set. Sync maps → `rejected`. |
| `ESTIMATION_PENDING` | 2,935 | 35 | Ornaments being weighed/estimated (physical path). |
| `VALUATION_PENDING` | 20 | — | Valuation (assay/purity) pending. |
| `BRANCH_KYC_PENDING` | 919 | 354 | Branch collecting KYC docs. |
| `KYC_PENDING` | 73 | 67 | KYC at maker/checker desk. |
| `KYC_REQUESTED` / `KYC_REJECTED` | (rare) | | Docs re-requested / KYC rejected. |
| `QUOTATION_PENDING` | 170 | 18 | Preparing the priced quotation. |
| `SALES_NEGOTIATION_PENDING` | 1,936 | 9 | Sales negotiating price with customer. |
| `SALES_APPROVAL_PENDING` | 229 | 1 | Awaiting sales approval of negotiated deal. |
| `SALES_HEAD_APPROVAL_PENDING` | — | — | Escalated to sales head. |
| `SERVICE_CHARGE_APPROVAL_PENDING` | — | — | Service-charge % needs approval. |
| `REVALUATION_PENDING` / `REVALUATION_COMPLETED` | 9 | 2 | Re-valuation loop. |
| `PLEDGE_ESTIMATION_PENDING` | — | 816 | (RELEASED) estimate pledged gold before release. |
| `PLEDGE_APPROVAL_PENDING` | — | 202 | (RELEASED) approve the pledge takeover. |
| `RELEASE_PENDING` | — | 248 | (RELEASED) releasing gold from the NBFC. |
| `RELEASE_AGREEMENT_PENDING` | — | 63 | (RELEASED) release agreement to be signed. |
| `RELEASE_PAYMENT_PENDING` | — | — | (RELEASED) payment to NBFC pending. |
| `PENNY_DROP_PENDING` | 203 | 28 | ₹1 penny-drop bank-account verification before payout. |
| `FINAL_PAYMENT_PENDING` | — | — | Final payout to customer queued. |
| `FINAL_PAYMENT_COMPLETED` | 8,729 | 965 | **TERMINAL SUCCESS — money paid, purchase booked.** Sync maps → `approved`. This is the boundary where GoldApp "takes over". |

**Happy path (PHYSICAL_GOLD):** `WALKIN → ESTIMATION_PENDING → (VALUATION) → SALES_NEGOTIATION_PENDING → SALES_APPROVAL_PENDING → QUOTATION_PENDING → BRANCH_KYC_PENDING → KYC_PENDING → PENNY_DROP_PENDING → FINAL_PAYMENT_PENDING → FINAL_PAYMENT_COMPLETED`.
**Happy path (RELEASED_GOLD / takeover):** adds `PLEDGE_ESTIMATION_PENDING → PLEDGE_APPROVAL_PENDING → RELEASE_PENDING → RELEASE_AGREEMENT_PENDING → RELEASE_PAYMENT_PENDING` before the final-payment tail.
**Terminal states:** `FINAL_PAYMENT_COMPLETED` (success) and `WALKOUT` (abandoned). Everything else is in-progress.

### `CustomerStatus` (on Transaction) — 2 values
`WALKIN` (15,619) walk-in customer · `LEAD` (3,081) originated as a call-centre/tele lead then converted.

### `ShipmentStatus` — 2 values
`PENDING` (8,244) gold not yet shipped to HO · `SHIPPED` (763) · NULL (9,693, not applicable / pre-payment).

### `walk_out_status` distribution
Snapshot of stage at abandonment: `ESTIMATION_PENDING` 103, `BRANCH_KYC_PENDING` 30, `PLEDGE_ESTIMATION_PENDING` 11, `RELEASE_PENDING` 4, others 1 each; NULL for the 18,549 not walked-out. Top `walk_out_reason` values: *Price Dissatisfaction* (49), *Taken Quotation - Will Visit Later* (42), *Unable to submit Additional Documents* (12), *Competitor Offering Better Price* (10), *Not interested to provide References* (9); plus test/dummy rows.

### Timestamps recap
`created_at` = walk-in/open; `updated_at` = last transition (≈ completion for booked deals). **The true purchase date is NOT on `Transaction`** — it is `MAX(Payment.created_at)` where `type=FINAL_PAYMENT AND status=COMPLETED` (see §critical rule).

### 3 masked sample rows
```
id=2237b00e…  code=WGKA-68710  customer_id=CUST-#####  status=FINAL_PAYMENT_COMPLETED
  transaction_type=PHYSICAL_GOLD  customer_status=LEAD   shipment_status=PENDING
  walk_out_status=NULL  branch_id=844f861b…  emp_id=WG00727  eway_bill_id=NULL
  created_at=2026-08-06T01:19:56Z  updated_at=2026-08-06T01:33:17Z
id=631abd4f…  code=WGKA-68705  customer_id=CUST-#####  status=FINAL_PAYMENT_COMPLETED
  transaction_type=PHYSICAL_GOLD  customer_status=WALKIN  shipment_status=PENDING
  created_at=2026-08-06T01:13:36Z  updated_at=2026-08-06T01:34:41Z
id=ffda24ed…  code=WGKA-687xx  customer_id=CUST-#####  status=WALKIN
  transaction_type=PHYSICAL_GOLD  customer_status=WALKIN  shipment_status=NULL
  (freshly walked-in, no work done)
```

---

## 2. `Walkin` — the physical walk-in event

### Purpose
Captures the walk-in as the customer presents themselves, including the **KYC-facing name typed at the desk** (`first_name`/`last_name`). This is the name the CRM dashboard shows and the name GoldApp displays (it can differ from the cleaned `Customer` master name). **1:1 with Transaction** (18,701 walkins, 18,701 distinct `transaction_id`). Also holds the demographic KYC intake fields (income, address, DOB, occupation).

### Row count: 18,701

### Columns (key ones)
| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text | NO | PK. |
| `transaction_id` | text | NO | FK → `Transaction.id` (the deal). |
| `customer_id` | text | NO | FK → `Customer.id` (denormalised). |
| `first_name`,`last_name` | text | YES | **KYC-stage name** (often UPPERCASE, whitespace-padded — GoldApp `btrim`s it). |
| `mobile` | text | NO | Primary phone. |
| `alternate_mobile`,`email_address` | text | YES | Contacts. |
| `location` | text | YES | Stated location. |
| `survey`,`survey_custom`,`survey_advertisement` | text | YES | "How did you hear about us" marketing attribution. |
| `status` | enum `CustomerStatus` | NO (dflt WALKIN) | `WALKIN`/`LEAD`. |
| `annual_income`,`nature_of_work`,`organization_type`,`marital_status`,`mother_tongue`,`gender`,`father_name`,`dob`,`current_address`,`permanent_address` | text/timestamp | YES | KYC demographic intake (mirror of `Customer` fields). |
| `new_crm` | bool | YES (dflt true) | Born in new CRM. |
| `created_at`,`updated_at` | timestamp | NO | Walk-in creation / edit. |

### Keys
PK `id`; FK out `transaction_id`→`Transaction.id`, `customer_id`→`Customer.id`. FK in: `File.walkin_id` (attached files/photos).

### Sample rows (masked)
```
id=82a9a6e0…  transaction_id=ffda24ed…  first_name=NULL last_name=NULL  mobile=9xxxxxxxxx  status=WALKIN  new_crm=true
id=ac061d83…  transaction_id=9ef15e15…  first_name="Name" last_name="M"  mobile=9xxxxxxxxx  status=WALKIN  new_crm=true
```

---

## 3. `WalkinSync` — Google-Sheets import cursor

### Purpose
Ops plumbing, **not per-customer data**. The new CRM ingests branch walk-ins from Google Sheets (per region tab). Each `WalkinSync` row is a sync run recording, per sheet, the last row consumed — so the next run resumes there.

### Row count: 558

### Columns
`id` text PK · `created_at` timestamp · `synced_at` timestamp (when the sync ran) · `metadata` **jsonb** (array of `{sheetId, sheetName, lastSyncedRow}`).

### Sample `metadata`
```json
[ {"sheetId":0,          "sheetName":"Walkin-KA",    "lastSyncedRow":2235},
  {"sheetId":552140557,  "sheetName":"Walkin-AP/TS", "lastSyncedRow":2599},
  {"sheetId":1533406935, "sheetName":"Walkin-KL",    "lastSyncedRow":3823} ]
```
Sheet tabs correspond to regions: **Walkin-KA** (Karnataka), **Walkin-AP/TS** (Andhra/Telangana), **Walkin-KL** (Kerala). Runs roughly every few hours (rows at 01:00, 07:00…). GoldApp does not read this table.

---

## 4. `Kyc` — one KYC case per Transaction

### Purpose
The KYC verification record for a deal. Runs a **maker → checker** two-eyes workflow. One `Kyc` per `Transaction` (16,907 vs 18,701 — deals abandoned before KYC have none).

### Row count: 16,907

### Columns
| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text | NO | PK. Parent of `KycChecklist`, `KycLog`, `Document`, `Talkument`, `ApplicationForm`, `CustomerForm`, `File.maker_recording_id`. |
| `transaction_id` | text | NO | FK → `Transaction.id`. |
| `status` | enum `KycStatus` | YES | Composite current state (see below). |
| `maker_status` | enum `MakerStatus` | YES | `REQUESTED`/`PENDING`/`APPROVED`/`REJECTED`. |
| `checker_status` | enum `CheckerStatus` | YES | `REQUESTED`/`PENDING`/`APPROVED`/`REJECTED`. |
| `maker_remark`,`checker_remark` | text | YES | Reviewer notes. |
| `ocr_status` | enum `TalkumentStatus` | YES | OCR job state (`INPROGRESS`/`COMPLETED`/`FAILED`) for auto document extraction. |
| `created_at`,`updated_at` | timestamp | YES | KYC opened / last action. |

### `KycStatus` — 8 values + distribution
| status | count | Meaning |
|---|---:|---|
| `CHECKER_APPROVED` | 10,831 | **KYC fully cleared** (maker approved, checker approved). |
| *NULL* | 4,917 | KYC opened but not yet actioned (early-stage / abandoned). |
| `MAKER_REJECTED` | 711 | Maker rejected the KYC. |
| `MAKER_PENDING` | 242 | Sitting at maker desk. |
| `MAKER_REQ_DOC` | 164 | Maker requested additional documents. |
| `CHECKER_REJECTED` | 31 | Checker rejected after maker approved. |
| `CHECKER_PENDING` | 6 | Awaiting checker. |
| `CHECKER_REQ_DOC` | 6 | Checker requested more docs. |

`maker_status × checker_status`: `APPROVED/APPROVED` 10,922 dominate; `NULL/NULL` 4,917; `REJECTED/NULL` 708; `REQUESTED/NULL` 164; `PENDING/NULL` 152.
Full enum inventory: `KycStatus` = {CHECKER_PENDING, MAKER_PENDING, CHECKER_APPROVED, CHECKER_REJECTED, MAKER_APPROVED, MAKER_REJECTED, CHECKER_REQ_DOC, MAKER_REQ_DOC}.

### KYC lifecycle
`(open, NULL) → MAKER_PENDING → [MAKER_REQ_DOC ↺ docs re-requested] → MAKER_APPROVED/MAKER_REJECTED → CHECKER_PENDING → [CHECKER_REQ_DOC ↺] → CHECKER_APPROVED (done) / CHECKER_REJECTED (bounce back)`. The authoritative timeline is reconstructed from **`KycLog`** (below), not from these snapshot columns.

### Sample (masked)
```
id=047c520c…  transaction_id=3b530662…  status=CHECKER_APPROVED  maker_status=APPROVED  checker_status=APPROVED
  maker_remark="Cst visited the branch and aadhar id provided"  ocr_status=NULL
  created_at=2026-08-06T01:26:06Z updated_at=2026-08-06T01:39:06Z
```

---

## 5. `KycLog` — KYC audit trail (the real timeline)

### Purpose
Append-only log of every maker/checker action on a KYC. This is what GoldApp's productivity module uses to time the "KYC maker → checker" stage. FK `emp_id`→`Employee.emp_id` identifies who acted.

### Row count: 25,141

### Columns
`id` text PK · `kyc_id` text FK→`Kyc.id` · `action` enum `KycAction` NOT NULL · `employee_class` enum `KycEmployeeClass` NOT NULL · `requested_docs` text (nullable; which docs re-requested) · `emp_id` text FK→`Employee.emp_id` · `created_at`/`updated_at`.

### Enum distribution (action × class)
| action | class | count |
|---|---|---:|
| `APPROVED` | `KYC_CHECKER` | 10,988 |
| `APPROVED` | `KYC_MAKER` | 10,972 |
| `REQUESTED` | `KYC_MAKER` | 2,398 |
| `REJECTED` | `KYC_MAKER` | 714 |
| `REQUESTED` | `KYC_CHECKER` | 43 |
| `REJECTED` | `KYC_CHECKER` | 31 |

- `KycAction` = {REQUESTED (asked for more docs), APPROVED, REJECTED}.
- `KycEmployeeClass` = {KYC_MAKER, KYC_CHECKER}.

Reconstruct KYC stage timing: min(`created_at`) for `KYC_MAKER` = maker-start; the maker's APPROVED then checker's min = handoff; checker APPROVED = KYC close. GoldApp does exactly this (productivity route line ~144).

---

## 6. `KycChecklist` — per-KYC verification questions

### Purpose
The fixed set of due-diligence questions answered per KYC (reference/address/identity verification). **6 questions per answered KYC** → ~72k rows / ~11,991 KYCs.

### Row count: 71,946

### Columns
`id` PK · `kyc_id` FK→`Kyc.id` · `title` text (the question) · `answer` bool (yes/no) · `optional` bool · `created_at`/`updated_at`.

### The 6 questions (each ~11,991 rows)
1. Did the reference confirm relationship with the customer?
2. Is the address matching between primary and additional documents?
3. Has the reference given consent for transaction to take place?
4. Did the reference contact identify the ornaments being sold?
5. Has the reference name checked on true-caller?
6. Are all of the customer's details provided in the documents the same?

---

## 7. `Document` — proofs, ornaments, reference contacts

### Purpose
Every uploaded artefact and structured record attached to a KYC: ID proof, address proof, bank proof, the **jewellery/ornament records** (with `approx_gross_weight`, `reason_for_selling`), and **reference contacts** (name/mobile/relation + a call recording + geo lat/long). Linked to `Kyc` (new) or `OLDKyc` (legacy).

### Row count: 68,911 (all `new_crm=true`)

### Columns (key)
| Column | Type | Meaning |
|---|---|---|
| `id` | text PK | |
| `document_class` | enum `DocumentClass` | Category (below). |
| `document_type` | enum `DocumentType` | Specific type (AADHAAR, PAN, …). Nullable. |
| `verified` | bool (dflt false) | Reviewer verified. |
| `kyc_id` | text FK→`Kyc.id` | New-CRM link. |
| `old_kyc_id` | text FK→`OLDKyc.id` | Legacy link (unused — OLDKyc empty). |
| `approx_gross_weight` | float8 | For JEWELLERY rows: est. gross weight (g). |
| `reason_for_selling` | text | e.g. `PERSONAL_NEED`. |
| `document_id` | text | Storage key / external file id / doc number. |
| `isImage` | bool | Rendering hint. |
| `contact_name`,`contact_mobile`,`contact_relation`,`contact_recording` | text | For REFERENCE_CONTACT rows. |
| `lat`,`long` | float8 | Geo where captured. |
| `ornament_source` | text | Provenance of the ornament. |
| `additional_info` | text | Free notes. |
| `isBypassed` | bool (dflt false) | Verification step bypassed. |
| `new_crm` | bool NOT NULL dflt true | |
| `created_at`,`updated_at` | timestamp | |

### `DocumentClass` distribution (7-value enum)
| class | count | notes |
|---|---:|---|
| `JEWELLERY` | 20,597 | ornament records (weights/reason) |
| `OTHERS` | 16,849 | misc uploads / bypass placeholders |
| `ID_PROOF` | 11,984 | |
| `ADDRESS_PROOF` | 11,638 | |
| `REFERENCE_CONTACT` | 6,333 | reference person + recording |
| `BANK_PROOF` | 1,510 | |
| (`BILL` defined in enum, 0 rows here) | | |

`DocumentType` (top, for ID/ADDRESS): AADHAAR 17,149 · PAN 2,348 · DRIVING_LICENSE 341 · PASSPORT 254 · VOTER_ID 208 · RC 102 · NULL 3,220. (Enum also has PAYOUT_FORM, CANCELLED_CHEQUE, house internal/external selfie types, GST/business cards, etc.)

### Sample (masked)
```
id=8fcbf40b…  class=JEWELLERY  type=JEWELLERY  verified=false  approx_gross_weight=11.66  reason_for_selling=PERSONAL_NEED  kyc_id=047c520c…
```

---

## 8. `Talkument` — OCR/AI document-extraction jobs

### Purpose
Records calls to an OCR/LLM service ("Talkument") that reads a KYC document (Aadhaar/PAN) and returns structured JSON. One row per extraction attempt. Low volume — feature partially rolled out (285 rows, `Kyc.ocr_status` COMPLETED only 89).

### Row count: 285

### Columns
`id` PK · `status` enum `TalkumentStatus` (`INPROGRESS`/`COMPLETED`/`FAILED`, dflt INPROGRESS) · `prompt` text NOT NULL · `response` jsonb (extracted fields) · `chat_id` text (provider session id) · `error_message` text · `callback_url` text · `kyc_id` FK→`Kyc.id` · timestamps.

Distribution: COMPLETED 274, FAILED 11.

---

## 9. `Customer` — person master

### Purpose
The de-duplicated person record (by `mobile`), reused across all their transactions. Human PK `CUST-#####`. Holds the "clean" profile; GoldApp still prefers the `Walkin` name for display.

### Row count: 18,884

### Columns (key)
`id` text PK `generate_customer_id('CUST-', 5)` · `mobile` NOT NULL (dedup key) · `alternate_mobile`,`email_address` · `first_name`,`last_name`,`father_name`,`gender`,`dob`,`marital_status`,`mother_tongue` · `current_address`,`permanent_address`,`location` · `annual_income`,`nature_of_work`,`organization_type` · `image` (photo) · `survey`,`survey_custom`,`survey_advertisement` (attribution) · `status` enum `CustomerStatus` (WALKIN/LEAD, dflt WALKIN) · `new_crm` bool dflt true · `created_at`,`updated_at`.

### Keys
PK `id`. FK in: `Transaction`, `OLDTransaction`, `OLDKyc`, `BankAccount`, `Blocklist`, `Spectrometer`, `CustomerAuditLog` (all via `customer_id`).

### Sample (masked)
```
id=CUST-#####  mobile=9xxxxxxxxx  first_name="Name" last_name="Name"  status=WALKIN  new_crm=true
```

---

## 10. `CustomerAuditLog` — field-level change history

### Purpose
One row per changed `Customer` field — the compliance trail for edits (who/when/what/from-which-IP). Heavy because the KYC intake writes each demographic field individually.

### Row count: 100,010

### Columns
`id` PK · `customer_id` FK→`Customer.id` · `field_name` text NOT NULL · `old_value`,`new_value` text · `changed_at` timestamp dflt now · `change_type` text dflt `'UPDATE'` (also CREATE/etc.) · `employee_id` FK→`Employee.id` (nullable) · `ip_address`,`user_agent` text.

### Most-changed fields
`nature_of_work` 9,765 · `marital_status` 9,763 · `annual_income` 9,762 · `mother_tongue` 9,761 · `organization_type` 9,759 · `father_name` 9,753 · `permanent_address` 9,752 · `current_address` 9,739 · `gender` 9,734 · `dob` 9,619 · then `last_name` 1,087, `first_name` 917, `alternate_mobile` 315, `survey` 70, `email_address` 67. (These counts ≈ number of customers that went through full KYC intake — each field logged once as it's filled.)

---

## OLD / Form tables (schema-present, empty)

- **`OLDTransaction` (0 rows)** — legacy-migration staging for pre-new-CRM deals. Columns: `id`, `customer_id`→Customer, `transaction_type`, `status`, `walk_out_reason`, `branch_id`→Branch, `emp_id`→Employee, plus **denormalised money/weight** (`amount`, `service_charge`, `no_of_ornaments`, `total_net_weight`, `takeover_amount`, `balance_amount`). Shape shows the old CRM kept amounts on the transaction itself; the new CRM normalised them into `Estimation`/`Quotation`/`Ornament`/`Payment`. **Empty** → the intended history backfill was never loaded here (old-CRM history lives in the separate MySQL old CRM instead).
- **`OLDKyc` (0 rows)** — legacy KYC staging: `id`, `customer_id`→Customer, `maker_remark`, `checker_remark`, timestamps. `Document.old_kyc_id` FKs here but no rows exist.
- **`ApplicationForm` (0 rows)** — metadata for a generated KYC *application* PDF: `pdf_generated` bool, `file_name`, `kyc_id`→Kyc. Feature not in use.
- **`CustomerForm` (0 rows)** — same shape for a generated *customer* form PDF. Not in use.

Takeaway: legacy data was NOT migrated into these Postgres tables. GoldApp reconciles old-vs-new by reading the old CRM (MySQL) separately and the new CRM (this Postgres) — the `WGKA-` hyphen convention is the join/dedup key.

---

## How one Transaction ties the workflow together

```
Customer (CUST-#####)
   └─< Transaction (id, code WGKA-#####, status, transaction_type)   ← the hub
         ├─ Walkin           (1:1  — KYC-facing name, intake demographics)
         ├─ Kyc              (1    — maker/checker)
         │     ├─< KycLog        (audit trail / timeline)
         │     ├─< KycChecklist  (6 verification questions)
         │     ├─< Document      (ID/address/bank proofs, ornaments, references)
         │     └─< Talkument     (OCR extraction jobs)
         ├─< Estimation      (valuation, negotiation)        [other cluster]
         ├─< Quotation       (priced offer: service_charge, final_amount, Ornaments)
         ├─< Payment         (PENNY_DROP / FINAL_PAYMENT / RELEASE_PAYMENT)
         ├─< Release         (RELEASED_GOLD takeover: NBFC release + Agreement)
         ├─< Invoice / TaxInvoice / Order / Timer / Lead / Notification
         └─ eway_bill_id → EWayBill (shipment of gold to HO)
```

---

## CRITICAL business rule: what encodes a completed PURCHASE, and its date

**"A purchase belongs to its FINAL-PAYMENT day (== invoice date)."** Encoding:

- A deal is a **booked purchase** iff `Transaction.status = 'FINAL_PAYMENT_COMPLETED'`. The *amounts/weights* are NOT on `Transaction` — they come from the latest `Quotation` (`service_charge`, `service_charge_amount`, `final_amount`) and the approved `Ornament` rows (gross/stone/wastage/net weight, purity, amount) linked via `Estimation`/`Quotation`.
- **PURCHASE vs RELEASE vs TAKEOVER:** `transaction_type = PHYSICAL_GOLD` → straight purchase; `= RELEASED_GOLD` → takeover (pledged gold released from an NBFC then bought). RELEASED deals additionally have `Release`/`Agreement` rows and a `Payment(type=RELEASE_PAYMENT)` leg to the NBFC, on top of the `FINAL_PAYMENT` leg to the customer.
- **The purchase DATE** is `MAX(Payment.created_at)` where `type='FINAL_PAYMENT' AND status='COMPLETED'` (the money-out moment = invoice date) — **not** `Transaction.created_at` (walk-in) and **not** the dashboard's mutable `updated_at`. For still-in-progress bills that have no final payment, GoldApp falls back to `created_at`.

---

## How GoldApp uses this cluster (repo references)

### `scripts/sync-new-crm.mjs` (the primary consumer; run every 60s by the `goldapp-cron` Railway service)
- Pulls from this Postgres, upserts into Supabase `purchases`. Core query (lines 104-175):
  - Joins `Transaction t` → `Customer c`, `Branch b`, LATERAL latest `Walkin` (name), LATERAL latest `Quotation` (money), LATERAL `MAX(Payment.created_at) WHERE status='COMPLETED' AND type='FINAL_PAYMENT'` as `final_payment_at`, and a deduped `Ornament` rollup (weights) gathered via BOTH `Quotation` and `Estimation`, `approve=true`, `DISTINCT ON (transaction_id, ornament_id)` keeping latest (avoids the double-count footgun).
  - **Name** = `COALESCE(btrim(Walkin.first/last_name), Customer.first/last_name)` — Walkin wins (matches CRM dashboard).
  - Window: `WHERE (t.created_at >= cutoff OR final_payment_at >= cutoff) AND t.status != 'WALKIN'` — so a bill walked-in earlier but PAID recently still syncs on its payment day.
- **Status mapping** (`mapStatus`): `FINAL_PAYMENT_COMPLETED → approved`; `WALKOUT → rejected`; everything else → `pending`.
- **Type mapping** (`mapTxnType`): contains `RELEASED` → `TAKEOVER`, else `PHYSICAL`.
- **application_id** = `Transaction.code`, hyphen preserved (`WGKA-#####`) — the key that separates new-CRM from old-CRM (`WGKA#####`).
- **purchase_date / transaction_time** = IST of `final_payment_at || created_at` (the critical rule, lines 202-205).
- `clampPct` guards a garbage `service_charge` % from overflowing and blocking the whole batch (see MEMORY: sync resilience).

### `app/api/billed-vs-paid/route.js`
- BILLED comes from Supabase `purchases` (approved rows, `final_amount_crm`, `transaction_type`).
- PAID rolls up new-CRM **`Payment`** per `Transaction.code`: `SUM(FINAL_PAYMENT DEBITED) + RELEASE_PAYMENT − CREDITED(reversals)`, plus `PENNY_DROP` and payout-account match (did FINAL_PAYMENT go to the penny-drop-verified account). Joins `Payment → Transaction t` by `t.code`.

### `app/api/productivity/route.js` (TAT / stage analytics)
- Reconstructs stage timing purely from artifact timestamps (Timer table is dead — see MEMORY): `Transaction.created_at`→open, `Estimation`, `Quotation`, `KycLog`(min maker / max checker `created_at` by `employee_class`), `Payment`, `Order`, `Release`, `Agreement`. Stage 5 = "KYC maker → checker" from `KycLog JOIN Kyc JOIN Transaction`. `completed = status==='FINAL_PAYMENT_COMPLETED'`.

### Others
`lib/purchaseRegisterData.js`, `lib/reports/purchaseReport.js`, `app/api/crm-purchases`, `app/api/backfill-purchases`, `app/api/collection-audit`, `app/api/e-invoice/preview`, `lib/clearTaxClient.js` read the same `Transaction`/`Walkin`/`Kyc`/`Payment` shapes (register, e-invoicing, collection audit). All key off `Transaction.code` (`WGKA-#####`) and the `FINAL_PAYMENT_COMPLETED` + `final-payment-day` rule.

---

## Quick-reference: enums touching this cluster
- **TransactionStatus** (24): WALKIN, WALKOUT, ESTIMATION_PENDING, VALUATION_PENDING, BRANCH_KYC_PENDING, KYC_PENDING, KYC_REQUESTED, KYC_REJECTED, QUOTATION_PENDING, SALES_NEGOTIATION_PENDING, SALES_APPROVAL_PENDING, SALES_HEAD_APPROVAL_PENDING, SERVICE_CHARGE_APPROVAL_PENDING, REVALUATION_PENDING, REVALUATION_COMPLETED, PLEDGE_ESTIMATION_PENDING, PLEDGE_APPROVAL_PENDING, RELEASE_PENDING, RELEASE_AGREEMENT_PENDING, RELEASE_PAYMENT_PENDING, PENNY_DROP_PENDING, FINAL_PAYMENT_PENDING, FINAL_PAYMENT_COMPLETED.
- **TransactionType** (2): PHYSICAL_GOLD, RELEASED_GOLD.
- **CustomerStatus** (2): LEAD, WALKIN.
- **ShipmentStatus** (2): PENDING, SHIPPED.
- **KycStatus** (8): MAKER_PENDING, MAKER_APPROVED, MAKER_REJECTED, MAKER_REQ_DOC, CHECKER_PENDING, CHECKER_APPROVED, CHECKER_REJECTED, CHECKER_REQ_DOC.
- **MakerStatus/CheckerStatus** (4 each): REQUESTED, PENDING, APPROVED, REJECTED.
- **KycAction** (3): REQUESTED, APPROVED, REJECTED. **KycEmployeeClass** (2): KYC_MAKER, KYC_CHECKER.
- **DocumentClass** (7): ADDRESS_PROOF, ID_PROOF, BILL, JEWELLERY, OTHERS, BANK_PROOF, REFERENCE_CONTACT.
- **TalkumentStatus** (3): INPROGRESS, COMPLETED, FAILED.
- (Payment-side, adjacent: **PaymentType** PENNY_DROP/FINAL_PAYMENT/RELEASE_PAYMENT; **PaymentAction** DEBITED/CREDITED; **PaymentStatus** incl. COMPLETED, CONFIRMED — note MEMORY: RELEASED/TAKEOVER final payments settle as CONFIRMED not COMPLETED.)
