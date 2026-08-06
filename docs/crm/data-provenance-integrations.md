# NEW CRM — Data Provenance & External Integrations

> **Purpose.** Where the NEW CRM's data *originates*: the ingestion pipelines and third-party integrations that write into `dbwhitegold_production`. This is a companion to [00-CRM-MASTER.md](00-CRM-MASTER.md) and the cluster docs — it does **not** re-dump the schema; it traces each table back to the external system (or human process) that produces its rows, with queried evidence.
>
> **Method.** Read-only (`SELECT` only) against the live prod RDS as user `nighthack`. The CRM's own **application source code is not available** — provenance is inferred from the DB itself plus integration fingerprints (id prefixes like `pout_`/`cont_`/`fa_`, callback URLs, GSTINs, API-key clients, S3 key prefixes, migration names). Every inference is flagged as such.
> **Snapshot:** 2026-08-06 (counts drift upward as prod keeps writing). Identifiers PascalCase & quoted.

---

## External integrations at a glance

| Integration | Vendor / system | Direction | CRM tables it writes/feeds | Live? | Evidence anchor |
|---|---|---|---|---|---|
| **Lead webhook** | WEBFORM / JUSTDIAL / Meta Lead-Ads (via a DigitalOcean relay) | **Inbound** | `ApiKey`, `ApiKeyUsage`, `Lead`, `Call`, `CallHistory`, `LeadHistory`, `AssignmentGroup`, `Assignment`, `Notification` | ✅ Live (206.9k requests, live to snapshot) | §1 |
| **Telephony / dialer** | (unnamed provider — raw `call_id`, `action` codes, `recording_url`) | Inbound | `Call`, `CallHistory` | ✅ Live (391k / 496k rows) | §2 |
| **Gnani.ai voicebot (CRM table)** | Gnani.ai | Inbound | `Gnani` (+ `Call.gnani_id`) | ⛔ **Dormant** — 57-row pilot, one day, all PENDING | §2 |
| **Gnani.ai voicebot (live path)** | Gnani.ai → **S3** | Inbound (bypasses CRM) | *none in CRM* — lands in GoldApp Supabase `telesales_calls` | ✅ Live (GoldApp-side) | §2 |
| **XRF Spectrometer** | Physical purity-tester device + sync service | Inbound (device→server) | `Spectrometer`, `Ornament.purity`, `File` (`spectrometer/`) | ✅ Live (928 rows, live to snapshot) | §3 |
| **RazorpayX payouts** | Razorpay (RazorpayX) | **Outbound $** | `Payment` (FINAL_PAYMENT, PENNY_DROP) | ✅ Live | §4 |
| **Razorpay penny-drop / fund-account** | Razorpay | Bidirectional verify | `Payment` (PENNY_DROP), `BankAccount` | ✅ Live | §4 |
| **Offline bank transfer (NBFC releases)** | Manual ops | Outbound $ | `Payment` (RELEASE_PAYMENT, OFFLINE) | ✅ Live (RazorpayX release path retired Dec 2025) | §4 |
| **S3 object store** | AWS S3 | Bidirectional | `File` (~270k), `Invoice.file_name`, `TaxInvoice.file_name`, `Agreement.name`, `Spectrometer` images | ✅ Live | §5 |
| **Talkument OCR** | External OCR/LLM service → callback to CRM KYC API | Inbound (async) | `Talkument`, `Kyc.ocr_status`, `Document` | ✅ Live (285 rows, live to snapshot) | §5 |
| **GST e-invoice / e-way bill** | ClearTax/NIC *(inferred)* | Bidirectional | `TaxInvoice`, `EWayBill` | ⚠️ TaxInvoice live; EWayBill last generated 2026-04-16 | §6 |
| **UPI collect (service fee)** | WG HDFC VPA | Inbound $ | `QRCode` | ✅ Live | §6 |
| **Qandle HRMS** | Qandle | Inbound (nightly mirror) | `Qandle` (feeds `Employee` logically by `emp_id`) | ✅ Live (nightly ~22:30 UTC) | §7 |
| **Gold rate feed** | Ops-entered (+ provisioned live/offline flag) | Inbound | `GoldRate` | ✅ Live (ops-set; feeds Estimation/GoldApp Live Rates) | §8 |
| **Prisma / RDS** | Prisma ORM on AWS RDS Postgres | Platform | `_prisma_migrations` (+ all tables) | ✅ 347 migrations | §9 |
| **OLD CRM (MySQL) migration** | one-time backfill | Historical | `Blocklist` (2021 rows), `OLD*` tables (empty) | Historical / dormant | §9 |

**Dormant / legacy at a glance:** `Gnani` (CRM table), `Timer`, `AuditTrails` (0 rows), `OLDTransaction`/`OLDKyc`/`ApplicationForm`/`CustomerForm` (0 rows), the entire bidding module (`Purchase`/`Batch`/`Bid`/`Bidder`, 0 rows), `Place` (frozen Sept 2025), and the RazorpayX **release** payout path (last used 2025-12-05).

---

## 1. Lead ingestion (inbound)

### 1.1 The webhook
All external lead ingestion enters through **one endpoint**:

```
POST /v1/telesales/webhooks/leads     → 201 Created
```

Authenticated by a **bearer `ApiKey`** (bcrypt-hashed `keyHash`, scope `telesales:external:lead:create`). Every request is logged in `ApiKeyUsage` (206,932 rows; an access log, not the lead itself). The 6 keys and their traffic (queried):

| client (ApiKey) | requests (status 201) | first → last | live? |
|---|---:|---|---|
| **WEBFORM** | 201,581 (97.4%) | 2025-12-22 → snapshot | ✅ |
| **JUSTDIAL** | 4,407 (+1× `400`) | 2025-12-22 → snapshot | ✅ |
| Meta - WG Money - KANNADA | 420 | 2026-07-03 → snapshot | ✅ |
| Meta - WG Money - ENG | 337 | 2026-07-03 → snapshot | ✅ |
| Meta - WG Money - MALAYALAM | 213 | 2026-07-09 → snapshot | ✅ |
| Meta - WG Money - TELUGU | 180 | 2026-07-03 → snapshot | ✅ |

- **Endpoint/method/status are uniform:** 100% `POST /v1/telesales/webhooks/leads`; **206,937× `201`, 1× `400`** (a single malformed JUSTDIAL call on day one). `userAgent` is always NULL; caller IP is a **DigitalOcean egress** (`206.189.137.169`) — i.e. an intermediary relay service marshals WEBFORM/JUSTDIAL/Meta leads and re-POSTs them to the CRM, rather than each source calling directly *(inferred from the single shared egress IP + NULL UA)*.
- **Meta/Facebook** keys were provisioned 2026-07-03 (one per language campaign) — a recent channel addition. The `Call.meta_*` columns (`meta_ad_id`, `meta_campaign_name`, `meta_lead_id`…) are the schema landing zone for Meta Lead-Ads attribution but are still **100% NULL** — provisioned ahead of population.

### 1.2 What a raw vs enriched lead carries
A **raw inbound** lead/call arrives as a thin webform payload. Evidence — `Call.metadata` on WEBFORM inbounds: `{"name":"Live Gold API Lead","mobile":"6303069622","utm_medium":"","utm_source":"","utm_campaign":""}`, `status=PENDING`, `action=ASSIGNED`, `lead_id=NULL` (not yet tied to a `Lead`). 122,767 of 391k `Call` rows are still lead-unlinked (raw).

An **enriched** `Lead` (after a telecaller works it) additionally carries: `customer_name`, `approx_gross_weight`, `transaction_type` (PHYSICAL vs RELEASED), `branch_id`/`visited_branch_id`, `status` progression, `survey`/`survey_advertisement` (marketing channel), `invalid_reason`/`not_sold_reason`, and on conversion a **1:1 `transaction_id`** into `Transaction`. Only **2.8%** of leads convert; ~46% end `INVALID`.

- `Lead.survey` is the **marketing-source** field (free text, richer than the API-key client): `Website` 47,403 · `WEBFORM` 16,185 · `Kerala Leads` 13,511 · `Andhra Pradesh Calls` 11,436 · `Call Back` · `ROK Bus Campaign` 3,000 · `BMTC Bus Campaign` 2,224 · `JUSTDIAL` · `Zee Kannada`/`Colors Kannada`/`TV 9`/`News 18` (TV) · `Signage`. So digital dominates, then regional call lists, bus-wrap campaigns, TV.

### 1.3 Routing — AssignmentGroup → Assignment
Inbound leads are bucketed by **`AssignmentGroup`** (6 rows = the 6 channels: WEBFORM, JUSTDIAL, and the four Meta campaigns) and routed to a telecaller via **`Assignment`** (9 rules: `group_id` → `assignee_id` (emp) with a `reporter_id` supervisor and a cumulative `cases` counter). Queried map:

| group | assignee → reporter | cases routed |
|---|---|---:|
| WEBFORM | WG00589 → WG00935 | 11,899 |
| WEBFORM | WG01084 → WG00190 | 1,131 |
| JUSTDIAL | WG00589 → WG00935 | 996 |
| Meta - MALAYALAM | WGINT-0027 → WG00328 | 209 |
| Meta - TELUGU | WG01021 → WG00328 | 173 |
| Meta - KANNADA | WG00752 / WG00986 → WG00328 | 9 / 9 |
| Meta - ENG | WG00986 / WG00752 → WG00328 | 5 / 5 |

The `cases` counters corroborate the webhook volumes (WEBFORM ≫ JUSTDIAL ≫ Meta) and show WG00328 supervises the entire Meta desk. `Notification` (118k rows, employee work-queue signals, `title='Followup Reminder'` for the lead side) is the downstream ping layer as leads/transactions advance.

---

## 2. Calling / voicebot

### 2.1 Telephony (live, the real pipeline)
`Call` (391,347) and `CallHistory` (496,344) are the highest-volume operational tables. Provenance = an **external telephony/dialer provider**: each `Call` has a provider `call_id` (UNIQUE), a raw `action` free-text code (`ANSWER`, `BUSY`, `ASSIGNED`, `NOANSWER`, `Executive Busy`, `RINGING`, `CONNECTING`) that the CRM normalises into the `status` enum (`ANSWERED`/`RNR`/`PENDING`/`REPEATED_CALL`), plus `recording_url`, `call_direction` (INCOMING 216k / OUTGOING 175k) and `disconnected_by` (Customer / Executive). Who dials: the calling team (`employee_id` → `Employee.emp_id`); inbound calls arrive from the webform/IVR. `CallHistory` denormalises a `lead_*` snapshot + `is_fresh_call`/`is_followup_call` flags for productivity analytics. *(The specific telephony vendor isn't named in the DB — inferred as a single provider from the uniform `call_id`/`action` vocabulary.)*

### 2.2 Gnani.ai — DORMANT in the CRM
`Gnani` (57 rows) is the CRM-side record for the **Gnani.ai** conversational-voicebot: transcript, sentiment, emotion, `analytics_score`/`qa_score`, VALID/INVALID `status`, detected `language`. Queried state:
- **All 57 rows: `processing_status=PENDING`**, `transcript`/`status`/`language` all NULL, created in a **single window on 2026-02-18**. The joined `Call` rows are real (ANSWERED/INCOMING). **Verdict: a one-day pilot that never completed** — the CRM's Gnani analytics pipeline is dormant.

### 2.3 Gnani — the live path runs via S3, not this table
The live voicebot pipeline **bypasses the CRM `Gnani` table entirely.** GoldApp's `app/api/sync-gnani/route.js` pulls voicebot recordings (`.tar.gz` of `.mp3` + `metadata.json`) from the **`whitegold-call-recordings` S3 bucket** and writes to a **Supabase `telesales_calls`** table (`gnani_call_id`, `customer_number`, `language`, `duration_seconds`, `call_disposition`, `summary`, `recording_url`, `outcome`). So Gnani data is real and live, but its system of record is S3 → GoldApp Supabase — the 57-row CRM `Gnani` table is a stranded pilot. *(This is the one place where "the live pipeline runs via S3 recordings rather than the Gnani table" is directly confirmed in GoldApp code.)*

---

## 3. Valuation devices

### 3.1 Spectrometer (XRF) — LIVE
`Spectrometer` (928 rows) is the CRM-side capture of a **physical XRF purity-tester**. Evidence it's a device:
- `request_json` carries device output keyed `{id, karat, purity, gross_weight, ornament_type, spectrometer_image}` where `spectrometer_image` is a **base64 JPEG of the tester readout**; `response_json` is the derived ornament shape. Values like `karat 22.021 / purity 91.75` and `karat 18.041 / purity 75.17` are raw XRF readings (purity% ≈ karat/24×100).
- `sync_status` (`PENDING`→`SYNCED`→`ACKNOWLEDGED`) + `can_subscribe` are a **device↔server handshake** — the fingerprint of hardware syncing to the CRM.

Coverage/recency (queried): **928 PENDING, 6 SYNCED, 0 ACKNOWLEDGED**; live 2026-04-05 → snapshot (Jun 388, Jul 227, Aug 21 rows/month). 776 distinct customers; 608 rows linked to an Estimation, 317 to a Quotation. So the device **actively feeds readings**, but the SYNCED/ACKNOWLEDGED handshake states are barely used — nearly everything stays `PENDING` even though the reading lands. Spectrometer images also flow to S3 (`spectrometer/` prefix — see §5, 32,635 objects).

### 3.2 Manual assayer entry & the purity margin lever
Where the spectrometer isn't used (or as the human overlay), the **Gold Assayer** enters purity manually into `Ornament` (`purity`, `purity_value` = tested fineness; `assayer_status`, `valuated_by_id`, `approved_by_id`). The load-bearing provenance distinction for money:
- **`Ornament.purity` (tested)** = spectrometer/assayer reading (e.g. 91.84).
- **`Ornament.branch_purity` (agreed/paid)** = the fineness actually paid on (e.g. 91.60), agreed at the branch.
- The gap `purity − branch_purity` is a deliberate **margin lever** (§3A of the master doc). Only `branch_purity` reconciles the payout math (49,538 rows match on `branch_purity` vs 18,590 on `purity`).

---

## 4. Payments (money out)

`Payment` (21,337+) is the money-out ledger. Provenance is split between **RazorpayX** (automated payouts) and **OFFLINE** (manual bank transfer). Razorpay fingerprints on the row: `pay_id=pout_…` (RazorpayX payout id), `customer_id=cont_…` (Razorpay contact), `fund_id=fa_…` (tokenised fund account), `utr` (bank UTR), `provider_status` (`processed`/`processing`/`reversed`/`failed`/`queued`).

Queried distribution by type × action × processor (with automation fingerprints):

| type | action | processor | rows | UTR | pay_id | note |
|---|---|---|---:|---:|---:|---|
| PENNY_DROP | DEBITED | RAZORPAY | 10,485 | 9,970 | 10,485 | ₹1 bank verification — **all Razorpay** |
| FINAL_PAYMENT | DEBITED | RAZORPAY | 9,013 | 8,988 | 9,012 | **automated RazorpayX payout to customer** |
| FINAL_PAYMENT | DEBITED | OFFLINE | 786 | 786 | 15 | manual transfer (UTR filled by hand, no `pout_`) |
| RELEASE_PAYMENT | DEBITED | OFFLINE | 1,147 | 0 | 0 | **NBFC release paid manually** (no UTR/pay_id) |
| RELEASE_PAYMENT | DEBITED | RAZORPAY | 75 | 0 | 0 | **retired** — last used 2025-12-05 |
| FINAL_PAYMENT | CREDITED | RAZORPAY | 24 | 0 | 0 | reversal / release-loss (status CONFIRMED) |

**Provenance conclusions (evidence-backed):**
- **FINAL_PAYMENT is automated via RazorpayX** — 92% (9,013/9,799) go through Razorpay with `pout_` ids and UTRs; the 786 OFFLINE are manual fallbacks (UTR entered by hand, almost no `pay_id`). GoldApp matches these UTRs against RazorpayX payouts in `app/api/billed-vs-paid` (`matchPayouts`).
- **RELEASE_PAYMENT is now overwhelmingly OFFLINE/manual** — 1,147 OFFLINE vs 75 RAZORPAY, and the **RazorpayX release path was retired: its last row is 2025-12-05.** Since then every NBFC release is a manual bank transfer (`remarks='Paid'`, no UTR/pay_id). This confirms the memory/master note "RELEASE_PAYMENT mostly OFFLINE" with a date.
- **Penny-drop (₹1) is a Razorpay bank verification** → confirms account number/IFSC and returns the beneficiary name before the big payout. 10,485 rows, all ₹1. Verified accounts land in `BankAccount` (`account_type` CUSTOMER 13,446 / NBFC 510), FK'd from `Payment.bank_account_id`; GoldApp checks the penny-drop-verified account == the final-payout account.
- **What's automated vs manual:** automated = RazorpayX final payouts + penny-drops (Razorpay API); manual = OFFLINE finals (786) and essentially all NBFC releases (1,147). Reversals/release-losses are booked as CREDITED (mostly negative-stored — sign trap documented in master §3C).

---

## 5. Files / assets & OCR

### 5.1 File → S3 (~270k objects)
`File` is the central polymorphic attachment table; the bytes live in **AWS S3**, `File.name` holds the object key and `File.thumb` the thumbnail key. Content types: `image/jpeg` 266,651 · untyped `image` 2,585 · `image/png` 460 · `application/pdf` 213 · `image/webp` 9 · `audio/wav` 1. Provenance-by-S3-prefix (queried `split_part(name,'/',1)`):

| S3 prefix | objects | entity it belongs to |
|---|---:|---|
| `kyc/` | 106,893 | KYC document scans (front/back, customer selfies) |
| `ornaments/` | 93,353 | ornament photos (`Ornament`) |
| `spectrometer/` | 32,635 | XRF tester readout images |
| `documents/` | 21,941 | KYC `Document` proofs |
| `takeover_agreement/` | 6,423 | signed release `Agreement` PDFs |
| `pledges/` | 3,296 | pledge receipts (`PledgeCompany`) |
| `customers/` | 2,567 | customer photos |
| `payout_form/` | 2,447 | payout form scans |
| `payment-screenshots/` + `payment_screenshot/` | 1,310 | payout proofs (`Payment`) |
| `purchase_`, `release_*`, `bank_balance_screenshots/` | ~970 | pledge/release/bank proofs |

Each `File` links to exactly one business entity via one of ~19 nullable `*_id` FK columns (`ornament_id`, `spectro_ornament_id`, `front/back_document_id`, `bankAccountId`, `payment_id`, `agreement_id`, `walkin_id`, …). Also S3-backed: `Invoice.file_name` (`invoice/…pdf`), `TaxInvoice.file_name` (`tax_invoice/…pdf`), `Agreement.name` (`takeover_agreement/…pdf`).

### 5.2 Talkument = OCR jobs — LIVE
`Talkument` (285 rows) records calls to an **external OCR/LLM document-extraction service** that reads KYC documents (Aadhaar/PAN/bank) and returns structured JSON. Provenance fingerprints (queried):
- **Async callback pattern:** `callback_url` = `https://api.whitegold.online/v1/kyc/{kyc_id}/ocr/callback?document_id={id}` — the service posts results back to the CRM's KYC API. `chat_id` = the provider session id (populated on all 285). `prompt` (the extraction instruction) + `response` jsonb (extracted fields).
- **`response` keys observed:** `bank`, `customer`, `document` — i.e. it extracts bank-proof fields, customer identity, and document metadata.
- **Status (queried):** COMPLETED 274, FAILED 11 (all 11 with `error_message`); live **2026-04-04 → snapshot** (COMPLETED to 2026-08-05). Mirrored on `Kyc.ocr_status` (`TalkumentStatus` = INPROGRESS/COMPLETED/FAILED). So OCR is **live and in use** (274 successful extractions), feeding auto-filled KYC/`Document` data — a partial rollout, not dormant. *(Vendor name not in DB; "Talkument" is the internal handle for the OCR service.)*

---

## 6. GST / compliance

### 6.1 TaxInvoice — GST on the service fee (live)
`TaxInvoice` (7,362) is WG's **GST tax invoice on its service fee** (not the gold value — WG buys from an individual so the purchase itself has no output GST; `Invoice` is the plain purchase receipt). Provenance = the CRM's own numbering engine: `number = <STATE-BRANCH>-<MMYY>-<NNNN>` (e.g. `KA-HAS-0826-0013`), with `branch`, `month_year` (`0826`=Aug 2026), and `count` (per-branch, per-month running serial that resets monthly). GST split is 9% CGST + 9% SGST on the fee. This numbering is internal; whether e-invoice IRNs are filed with the GST portal is **not visible in these tables** *(no IRN/QR-signature column here — if e-invoicing exists it lives outside this table; inferred)*.

### 6.2 EWayBill — transport (NIC/ClearTax, inferred; paused)
`EWayBill` (362) is the government **e-way bill** for inter-branch gold transport. Provenance fingerprints: `bill_no` = 12-digit government EWB number, `trans_id = <GSTIN>_<id>_CHL_<year>` where **GSTIN = `29AAPCA3170M1Z5`** (WG Bullion Pvt Ltd, Karnataka `29`), `generated_at`/`bill_validity` from the portal. Queried status: `GENERATED` 354 · NULL 6 · `CANCELLED` 2. **⚠️ Provenance flag: the last EWB was generated 2026-04-16** — no new e-way bills since; the integration appears paused/seasonal (used only for larger consignments, not every purchase; 794 transactions reference an `eway_bill_id`, sharing the 362 bills). The **e-invoice/e-way generation almost certainly goes through ClearTax or the NIC portal** — consistent with the master memory note on ClearTax e-invoice cancel shape — but **this is inferred**; the DB stores only the resulting bill numbers, not the API vendor.

### 6.3 QRCode — UPI collect for the service fee (live)
`QRCode` (7,314) is a UPI-collect QR so the customer pays WG's **service fee + GST** by UPI. `payload` jsonb carries `service_fee`, `cgst`, `sgst`, `total_amount`, WG's `gstin` (`29AAPCA3170M1Z5`), `company_name` (`WHITE GOLD BULLION PVT LTD`), the **payee = WG's HDFC collection account** (`payee_upi_id`/`payee_bank_account`/`payee_ifsc`), and `invoice_number` → `TaxInvoice.number`. URL = `https://crm.whitegold.money/qr/<short_code>`, ~90-day expiry, `click_count`. Money flows **into** WG (opposite direction to FINAL_PAYMENT).

---

## 7. HRMS / org

`Qandle` (870) is a nightly mirror of the company's **Qandle HRMS** employee roster, keyed by `emp_id` (`WGxxxxx`). Provenance = a scheduled sync: queried `created_at` 2025-12-22 → 2026-08-04, and **`updated_at` max 2026-08-05 22:30 UTC** — the nightly ~22:30 UTC refresh is confirmed. It carries `first/last_name`, `employee_status` (Relieved 329 · Confirmed 300 · On Probation 217 · …), `designation`, `department` (Branch Sales 432 · Pre Sales 79 · …), `pan_number`, `email`/`phone`, `location`. It is the **authoritative HR source** (status/department/PAN) that logically feeds `Employee` on `emp_id` (no DB FK — a stand-alone mirror). `relieved_at` is never populated (status tracked via `employee_status` instead).

`Employee`/`Branch`/`State`/`Cluster` are the org masters (see cluster-1). Note `Region` is empty and `Branch.region_id` all NULL — use Cluster/State. `Branch` master is also kept fresh by GoldApp's own `/api/sync-branches-auto` (per memory) — separate from Qandle.

---

## 8. Rates

`GoldRate` (64) is the per-**State** buying rate card (`rate_24k`, `rate_22k`, `rate_17_21k`, `rate_14_17k`, `margin_24k`/`margin_22k` spreads), versioned by insert — newest `created_at` per `state_id` is live. Provenance = **ops-entered** (a human sets the daily card per state), for 5 states (Karnataka, Telangana, Andhra Pradesh, Kerala + one blank-state row).

Queried provenance details:
- **`updated_emp_id` is 0-populated** across all 64 rows and **`is_offline` is all `false`** — these two columns were added by the **July 2026 migrations** (`20260714131707_added_is_offline_gold_rates`, `20260714152149_added_updated_by_to_gold_rate`) but the **latest rate row predates them (max `created_at` 2026-06-24)**, so no live rows carry the new fields yet. The `is_offline` flag is *provisioned* to mark rates captured while the pricing feed is down (the "live-vs-manual split"), but has no data yet.
- **⚠️ `GoldRate.updated_at` is misleading** — the daily-rate write path doesn't bump it, so values are live even when the timestamp is weeks stale (documented gotcha; GoldApp's `scripts/check-rates-freshness.mjs` guards on `created_at`).
- **`margin_24k` on `GoldRate` ≠ `margin_24k` on Estimation** — here it's a small per-gram spread (0/1/100/−984), there it's the full 22K rate. Kerala shows a distinct per-band spread (`rate_22k` 13,497, `rate_17_21k` 13,275) vs the mainland flat floors — the "Kerala per-transaction spread."
- GoldApp reads this table directly as its **Live Rates** source (`app/api/gold-rates`), latest-per-state. (Band labels are mislabelled one level down — see master §5.)

---

## 9. Tech stack & history

- **ORM/platform:** Prisma on **AWS RDS Postgres** (`dbwhitegold_production`, `ap-south-1`). `_prisma_migrations` = 347 migrations, all applied, none rolled back. The DB is **prod RDS**; the `nighthack` cred is full `rds_superuser` R/W, but **GoldApp only ever SELECTs** (read-only by convention).
- **Schema-evolution arc:** migration *names* date from `20240430…` (Apr 2024: employee/branch → transaction → estimation → KYC/document → quotation → payment → leads), but every `started_at`/`finished_at` clusters on **2025-06-19** — the full back-catalog was replayed in one batch when this prod DB was (re)provisioned on 19 Jun 2025; migrations authored later apply on their real dates.
- **Recent arc (queried latest 6):** May–Jun 2026 was a **performance push** (index migrations, incl. a spectro-`File` index) plus a **cascade-delete hardening** pass on Transaction/KYC/Agreement relations (Jun 14–15). Jul 2026 added **`added_call_meta_data`** (2026-07-01, the Meta Lead-Ads columns), **`added_is_offline_gold_rates`** and **`added_updated_by_to_gold_rate`** (both applied 2026-07-20) — the latter is the **most recent migration**.
- **OLD CRM origin:** the OLD CRM is a separate **MySQL** DB; only a one-time backfill reached here — `Blocklist` rows dated back to **2021** (`remarks='OLD CRM Blocked Customer'`), while `OLDTransaction`/`OLDKyc` tables exist but are **empty** (never migrated).

### Live vs dormant/legacy — consolidated
| Status | Tables / integrations |
|---|---|
| **Live ingestion** | Lead webhook (`ApiKey*`, `Lead`, `Call*`), Spectrometer, RazorpayX finals + penny-drops, S3 `File`, Talkument OCR, TaxInvoice + QRCode, Qandle nightly, GoldRate |
| **Dormant / pilot** | `Gnani` (57-row pilot, live path is S3), RazorpayX **release** payouts (retired 2025-12-05), `EWayBill` generation (paused after 2026-04-16), `GoldRate.is_offline`/`updated_emp_id` (provisioned, no data), `Call.meta_*` (provisioned, all NULL) |
| **Dead / legacy** | `Timer` (dead after Sept 2025), `AuditTrails` (0 rows), `OLDTransaction`/`OLDKyc`/`ApplicationForm`/`CustomerForm` (0 rows), bidding module `Purchase`/`Batch`/`Bid`/`Bidder` (0 rows), `Place` (frozen Sept 2025) |

---

*Read-only from `dbwhitegold_production`, 2026-08-06. Vendor names for the telephony provider, e-invoice/e-way gateway (ClearTax/NIC), and the OCR service are **inferred** from id/URL/GSTIN fingerprints — the CRM application source was not available; the DB stores results, not the API client. All counts are live and drift upward.*
