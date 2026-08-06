# NEW CRM — Cluster 7: System / Infrastructure / Misc

**Database:** `dbwhitegold_production` (AWS RDS Postgres, `ap-south-1`)
**Scope:** `File`, `Timer`, `ApiKey`, `ApiKeyUsage`, `Qandle`, `Place`, `AuditTrails`, `_prisma_migrations`
**Access:** READ-ONLY (SELECT only). All identifiers are PascalCase and MUST be quoted (`SELECT * FROM "File"`).
**Snapshot captured:** 2026-08-06 (live prod DB — row counts drift by a few rows between queries as production keeps writing).

Row counts are exact at capture time:

| Table | Rows | Notes |
|---|---:|---|
| `File` | ~269,910 | Central polymorphic attachment table. Growing live. |
| `ApiKeyUsage` | 206,932 | Inbound lead-webhook request log. Growing live. |
| `Timer` | 30,399 | **Effectively dead** — 99% of rows are Aug–Sep 2025; abandoned after. |
| `Qandle` | 870 | HR/HRMS employee master (Qandle HRMS integration). Nightly-refreshed. |
| `Place` | 588 | Geographic locality master. Frozen since 2025-09-04. |
| `ApiKey` | 6 | External lead-ingestion API keys. |
| `AuditTrails` | **0** | **EMPTY** — table exists, never populated. |
| `_prisma_migrations` | 347 | Prisma migration history (schema evolution log). |

**GoldApp usage summary (grep of `app/`, `lib/`, `scripts/`, `components/`):** GoldApp does **not** query any of these 8 tables directly by name. The productivity module (`app/api/productivity/route.js`) deliberately reconstructs per-stage timing from **artifact `created_at`/`updated_at`** on `Estimation`, `Quotation`, `Payment`, `Order`, `KycLog`, `Release`, `Agreement` — **never from `Timer`** (confirming the memory note that Timer is dead/unreliable). The new-CRM sync (`scripts/sync-new-crm.mjs`) touches none of these tables. So this whole cluster is CRM-internal plumbing that GoldApp reads around, not through.

---

## 1. `File` — polymorphic attachment / asset table

### Purpose
The single central store for every uploaded binary asset in the CRM: ornament photos, spectrometer readings, KYC document scans (front/back), video documents, bank passbook/cheque images, payment receipts, agreements, pledge/release receipts, and one stray audio recording. Each row is one asset (an S3 object key), tagged with a MIME `type` and a thumbnail key, and linked to **exactly one** business entity via one of ~19 nullable `*_id` foreign-key columns (polymorphic-by-column pattern). The actual bytes live in S3; this table holds the key + metadata + link.

### Row count
~269,910 (live, growing). Date range of `created_at`: **2025-06-18** → present. This is the second-largest table in the cluster and one of the biggest in the CRM.

### Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (UUID). |
| `created_at` | timestamptz(no tz) | NO | `CURRENT_TIMESTAMP` | When the asset row was inserted (upload time). |
| `updated_at` | timestamp | NO | — | Last modification (usually == created_at; assets are immutable). |
| `updated_emp_id` | text | YES | — | FK → `Employee.emp_id`. The employee who uploaded/last touched it. **Populated on ~231,200 rows (86%)** — the most-used link after `thumb`; effectively the uploader audit column. |
| `name` | text | NO | — | **S3 object key** (path), e.g. `ornaments/<ts>-<uuid>.jfif`, `kyc/customers/<ts>-<digits>.jpg`. The folder prefix reveals asset kind (`ornaments/`, `kyc/customers/`, etc.). |
| `type` | text | NO | — | MIME type. Distribution below — overwhelmingly `image/jpeg`. |
| `ornament_id` | text | YES | — | FK → `Ornament.id`. The primary ornament photo. |
| `spectro_ornament_id` | text | YES | — | FK → `Ornament.id`. The spectrometer (XRF purity) reading image for that ornament. |
| `back_document_id` | text | YES | — | FK → `Document.id`. Back-side scan of a KYC/ID document. |
| `front_document_id` | text | YES | — | FK → `Document.id`. Front-side scan of a KYC/ID document. |
| `purchase_bill_id` | text | YES | — | FK → **`PledgeCompany.id`** (see note). Purchase-bill image tied to a pledge-company record. |
| `release_ornament_id` | text | YES | — | FK → **`PledgeCompany.id`**. Released-ornament photo (pledge release flow). |
| `pledge_receipt_id` | text | YES | — | FK → **`PledgeCompany.id`**. Pledge receipt scan. |
| `bankAccountId` | text | YES | — | FK → `BankAccount.id`. Bank proof (passbook/cheque) for a customer bank account. |
| `payoutbankAccountId` | text | YES | — | FK → `BankAccount.id`. Bank proof for the payout account. |
| `payment_id` | text | YES | — | FK → `Payment.id`. Payment receipt / proof image. |
| `video_document_id` | text | YES | — | FK → `Document.id`. Video-KYC / video document capture. |
| `total_weight_id` | text | YES | — | FK → `Estimation.id`. Photo of the aggregate weighing at estimation. |
| `quotation_total_weight_id` | text | YES | — | FK → `Quotation.id`. Photo of aggregate weighing at quotation. |
| `total_spectrometer_id` | text | YES | — | FK → `Quotation.id`. Aggregate spectrometer image at quotation. |
| `maker_recording_id` | text | YES | — | FK → `Kyc.id`. KYC maker call recording (the lone `audio/wav`). |
| `thumb` | text | YES | — | S3 key of the generated thumbnail (`..._thumb.jpg`). **Populated on ~222,600 rows (82%)**. |
| `walkin_id` | text | YES | — | FK → `Walkin.id`. Photo captured at walk-in. |
| `agreement_id` | text | YES | — | FK → `Agreement.id`. Signed-agreement scan. |
| `estimation_total_ornament_id` | text | YES | — | FK → `Estimation.id`. **0 rows — never used.** |
| `quotation_total_ornament_id` | text | YES | — | FK → `Quotation.id`. Aggregate-ornament photo at quotation. |

### FK-column population (which links are actually used)

Counts of non-NULL per link column (out of ~269,900):

| Column | Populated | % | Target table | What the file is |
|---|---:|---:|---|---|
| `updated_emp_id` | 231,209 | 86% | `Employee.emp_id` | uploader (audit, not a business link) |
| `thumb` | 222,615 | 82% | (S3 key, not FK) | thumbnail of the asset |
| `front_document_id` | 62,450 | 23% | `Document` | KYC ID front scan |
| `ornament_id` | 55,604 | 21% | `Ornament` | ornament photo |
| `spectro_ornament_id` | 30,922 | 11% | `Ornament` | spectrometer purity image |
| `back_document_id` | 26,931 | 10% | `Document` | KYC ID back scan |
| `total_weight_id` | 14,839 | 5.5% | `Estimation` | estimation aggregate-weight photo |
| `walkin_id` | 12,204 | 4.5% | `Walkin` | walk-in photo |
| `quotation_total_ornament_id` | 11,996 | 4.4% | `Quotation` | quotation aggregate-ornament photo |
| `payoutbankAccountId` | 9,675 | 3.6% | `BankAccount` | payout bank proof |
| `quotation_total_weight_id` | 8,298 | 3.1% | `Quotation` | quotation weight photo |
| `total_spectrometer_id` | 8,145 | 3.0% | `Quotation` | quotation spectrometer image |
| `agreement_id` | 4,695 | 1.7% | `Agreement` | signed agreement scan |
| `bankAccountId` | 3,923 | 1.5% | `BankAccount` | bank proof |
| `pledge_receipt_id` | 2,659 | 1.0% | `PledgeCompany` | pledge receipt |
| `payment_id` | 1,242 | 0.5% | `Payment` | payment receipt |
| `release_ornament_id` | 638 | 0.2% | `PledgeCompany` | released-ornament photo |
| `purchase_bill_id` | 491 | 0.2% | `PledgeCompany` | purchase bill (pledge) |
| `video_document_id` | 74 | 0.03% | `Document` | video-KYC capture |
| `maker_recording_id` | 1 | ~0% | `Kyc` | maker call recording (audio) |
| `estimation_total_ornament_id` | **0** | 0% | `Estimation` | **unused column** |

> **Note on `purchase_bill_id` / `release_ornament_id` / `pledge_receipt_id`:** verified via `pg_catalog` (not just `information_schema`) — all three genuinely FK to **`PledgeCompany.id`**, not to Purchase/Ornament/Receipt tables as the names suggest. This is a Prisma named-relation quirk where these File columns hang off the `PledgeCompany` model. Documented as-is; treat the column names as labels, the constraint target as authoritative.

Most rows are ornament/KYC images captured during the buying flow; the majority carry an uploader (`updated_emp_id`) and a `thumb` but link to a business entity through whichever single `*_id` matches the capture step.

### File `type` distribution

| type | rows |
|---|---:|
| `image/jpeg` | 266,651 |
| `image` (untyped) | 2,585 |
| `image/png` | 460 |
| `application/pdf` | 213 |
| `image/webp` | 9 |
| `audio/wav` | 1 |

By filename extension: `.jpg` 213,748 · `.jpeg` 37,180 · `.webp` 9,681 · `.png` 5,871 · `.jfif` 3,218 · `.pdf` 213 · `.bmp` 7 · `.wav` 1. (Note `type` and extension disagree often — e.g. `.jfif`/`.webp` files stored with `type='image/jpeg'`; trust neither blindly, both are set client-side.)

### PK / FK
- **PK:** `id`.
- **Out FKs:** the 20 columns above (→ Ornament, Document, BankAccount, PledgeCompany, Payment, Estimation, Quotation, Kyc, Agreement, Walkin, Employee).
- **In FKs:** none (leaf attachment table).

### Timestamps
`created_at` = upload time; `updated_at` = last touch (assets are effectively immutable, so equal in practice).

### 3 masked sample rows

```
id: 4dc0fd1a-…            created_at: 2026-08-06 01:42:35   updated_emp_id: WG00784
name: ornaments/1786000355051-<uuid>.jfif   type: image/jpeg
thumb: ornaments/1786000355051-<uuid>_thumb.jfif
(all *_id link columns NULL — an ornament image row where the ornament link was set separately)

id: aaceec4b-…            created_at: 2026-08-06 01:42:29   updated_emp_id: WG00784
name: ornaments/1786000349728-<uuid>.jfif   type: image/jpeg
thumb: ornaments/1786000349728-<uuid>_thumb.jfif

id: 778221f7-…            created_at: 2026-08-06 01:42:25   updated_emp_id: WG00218
name: kyc/customers/1786000345681-<digits>.jpg   type: image/jpeg
thumb: kyc/customers/1786000345681-<digits>_thumb.jpg
```

---

## 2. `Timer` — per-stage transaction time tracking  ⚠️ DEAD / UNRELIABLE

### Purpose
Was intended to log time an employee spent on each transaction stage: a row per (employee, transaction, stage) with `started_at`/`finished_at` and the from→to status transition. The CRM's original productivity-timing source.

### Row count & reliability verdict — **DEAD after Sept 2025**
- 30,399 rows total, covering only **2,651 distinct transactions** (a tiny fraction of all CRM transactions).
- `started_at` range: 2025-08-05 → 2026-04-04. **But the distribution is collapsed:**

| Month | rows |
|---|---:|
| 2025-08 | 5,474 |
| **2025-09** | **24,589** |
| 2025-10 | 15 |
| 2025-11 | 11 |
| 2025-12 | 90 |
| 2026-01 | 20 |
| 2026-02 | 53 |
| 2026-03 | 112 |
| 2026-04 | 35 |

  → **~99% of all rows are Aug–Sep 2025.** From Oct 2025 onward it's a near-zero trickle. The feature was effectively abandoned in Sept 2025.
- **Duration integrity is broken:** of 30,399 rows, `finished_at` is NULL on 2,427, and `finished_at < started_at` (negative duration) on **1,929**. Only 26,043 (86%) have a sane `finished ≥ started`. Stage durations cannot be trusted.

**Conclusion:** Timer is dead and unreliable — do not use it for stage timing. This is exactly why GoldApp's productivity module reconstructs timing from artifact `created_at`/`updated_at` on Estimation/Quotation/Payment/Order/KycLog/Release/Agreement instead (see §9). Confirmed by grep: no GoldApp code references `Timer`.

### Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (UUID). |
| `employee_id` | text | YES | — | FK → `Employee.id`. Who owned the stage. Populated on all 30,399 rows. |
| `started_at` | timestamp | YES | `CURRENT_TIMESTAMP` | Stage start. |
| `finished_at` | timestamp | YES | — | Stage end (NULL on 2,427; before-start on 1,929). |
| `transaction_status` | enum `TransactionStatus` | YES | — | Overall transaction status at the time. |
| `start_status` | enum `TimerStatus` | YES | — | Stage/status the timer started in. |
| `finish_status` | enum `TimerStatus` | YES | — | Stage/status it finished in (NULL = still open). |
| `transaction_id` | text | NO | — | FK → `Transaction.id`. |

### Enum values

**`TimerStatus`** (used by `start_status` / `finish_status`) — full pipeline of micro-stages:
`ONBOARD, WALKIN, WALKOUT, ESTIMATION_PENDING, VALUATION_PENDING, VALUATION_COMPLETED, SALES_NEGOTIATION_PENDING, SALES_NEGOTIATION_COMPLETED, SALES_NEGOTIATION_REJECTED, SALES_SERVICE_CHARGE_PENDING, SALES_SERVICE_CHARGE_COMPLETED, SALES_SERVICE_CHARGE_REJECTED, BRANCH_KYC_PENDING, KYC_MAKER_PENDING, KYC_MAKER_REJECTED, KYC_MAKER_REQUESTED, KYC_MAKER_APPROVED, KYC_CHECKER_PENDING, KYC_CHECKER_REJECTED, KYC_CHECKER_REQUESTED, KYC_CHECKER_APPROVED, KYC_PENDING, KYC_REJECTED, KYC_REQUESTED, QUOTATION_PENDING, REVALUATION_PENDING, REVALUATION_COMPLETED, REVALUATION_REQUESTED, PLEDGE_ESTIMATION_PENDING, SALES_PLEDGE_PENDING, SALES_PLEDGE_REJECTED, SALES_PLEDGE_APPROVED, RELEASE_PENDING, RELEASE_AGREEMENT_PENDING, PENNY_DROP_PENDING, FINAL_PAYMENT_PENDING, RELEASE_PAYMENT_PENDING, RELEASE_PAYMENT_COMPLETED, FINAL_PAYMENT_COMPLETED, SALES_RELEASE_PENDING, SALES_RELEASE_REJECTED, SALES_RELEASE_COMPLETED, FINANCE_RELEASE_PENDING, FINANCE_RELEASE_COMPLETED, FINANCE_RELEASE_REJECTED, PICKUP_PENDING, SALES_PAYMENT_PENDING, SALES_PAYMENT_REJECTED, SALES_PAYMENT_COMPLETED, ESTIMATION_COMPLETED, OCR_INPROGRESS, OCR_COMPLETED, OCR_FAILED`

**`TransactionStatus`** (used by `transaction_status`; this is the master transaction-status enum, shared with the `Transaction` table):
`WALKIN, WALKOUT, ESTIMATION_PENDING, VALUATION_PENDING, BRANCH_KYC_PENDING, KYC_PENDING, QUOTATION_PENDING, KYC_REJECTED, KYC_REQUESTED, REVALUATION_PENDING, PENNY_DROP_PENDING, FINAL_PAYMENT_PENDING, SALES_APPROVAL_PENDING, SALES_HEAD_APPROVAL_PENDING, SALES_NEGOTIATION_PENDING, REVALUATION_COMPLETED, FINAL_PAYMENT_COMPLETED, PLEDGE_ESTIMATION_PENDING, RELEASE_AGREEMENT_PENDING, RELEASE_PENDING, RELEASE_PAYMENT_PENDING, SERVICE_CHARGE_APPROVAL_PENDING, PLEDGE_APPROVAL_PENDING`

Most-frequent `transaction_status` in Timer: KYC_PENDING (5,784), ESTIMATION_PENDING (5,547), BRANCH_KYC_PENDING (4,160), QUOTATION_PENDING (3,044), WALKIN (2,623).

### PK / FK
- **PK:** `id`. **Out FKs:** `employee_id` → `Employee.id`, `transaction_id` → `Transaction.id`. **In FKs:** none.

### 3 masked sample rows (all from one transaction, showing the intended chained-stage design)
```
transaction_id 5a0fdfc9-…, employee 7ae9da51-…
 QUOTATION_PENDING   started 2026-04-04 07:01:14  finished 07:01:15  → PENNY_DROP_PENDING
 PENNY_DROP_PENDING  started 2026-04-04 07:01:26  finished 07:01:48  → FINAL_PAYMENT_PENDING
 FINAL_PAYMENT_PENDING started 2026-04-04 07:03:06  finished NULL (never closed)
```
(Design was a chain of stage rows per transaction; busiest transaction has 43 stage rows. But coverage collapsed after Sept 2025.)

---

## 3. `ApiKey` — external lead-ingestion API keys

### Purpose
Bearer keys for external partners/campaigns to POST leads into the CRM's telesales webhook. All 6 keys grant the single scope `telesales:external:lead:create`.

### Row count: 6 (all `is_active=true`).

### Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (UUID). |
| `keyHash` | text | NO | — | bcrypt hash (`$2b$10$…`) of the API key. Raw key never stored. |
| `client` | text | NO | — | Client/campaign name (e.g. `JUSTDIAL`, `WEBFORM`, `Meta - WG Money - ENG`). |
| `description` | text | YES | — | Human description of the source. |
| `is_active` | boolean | NO | `true` | Whether the key is accepted. |
| `allowed_ips` | text | YES | — | IP allowlist (all NULL = no IP restriction). |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Key creation. |
| `updated_at` | timestamp | NO | — | Last update. |
| `expires_at` | timestamp | YES | — | Expiry — set to year **4763/4764** (i.e. effectively never expires). |
| `last_used_at` | timestamp | YES | — | Last successful auth; all 6 used within the last hours (all live). |
| `resources` | text | YES | — | Scope string; all = `telesales:external:lead:create`. |

### The 6 keys

| client | description | created | last_used |
|---|---|---|---|
| JUSTDIAL | JUSTDIAL leads | 2025-12-22 | live |
| WEBFORM | WEBFORM leads | 2025-12-22 | live |
| Meta - WG Money - ENG | Meta WG English Campaign | 2026-07-03 | live |
| Meta - WG Money - KANNADA | Sell Gold Leads – 16/06 | 2026-07-03 | live |
| Meta - WG Money - MALAYALAM | Sell Gold Leads – 16/06 (v1) | 2026-07-03 | live |
| Meta - WG Money - TELUGU | Sell Gold Leads – 16/06 (v1) | 2026-07-03 | live |

- **PK:** `id`. **In FK:** `ApiKeyUsage.api_key_id` → `ApiKey.id`.

---

## 4. `ApiKeyUsage` — inbound lead-webhook request log

### Purpose
One row per external API request (audit/rate-tracking) against the lead webhook. Essentially an access log for the 6 keys above.

### Row count: 206,932 (live). `requested_at` range: 2025-12-22 → present.

### Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (UUID). |
| `api_key_id` | text | NO | — | FK → `ApiKey.id`. |
| `endpoint` | text | NO | — | Path hit — **100% `/v1/telesales/webhooks/leads`**. |
| `method` | text | NO | — | HTTP method — all `POST`. |
| `ip_address` | text | NO | — | Caller IP (e.g. `206.189.137.169`, a DigitalOcean egress). |
| `userAgent` | text | YES | — | UA string — all NULL in practice. |
| `status_code` | integer | NO | — | Response code. **206,933× `201`, 1× `400`.** Near-perfect success. |
| `requested_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Request time. |

### Volume by key
`WEBFORM` 201,387 (97% of all traffic) · `JUSTDIAL` 4,403 · Meta-KANNADA 418 · Meta-ENG 336 · Meta-MALAYALAM 212 · Meta-TELUGU 178.

- **PK:** `id`. **Out FK:** `api_key_id` → `ApiKey.id`. **In FKs:** none.

### Masked samples
```
api_key_id WEBFORM-key, POST /v1/telesales/webhooks/leads, ip 206.189.137.169, 201, 2026-08-06 01:42:32
api_key_id WEBFORM-key, POST /v1/telesales/webhooks/leads, ip 206.189.137.169, 201, 2026-08-06 01:41:55
api_key_id WEBFORM-key, POST /v1/telesales/webhooks/leads, ip 206.189.137.169, 201, 2026-08-06 01:41:51
```

---

## 5. `Qandle` — HRMS employee master (Qandle integration)

### Purpose
Mirror of the company's **Qandle HRMS** employee roster. Master source of employee identity/status/department/PAN, keyed by `emp_id` (the `WGxxxxx` codes used everywhere else in the CRM). Refreshed nightly (see timestamps — `updated_at` moves daily at ~22:30 UTC).

### Row count: 870. Coverage: email 870/870, phone 868, PAN 830; `relieved_at` **0 populated** (relieve date not synced — status is tracked via `employee_status` instead). `created_at` range 2025-12-22 → 2026-08-04; `updated_at` max 2026-08-05 (nightly refresh confirmed).

### Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (UUID). |
| `first_name` | text | NO | — | Employee first name. |
| `last_name` | text | NO | — | Employee last name. |
| `employee_status` | text | NO | — | HR status — see values below. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Row first synced. |
| `updated_at` | timestamp | NO | — | Last sync refresh (moves nightly). |
| `phone` | text | YES | — | Mobile (e.g. `+91 …`). |
| `email` | text | YES | — | Work/personal email. |
| `pan_number` | text | YES | — | PAN (tax ID) — PII. |
| `designation` | text | YES | — | Job title (e.g. Assistant Branch Manager). |
| `department` | text | YES | — | Department (see distribution). |
| `emp_id` | text | NO | — | `WGxxxxx` employee code — the join key to `Employee`, `File.updated_emp_id`, payments, etc. |
| `relieved_at` | timestamp | YES | — | Relieve date — **never populated**. |
| `branch` | text | YES | — | Branch (mostly NULL; `location` is used instead). |
| `location` | text | YES | — | Work location, e.g. `KL-KANHANGAD`, `KL-KADAVANTHRA`. |
| `date_of_joining` | timestamp | YES | — | DOJ — NULL in samples. |

### `employee_status` values
Relieved 329 · Confirmed 300 · On Probation 217 · Absconding 11 · Terminated 11 · Pending 2. (So ~518 active = Confirmed + On Probation + Pending.)

### `department` values (top)
Branch Sales 432 · Pre Sales 79 · Admin 69 · Sales 66 · Finance 45 · Operations 43 · Marketing 24 · HR 23 · IT 15 · Verification 15 · Housekeeping 14 · Retail 12 · Corporate Service 10 · Founder's Office 6 · Legal 4 · BOD 3 · (+ a few blanks / one-offs).

- **PK:** `id`. No DB-level FKs (stand-alone mirror; joins to `Employee` are logical, on `emp_id`).

### 3 masked samples
```
emp_id WGxxxxx  Name Name  On Probation  Assistant Branch Manager  Branch Sales  KL-KANHANGAD   phone <masked>  email <masked>  pan <masked>
emp_id WGxxxxx  Name Name  On Probation  Assistant Branch Manager  Branch Sales  KL-KADAVANTHRA phone <masked>  email <masked>  pan <masked>
emp_id WGxxxxx  Name Name  On Probation  Assistant Branch Manager  Branch Sales  KL-ALAPPUZHA   phone <masked>  email <masked>  pan <masked>
```

---

## 6. `Place` — geographic locality master

### Purpose
Lookup list of place/locality names (customer's area, used in lead/customer forms). Simple name master, no hierarchy.

### Row count: 588. Frozen: `created_at`/`updated_at` all fall **2025-06-18 → 2025-09-04** — no new places added since Sept 2025. No duplicate names.

### Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK (UUID). |
| `name` | text | NO | — | Locality name (e.g. `Abids`, `Adivivaram`, `Airport`, `Akkayyapalem`). Values skew Andhra/Telangana/coastal — a Visakhapatnam-region master. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Row creation. |
| `updated_at` | timestamp | NO | — | Last update. |

- **PK:** `id`. No FKs in or out (referenced only by name/string elsewhere, if at all).

### Samples
`104 Area`, `Abids`, `Adivivaram`, `Agiripalli`, `Airport`, `Ajit Singh Nagar`, `Akarampalli`, `Akkayyapalem`.

---

## 7. `AuditTrails` — EMPTY

### Purpose (intended)
Per the migration history (`20240716173619_audit_trails`, `20240716175508_changed_audit_type`, `20240716180135_added_error_message_audit`), this was designed as a request/action audit log — IP, action, HTTP method, user role, emp_id, duration, JSON payload, status code, error message.

### Row count: **0 — never populated.** The feature was migrated in but never wired up (or writes were disabled).

### Columns (for completeness)

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text | NO | — | PK. |
| `ip_address` | text | YES | — | Caller IP. |
| `action` | text | YES | — | Action/route name. |
| `method` | text | YES | — | HTTP method. |
| `user_role` | text | YES | — | Role of the actor. |
| `emp_id` | text | YES | — | Acting employee. |
| `duration` | text | YES | — | Request duration. |
| `payload` | jsonb | YES | — | Request/response payload. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | When logged. |
| `status_code` | integer | YES | — | Response code. |
| `error_message` | text | YES | — | Error text if failed. |

- **PK:** `id`. No FKs. **Do not rely on this table for auditing — it is empty.** (Real inbound-request auditing exists only for the lead webhook, via `ApiKeyUsage`.)

---

## 8. `_prisma_migrations` — schema evolution history

### Purpose
Prisma's migration bookkeeping table. Documents the entire schema history of the NEW CRM. 347 migrations, all applied (no `rolled_back_at` set), each `applied_steps_count = 1`.

**Interesting artifact:** migration *names* are dated from `20240430…` (30 Apr 2024) onward, but every `started_at`/`finished_at` clusters on **2025-06-19** — i.e. the full back-catalog of ~200+ migrations was replayed in one batch when this production DB was (re)provisioned on 19 Jun 2025. Migrations authored after that date apply on their real dates.

### Column set
`id` (varchar), `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at` (default `now()`), `applied_steps_count`.

### Earliest migrations (schema genesis — Apr–Jun 2024, HR/employee + core buying model)
`20240430142833_updated_fields_employee_branches` · `20240430143304_updated_employeerecord_300424` · `20240505124338_050524_added_password_emp` · `20240508144854_region_branch` · `20240514205911_150524_customer_schema_changes` · `20240515081227_add_transaction_type_enum` · `20240531111034_adds_ornament_and_more_attributes_to_estimation` · `20240605085524_new_enums_for_employee_roles` · `20240611050551_adds_gold_rate` · `20240613111823_add_kyc_and_document_model` · `20240716123145_add_quotation_model` · `20240716173619_audit_trails` · `20240722105244_add_maker_call_recording_to_kyc` · `20240726091109_add_payment_model` · `20240808122213_add_leads_and_call` — i.e. employee → transaction → estimation → KYC/document → quotation → payment → leads, in that order.

### Most recent ~25 migrations (chronological — recent schema evolution)
```
20260331190201_added_downloads_application_form           (applied 2026-04-05)
20260420201249_added_targets_schema                       (2026-04-21)   ← sales targets
20260430100710_                                           (2026-05-04)
20260514125931_add_logged_in_at_to_employee              (2026-05-22)
20260515080247_renamed_thresholds_to_settings            (2026-05-22)
20260515114829_modified_settings_schema                  (2026-05-22)
20260520182620_rename_margin_22k_to_rate_22k             (2026-05-22)
20260520183322_made_margin_22k_optional                  (2026-05-22)
20260601132436_add_ornament_delta                        (2026-06-09)
20260606005908_resync_customer_id_sequence               (2026-06-09)
20260606180045_add_lead_mobile_status_composite_index    (2026-06-09)   ← perf/index
20260607190844_add_ornament_indexes                      (2026-06-09)
20260608000000_add_performance_indexes                   (2026-06-09)
20260608104202_                                          (2026-06-09)
20260608110715_added_spectro_file_index                  (2026-06-09)   ← File spectro index
20260608140857_added_transaction_branch_id_index         (2026-06-09)
20260614171128_add_cascade_delete_to_transaction_relations (2026-06-15) ← cascade deletes
20260614171613_add_cascade_delete_to_kyc_relations       (2026-06-15)
20260614171708_add_cascade_delete_to_agreement_release_relation (2026-06-15)
20260701194014_added_call_meta_data                      (2026-07-02)
20260714131707_added_is_offline_gold_rates               (2026-07-21)   ← offline gold rate flag
20260714152149_added_updated_by_to_gold_rate             (2026-07-21)   ← LATEST migration
```
The recent arc: **May–Jun 2026 was a performance push** (a cluster of index-adding migrations incl. a spectro-File index) plus a **cascade-delete hardening** pass (Jun 15) on Transaction/KYC/Agreement relations; Jul 2026 added call metadata and gold-rate offline/updated-by fields. Latest applied migration: **`20260714152149_added_updated_by_to_gold_rate`**.

---

## 9. How GoldApp uses this cluster

Grep across `app/`, `lib/`, `scripts/`, `components/` for these table names returns **no direct references** — GoldApp does not read or write `File`, `Timer`, `Qandle`, `ApiKey`, `ApiKeyUsage`, `Place`, `AuditTrails`, or `_prisma_migrations`. Specifically:

- **`Timer` — deliberately avoided.** `app/api/productivity/route.js` (the productivity module) reconstructs each pipeline stage's timing from **artifact `created_at`/`updated_at`**, joining `Transaction` to `Estimation`, `Quotation`, `Payment`, `Order`, `KycLog`(via `Kyc`), `Release`, and `Agreement` — never `Timer`. This directly corroborates the memory note "Timer table is dead; reconstruct stage timing from artifact created_at." Our data confirms *why*: Timer stopped being populated after Sept 2025 and 14% of its rows have broken/negative durations.
- **`Qandle`** — GoldApp reads employee identity from the CRM's `Employee` table (and its own branch-employee sync), not from `Qandle`. Qandle is the CRM's internal HRMS mirror.
- **`File`** — GoldApp does not render CRM images; it syncs purchase/financial data only (`scripts/sync-new-crm.mjs` touches none of these). File remains a CRM-internal asset store.
- **`ApiKey` / `ApiKeyUsage`** — purely CRM-side (external lead ingestion into the CRM's telesales webhook); GoldApp is unrelated.
- **`Place`** — CRM lead-form lookup only; unused by GoldApp.
- **`AuditTrails`** — empty; nothing to use.

**Takeaways for future work:** (1) Treat `Timer` as dead — never source stage durations from it. (2) `AuditTrails` is a no-op empty table — the only real inbound audit log is `ApiKeyUsage` (lead webhook). (3) `File` is the one high-value table here: the polymorphic image store, best reached via the specific `*_id` FK for each capture step (`ornament_id`/`spectro_ornament_id` for ornament photos, `front_document_id`/`back_document_id` for KYC scans), with S3 keys in `name`/`thumb`. (4) `estimation_total_ornament_id` and `maker_recording_id` are effectively unused columns. (5) `Qandle` is the authoritative employee status/department/PAN source (keyed on `emp_id`), refreshed nightly, if HR attributes are ever needed.
