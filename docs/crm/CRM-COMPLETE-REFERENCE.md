# White Gold — NEW CRM · Complete Technical Reference

> Single consolidated reference for the entire NEW CRM (Prisma + Postgres/RDS). Covers every table, column, enum, view, function, relationship, calculation, lifecycle and data source. Built from a live read-only schema pull + evidence-backed sub-analyses.
>
> **Scope:** 69 base tables · 1 reporting view · 901 columns (100% documented) · 128 foreign keys · 42 enum types · 6 ID-minting functions · 3 sequences · ~2.32 M rows.
>
> **Boundary:** the NEW CRM owns the customer journey up to and including the purchase (final payment / invoice); GoldApp takes over post-purchase (consignments, bidding, margins, reports). Read-only downstream — GoldApp never writes to the CRM.

---

<a id="part-toc"></a>

## Table of contents

0. [Part 0 — Overview, Architecture, Money-Math & Reports Blueprint](#part-0)
1. [Part 1 — Reference & Org (Employee, Branch, Roles, States)](#part-1)
2. [Part 2 — Lead & Calling Funnel](#part-2)
3. [Part 3 — Transaction, Walk-in, KYC & Customer (the hub)](#part-3)
4. [Part 4 — Valuation & Pricing (the margin engine)](#part-4)
5. [Part 5 — Payment & Billing](#part-5)
6. [Part 6 — Post-purchase Gold (Release / Pledge / Melting)](#part-6)
7. [Part 7 — System & Misc](#part-7)
8. [Part 8 — Data Provenance & External Integrations](#part-8)
9. [Part 9 — DB Objects: Reporting View, Functions & Sequences](#part-9)

---


<a id="part-0"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 0 — Overview, Architecture, Money-Math & Reports Blueprint
# ═══════════════════════════════════════════

# White Gold — NEW CRM: complete technical reference

> **Purpose.** Exhaustive map of the NEW CRM Postgres database — every table, field, enum, relationship, lifecycle and calculation. The NEW CRM owns the customer journey **up to and including the purchase**; **GoldApp takes over post-purchase** (inventory movement, consignments, bidding/booking, margins, reports & analytics). The hand-off point is the **final payment / invoice** (a purchase belongs to its final-payment day == invoice date).
>
> Generated from a live read-only schema pull. **69 base tables · 1 reporting view · 901 columns · 128 foreign keys · 42 enum types · 6 ID-minting functions · 3 sequences · ~2.32 M rows.** Deep field-level detail per area lives in the cluster docs (see §Cluster docs); the view + functions are in [db-objects-views-functions.md](#part-toc).

## 1. Architecture at a glance

- **`Transaction`** is the spine of the CRM: one row per customer deal/visit. Almost every business table foreign-keys to `Transaction.id` (Walkin, Kyc, Estimation, Quotation, Payment, Invoice, TaxInvoice, Order, Release, ActionControl, Notification, Timer, BankAccount, EWayBill…).
- **Reference entities:** `Customer` (the person), `Employee` (staff), `Branch` (→ `Cluster`/`Region`/`State`), `Companies` (finance/NBFC partners for takeovers).
- **Two deal types** (`TransactionType`): `PHYSICAL_GOLD` = the customer sells their own gold (a normal purchase); `RELEASED_GOLD` = White Gold pays off the customer's gold loan at a finance company and takes over the pledged gold (a "takeover / release").
- **Org hierarchy:** State → Region → Cluster → Branch → Employee. Roles are rich (18 `Role` values: BRANCH, KYC_MAKER/CHECKER, CALL_CENTRE, SALES, SALES_HEAD, GOLD_ASSAYER, ACCOUNTS, MELTING_TEAM, OPERATIONS, …).

## 2. The customer journey (PHYSICAL_GOLD purchase)

Driven by `Transaction.status` (22 states) and mirrored at fine grain by `Timer.status` (57 states). Typical happy path:

1. **Lead** — call centre generates/【dials leads (`Lead`, `Call`, `CallHistory`, `LeadHistory`; `Gnani` = AI/auto-dialer). Lead plans to visit a branch.
2. **WALKIN** — customer arrives; a `Transaction` + `Walkin` + `Customer` are created. (`CustomerStatus`: LEAD → WALKIN.)
3. **ESTIMATION_PENDING → VALUATION_PENDING** — the **Gold Assayer** weighs & purity-tests each item: `Ornament` rows (gross/net weight, purity, deductions) + `Spectrometer` readings; an `Estimation` is created carrying the day's rates by purity band.
4. **SALES_NEGOTIATION_PENDING → SALES_APPROVAL_PENDING → SALES_HEAD_APPROVAL_PENDING** — **Sales** negotiates the rate with the customer (`updated_rate_*`); approvals climb the chain (`EstimationStatus`). Service-charge approval too (SERVICE_CHARGE_APPROVAL_PENDING).
5. **QUOTATION_PENDING** — the final offer is fixed (`Quotation`, approved).
6. **BRANCH_KYC_PENDING → KYC_PENDING** — **KYC Maker → KYC Checker** dual approval with documents (`Kyc`, `KycLog`, `KycChecklist`, `Document`; `KycStatus` MAKER/CHECKER states).
7. **PENNY_DROP_PENDING** — a ₹1 penny-drop verifies the customer's payout bank account (`BankAccount`, `Payment.type = PENNY_DROP`).
8. **FINAL_PAYMENT_PENDING → FINAL_PAYMENT_COMPLETED** — the payout is disbursed (`Payment.type = FINAL_PAYMENT`, `action = DEBITED`, via RazorpayX or offline). `Invoice` / `TaxInvoice` are generated. **← GoldApp's boundary: this day is the purchase date.**
9. **Post-purchase** — `Order` → `GoldCollection` (physical gold gathered) → `Melting`/`MeltingSummary` (melted to bars). From here GoldApp drives consignments, bidding & margins.

### 2b. The takeover journey (RELEASED_GOLD)
PLEDGE_ESTIMATION_PENDING → (sales/pledge approvals) → RELEASE_AGREEMENT_PENDING (`Agreement`) → RELEASE_PENDING → FINANCE_RELEASE (release pledged gold from the NBFC/`PledgeCompany`) → `Payment.type = RELEASE_PAYMENT` settles the finance company. A **"RELEASE LOSS"** arises when the release cost exceeds the gold's value (surfaces in GoldApp as a negative/CREDITED final settlement).


## Table inventory (69 tables · 23,17,892 rows)

### Cluster 1 · Reference & Org

| Table | Rows | # Cols |
|---|--:|--:|
| `Employee` | 746 | 22 |
| `UserRole` | 19 | 6 |
| `RolePermission` | 277 | 8 |
| `PermissionGroup` | 45 | 6 |
| `PermissionResource` | 353 | 3 |
| `Branch` | 142 | 19 |
| `Region` | 0 | 5 |
| `State` | 4 | 6 |
| `Cluster` | 10 | 4 |
| `Companies` | 486 | 6 |
| `Bank` | 105 | 5 |
| `Settings` | 8 | 16 |
| `Assignment` | 9 | 7 |
| `AssignmentGroup` | 6 | 4 |
| `Target` | 818 | 9 |
| `_BranchToUserRole` | 2,080 | 2 |
| `_StateToUserRole` | 63 | 2 |

### Cluster 2 · Lead & Calling

| Table | Rows | # Cols |
|---|--:|--:|
| `Lead` | 1,10,049 | 30 |
| `LeadHistory` | 1,55,699 | 9 |
| `Call` | 3,91,332 | 32 |
| `CallHistory` | 4,96,320 | 32 |
| `Gnani` | 57 | 13 |
| `Notification` | 1,18,062 | 9 |
| `Blocklist` | 3,211 | 7 |
| `ActionControl` | 14,909 | 29 |

### Cluster 3 · Transaction/Walk-in/KYC/Customer

| Table | Rows | # Cols |
|---|--:|--:|
| `Transaction` | 18,698 | 16 |
| `Walkin` | 18,698 | 26 |
| `WalkinSync` | 558 | 4 |
| `Kyc` | 16,905 | 10 |
| `KycLog` | 25,136 | 8 |
| `KycChecklist` | 71,940 | 7 |
| `Document` | 68,904 | 22 |
| `ApplicationForm` | 0 | 6 |
| `CustomerForm` | 0 | 6 |
| `Talkument` | 285 | 10 |
| `OLDKyc` | 0 | 6 |
| `OLDTransaction` | 0 | 15 |
| `Customer` | 18,882 | 25 |
| `CustomerAuditLog` | 1,00,000 | 10 |

### Cluster 4 · Valuation/Pricing

| Table | Rows | # Cols |
|---|--:|--:|
| `Estimation` | 16,179 | 33 |
| `Ornament` | 54,146 | 31 |
| `Quotation` | 10,120 | 17 |
| `Spectrometer` | 932 | 10 |
| `GoldRate` | 64 | 12 |
| `Agreement` | 1,370 | 11 |

### Cluster 5 · Payment & Billing

| Table | Rows | # Cols |
|---|--:|--:|
| `Payment` | 21,335 | 25 |
| `BankAccount` | 13,954 | 13 |
| `Invoice` | 9,630 | 7 |
| `TaxInvoice` | 7,360 | 11 |
| `Order` | 8,724 | 12 |
| `QRCode` | 7,312 | 8 |
| `EWayBill` | 362 | 9 |

### Cluster 6 · Post-purchase Gold

| Table | Rows | # Cols |
|---|--:|--:|
| `Release` | 2,811 | 9 |
| `PledgeCompany` | 2,245 | 29 |
| `GoldCollection` | 17,448 | 9 |
| `Melting` | 4 | 15 |
| `MeltingSummary` | 118 | 16 |
| `Purchase` | 0 | 6 |
| `Batch` | 0 | 33 |
| `Bid` | 0 | 8 |
| `Bidder` | 0 | 4 |

### Cluster 7 · System & Misc

| Table | Rows | # Cols |
|---|--:|--:|
| `File` | 2,69,835 | 26 |
| `Timer` | 30,399 | 8 |
| `ApiKey` | 6 | 11 |
| `ApiKeyUsage` | 2,06,917 | 8 |
| `Qandle` | 870 | 16 |
| `Place` | 588 | 4 |
| `AuditTrails` | 0 | 11 |
| `_prisma_migrations` | 347 | 8 |

## Enum catalog (42 types)

- **AccessLevel** — `BRANCH`, `HO`
- **AssayerStatus** — `PENDING`, `COMPLETED`, `REQUESTED`
- **BankAccountType** — `CUSTOMER`, `NBFC`
- **BatchState** — `BEFORE_MELTING`, `AFTER_MELTING`, `MARKET`, `BIDDER_SALE`, `SOLD`
- **BlocklistType** — `BLOCK`, `THEFT`
- **CallDirection** — `INCOMING`, `OUTGOING`
- **CallStatus** — `PENDING`, `REPEATED_CALL`, `MISSED_CALL`, `UNANSWERED_CALL`, `CALLING`, `ANSWERED`, `RNR`
- **CheckerStatus** — `REQUESTED`, `PENDING`, `APPROVED`, `REJECTED`
- **CompanyType** — `GOLD_LOAN`, `HOUSING_FINANCE`, `MICROFINANCE`, `RETAIL_FINANCE`, `CORPORATE_FINANCE`, `OTHERS`, `BANK`, `COOPERATIVE_BANK`, `STATE_COOPERATIVE_BANK`, `MULTISTATE_COOPERATIVE`, `SMALL_FINANCE_BANK`, `PAWN_BROKER`
- **CustomerStatus** — `LEAD`, `WALKIN`
- **DocumentClass** — `ADDRESS_PROOF`, `ID_PROOF`, `BILL`, `JEWELLERY`, `OTHERS`, `BANK_PROOF`, `REFERENCE_CONTACT`
- **DocumentType** — `AADHAAR`, `PASSPORT`, `DRIVING_LICENSE`, `VOTER_ID`, `PAN`, `RC`, `OTHERS`, `CONTACT`, `COMPANY_ID`, `SALARY_CREDIT`, `RENTAL_AGREEMENT`, `ELECTRICITY_BILL`, `GASS_BILL`, `BANK_PASSBOOK_STATEMENT`, `MARRIAGE_CERTIFICATE`, `VEHICLE_INSURANCE`, `BUSSINESS_GST_CERTIFICATE`, `BUSSINESS_CARD`, `HOUSE_INTERNAL_1`, `HOUSE_INTERNAL_2`, `HOUSE_INTERNAL_3`, `HOUSE_EXTERNAL_1`, `HOUSE_EXTERNAL_2`, `HOUSE_EXTERNAL_3`, `HOUSE_CUSTOMER_SELFIE`, `BILL`, `JEWELLERY`, `CANCELLED_CHEQUE`, `PAYOUT_FORM`
- **EstimationStatus** — `PENDING`, `VALUATION_PENDING`, `SALES_NEGOTIATION_PENDING`, `SALES_NEGOTIATION_REJECTED`, `SALES_NEGOTIATION_COMPLETED`, `SALES_APPROVAL_PENDING`, `SALES_REJECTED`, `SALES_APPROVED`, `SALES_HEAD_APPROVAL_PENDING`, `SALES_HEAD_REJECTED`, `SALES_HEAD_APPROVED`, `VALUATION_COMPLETED`, `COMPLETED`
- **GnaniProcessingStatus** — `PENDING`, `COMPLETED`, `FAILED`, `QUEUED`
- **GnaniStatus** — `VALID`, `INVALID`
- **GoldCollectionStatus** — `PENDING`, `COMPLETED`
- **KycAction** — `REQUESTED`, `APPROVED`, `REJECTED`
- **KycEmployeeClass** — `KYC_MAKER`, `KYC_CHECKER`
- **KycStatus** — `CHECKER_PENDING`, `MAKER_PENDING`, `CHECKER_APPROVED`, `CHECKER_REJECTED`, `MAKER_APPROVED`, `MAKER_REJECTED`, `CHECKER_REQ_DOC`, `MAKER_REQ_DOC`
- **LeadStatus** — `VISITED`, `PENDING`, `MERGED`, `PLANNING_TO_VISIT`, `INVALID`, `ENQUIRY`, `VISITED_SOLD`, `VISITED_NOT_SOLD`, `TEST_CALL`
- **LeadTransactionType** — `PHYSICAL_GOLD`, `RELEASED_GOLD`
- **LeadVisitStatus** — `SOLD`, `NOT_SOLD`
- **MakerStatus** — `REQUESTED`, `PENDING`, `APPROVED`, `REJECTED`
- **MeltingStatus** — `PENDING`, `MELTED`, `NOT_MELTED`
- **NbfcType** — `VIRTUAL_ID`, `LOAN_ACCOUNT_NUMBER`
- **OrderStatus** — `PENDING`, `RECEIVED`
- **Payeetype** — `OTHERS`, `CUSTOMER_BANK_ACCOUNT`, `NBFC`
- **PaymentAction** — `DEBITED`, `CREDITED`
- **PaymentProvider** — `RAZORPAY`, `OFFLINE`
- **PaymentStatus** — `PENDING`, `COMPLETED`, `FAILED`, `OTP_FAILED`, `OTP_PENDING`, `CONFIRMATION_PENDING`, `CONFIRMED`, `DROP_INVALIDATED`, `DROP_SKIPPED`
- **PaymentType** — `PENNY_DROP`, `FINAL_PAYMENT`, `RELEASE_PAYMENT`
- **QuotationStatus** — `PENDING`, `APPROVED`, `REQUESTED`
- **ReleasePaymentStatus** — `PENDING`, `COMPLETED`
- **Role** — `ADMIN`, `BRANCH`, `KYC`, `KYC_MAKER`, `KYC_CHECKER`, `CALL_CENTRE`, `CALL_CENTRE_LEAD`, `MELTING_TEAM`, `OPERATIONS`, `SALES`, `SALES_HEAD`, `TELE_SALES`, `TELE_SALES_HEAD`, `ACCOUNTS`, `GOLD_ASSAYER`, `OTHERS`, `ACCOUNTS_HEAD`, `SUPER_USER`
- **SalesHeadStatus** — `PENDING`, `REJECTED`, `APPROVED`
- **SalesStatus** — `PENDING`, `REJECTED`, `APPROVED`
- **ShipmentStatus** — `PENDING`, `SHIPPED`
- **SpectrometerSyncStatus** — `PENDING`, `SYNCED`, `ACKNOWLEDGED`
- **TalkumentStatus** — `INPROGRESS`, `COMPLETED`, `FAILED`
- **TimerStatus** — `ONBOARD`, `WALKIN`, `WALKOUT`, `ESTIMATION_PENDING`, `VALUATION_PENDING`, `VALUATION_COMPLETED`, `SALES_NEGOTIATION_PENDING`, `SALES_NEGOTIATION_COMPLETED`, `SALES_NEGOTIATION_REJECTED`, `SALES_SERVICE_CHARGE_PENDING`, `SALES_SERVICE_CHARGE_COMPLETED`, `SALES_SERVICE_CHARGE_REJECTED`, `BRANCH_KYC_PENDING`, `KYC_MAKER_PENDING`, `KYC_MAKER_REJECTED`, `KYC_MAKER_REQUESTED`, `KYC_MAKER_APPROVED`, `KYC_CHECKER_PENDING`, `KYC_CHECKER_REJECTED`, `KYC_CHECKER_REQUESTED`, `KYC_CHECKER_APPROVED`, `KYC_PENDING`, `KYC_REJECTED`, `KYC_REQUESTED`, `QUOTATION_PENDING`, `REVALUATION_PENDING`, `REVALUATION_COMPLETED`, `REVALUATION_REQUESTED`, `PLEDGE_ESTIMATION_PENDING`, `SALES_PLEDGE_PENDING`, `SALES_PLEDGE_REJECTED`, `SALES_PLEDGE_APPROVED`, `RELEASE_PENDING`, `RELEASE_AGREEMENT_PENDING`, `PENNY_DROP_PENDING`, `FINAL_PAYMENT_PENDING`, `RELEASE_PAYMENT_PENDING`, `RELEASE_PAYMENT_COMPLETED`, `FINAL_PAYMENT_COMPLETED`, `SALES_RELEASE_PENDING`, `SALES_RELEASE_REJECTED`, `SALES_RELEASE_COMPLETED`, `FINANCE_RELEASE_PENDING`, `FINANCE_RELEASE_COMPLETED`, `FINANCE_RELEASE_REJECTED`, `PICKUP_PENDING`, `SALES_PAYMENT_PENDING`, `SALES_PAYMENT_REJECTED`, `SALES_PAYMENT_COMPLETED`, `ESTIMATION_COMPLETED`, `OCR_INPROGRESS`, `OCR_COMPLETED`, `OCR_FAILED`
- **TransactionStatus** — `WALKIN`, `WALKOUT`, `ESTIMATION_PENDING`, `VALUATION_PENDING`, `BRANCH_KYC_PENDING`, `KYC_PENDING`, `QUOTATION_PENDING`, `KYC_REJECTED`, `KYC_REQUESTED`, `REVALUATION_PENDING`, `PENNY_DROP_PENDING`, `FINAL_PAYMENT_PENDING`, `SALES_APPROVAL_PENDING`, `SALES_HEAD_APPROVAL_PENDING`, `SALES_NEGOTIATION_PENDING`, `REVALUATION_COMPLETED`, `FINAL_PAYMENT_COMPLETED`, `PLEDGE_ESTIMATION_PENDING`, `RELEASE_AGREEMENT_PENDING`, `RELEASE_PENDING`, `RELEASE_PAYMENT_PENDING`, `SERVICE_CHARGE_APPROVAL_PENDING`, `PLEDGE_APPROVAL_PENDING`
- **TransactionType** — `PHYSICAL_GOLD`, `RELEASED_GOLD`

## Foreign-key graph (128 FKs)

> `Transaction` is the hub — most tables point at it. `Employee`, `Customer`, `Branch` are the shared reference entities.

- **ActionControl** → `transaction_id` → `Transaction.id`
- **Agreement** → `release_id` → `Release.id`
- **ApiKeyUsage** → `api_key_id` → `ApiKey.id`
- **ApplicationForm** → `kyc_id` → `Kyc.id`
- **Assignment** → `assignee_id` → `Employee.emp_id` · `group_id` → `AssignmentGroup.id` · `reporter_id` → `Employee.emp_id`
- **BankAccount** → `customer_id` → `Customer.id` · `pledge_company_id` → `PledgeCompany.id` · `transactionId` → `Transaction.id`
- **Batch** → `after_melting_updated_emp_id` → `Employee.emp_id` · `before_melting_updated_emp_id` → `Employee.emp_id` · `bid_id` → `Bid.id` · `bidder_sale_updated_emp_id` → `Employee.emp_id` · `market_updated_emp_id` → `Employee.emp_id` · `purchase_id` → `Purchase.id`
- **Bid** → `bidder_id` → `Bidder.id` · `emp_id` → `Employee.emp_id`
- **Blocklist** → `customer_id` → `Customer.id` · `employee_id` → `Employee.emp_id`
- **Branch** → `cluster_id` → `Cluster.id` · `region_id` → `Region.id` · `state_id` → `State.id`
- **Call** → `employee_id` → `Employee.emp_id` · `gnani_id` → `Gnani.id` · `lead_id` → `Lead.id`
- **Companies** → `employee_id` → `Employee.emp_id`
- **CustomerAuditLog** → `customer_id` → `Customer.id` · `employee_id` → `Employee.id`
- **CustomerForm** → `kyc_id` → `Kyc.id`
- **Document** → `kyc_id` → `Kyc.id` · `old_kyc_id` → `OLDKyc.id`
- **Employee** → `branch_id` → `Branch.id` · `role_id` → `UserRole.id`
- **Estimation** → `negotiation_approved_id` → `Employee.emp_id` · `service_charge_approved_id` → `Employee.emp_id` · `transaction_id` → `Transaction.id`
- **File** → `agreement_id` → `Agreement.id` · `back_document_id` → `Document.id` · `bankAccountId` → `BankAccount.id` · `estimation_total_ornament_id` → `Estimation.id` · `front_document_id` → `Document.id` · `maker_recording_id` → `Kyc.id` · `ornament_id` → `Ornament.id` · `payment_id` → `Payment.id` · `payoutbankAccountId` → `BankAccount.id` · `pledge_receipt_id` → `PledgeCompany.id` · `purchase_bill_id` → `PledgeCompany.id` · `quotation_total_ornament_id` → `Quotation.id` · `quotation_total_weight_id` → `Quotation.id` · `release_ornament_id` → `PledgeCompany.id` · `spectro_ornament_id` → `Ornament.id` · `total_spectrometer_id` → `Quotation.id` · `total_weight_id` → `Estimation.id` · `updated_emp_id` → `Employee.emp_id` · `video_document_id` → `Document.id` · `walkin_id` → `Walkin.id`
- **GoldCollection** → `emp_id` → `Employee.emp_id` · `orderId` → `Order.id`
- **GoldRate** → `state_id` → `State.id` · `updated_emp_id` → `Employee.emp_id`
- **Invoice** → `transaction_id` → `Transaction.id`
- **Kyc** → `transaction_id` → `Transaction.id`
- **KycChecklist** → `kyc_id` → `Kyc.id`
- **KycLog** → `emp_id` → `Employee.emp_id` · `kyc_id` → `Kyc.id`
- **Lead** → `branch_id` → `Branch.id` · `company_id` → `Companies.id` · `employee_id` → `Employee.emp_id` · `parent_lead_id` → `Lead.id` · `transaction_id` → `Transaction.id` · `visited_branch_id` → `Branch.id`
- **LeadHistory** → `employee_id` → `Employee.id` · `leadId` → `Lead.id`
- **Melting** → `emp_id` → `Employee.emp_id` · `order_id` → `Order.id`
- **MeltingSummary** → `updated_emp_id` → `Employee.emp_id`
- **Notification** → `employee_id` → `Employee.id` · `lead_id` → `Lead.id` · `transaction_id` → `Transaction.id`
- **OLDKyc** → `customer_id` → `Customer.id`
- **OLDTransaction** → `branch_id` → `Branch.id` · `customer_id` → `Customer.id` · `emp_id` → `Employee.emp_id`
- **Order** → `emp_id` → `Employee.emp_id` · `transaction_id` → `Transaction.id`
- **Ornament** → `approved_by_id` → `Employee.emp_id` · `estimation_id` → `Estimation.id` · `quotation_id` → `Quotation.id` · `valuated_by_id` → `Employee.emp_id`
- **Payment** → `bank_account_id` → `BankAccount.id` · `employee_id` → `Employee.emp_id` · `sales_emp_id` → `Employee.emp_id` · `transaction_id` → `Transaction.id`
- **PermissionResource** → `permission_group_id` → `PermissionGroup.id`
- **PledgeCompany** → `company_id` → `Companies.id` · `employee_id` → `Employee.emp_id` · `payment_sales_approved_by_id` → `Employee.emp_id` · `release_id` → `Release.id` · `sales_approved_by_id` → `Employee.emp_id`
- **Purchase** → `bidder_id` → `Bidder.id` · `updated_emp_id` → `Employee.emp_id`
- **Quotation** → `quotation_approved_id` → `Employee.emp_id` · `transaction_id` → `Transaction.id`
- **Region** → `manager_id` → `Employee.id`
- **Release** → `transaction_id` → `Transaction.id`
- **RolePermission** → `permission_group_id` → `PermissionGroup.id` · `role_id` → `UserRole.id`
- **Settings** → `employeeId` → `Employee.id` · `state_id` → `State.id`
- **Spectrometer** → `customer_id` → `Customer.id` · `estimation_id` → `Estimation.id` · `quotation_id` → `Quotation.id`
- **Talkument** → `kyc_id` → `Kyc.id`
- **Target** → `branch_id` → `Branch.id` · `updated_by_id` → `Employee.id`
- **TaxInvoice** → `transaction_id` → `Transaction.id`
- **Timer** → `employee_id` → `Employee.id` · `transaction_id` → `Transaction.id`
- **Transaction** → `branch_id` → `Branch.id` · `customer_id` → `Customer.id` · `emp_id` → `Employee.emp_id` · `eway_bill_id` → `EWayBill.id`
- **Walkin** → `transaction_id` → `Transaction.id`
- **_BranchToUserRole** → `A` → `Branch.id` · `B` → `UserRole.id`
- **_StateToUserRole** → `A` → `State.id` · `B` → `UserRole.id`

## Cluster docs (field-level detail)

1. [Reference & Org](#part-toc)
2. [Lead & Calling funnel](#part-toc)
3. [Transaction / Walk-in / KYC / Customer](#part-toc)
4. [Valuation & Pricing (the margin engine)](#part-toc)
5. [Payment & Billing](#part-toc)
6. [Post-purchase Gold (release/pledge/melting)](#part-toc)
7. [System & Misc](#part-toc)

**Cross-cutting:**
- [Data provenance & external integrations](#part-toc) — where every table's data originates (lead webhooks, telephony/Gnani, spectrometer, RazorpayX, S3/OCR, GST, Qandle HRMS, GoldRate) + a live/dormant breakdown.
- [DB objects beyond the base tables](#part-toc) — the `latest_gold_transaction_report` **view** (the CRM's ready-made per-deal purchase report), the ID-minting **functions**, and sequences.

---

# 3. Money-math & margins (the core)

> Full per-column derivations and paisa-verified worked examples are in [cluster-4 (Valuation)](#part-toc), [cluster-5 (Payment)](#part-toc) and [cluster-6 (Post-purchase Gold)](#part-toc). This is the consolidated model.

## 3A. Purchase valuation — what the customer is paid (PHYSICAL_GOLD)

**Per ornament (item):**
```
net_weight = gross_weight − stone_weight − wastage_weight
amount     = net_weight × (gold_rate + delta) × branch_purity / 100
```
**Per deal (Estimation → Quotation):**
```
Σamount               = sum of all approved ornament amounts
service_charge_amount = Σamount × service_charge% / 100
final_amount          = Σamount × (1 − service_charge/100)   ← customer payout / deal value
```
`Quotation.final_amount` is the number GoldApp takes as the deal value.

**⚠ Rate-band columns are MISLABELLED by one level** (on Estimation / Quotation / Ornament) — proven by matching every ornament's `gold_rate` to its parent by purity:
| Purity band | Real rate lives in |
|---|---|
| 22K (91.6%) | **`margin_24k`** |
| 18–21K | `rate_22k` |
| 14–17K | `rate_17k_21k` |
| (disabled) | `rate_14k_17k` ≈ 0 |

**Margin levers (where WG's spread comes from):**
1. **`branch_purity` (agreed fineness), NOT the spectrometer-tested `purity`, is what's paid on.** Agreed < tested → the gap is margin.
2. **`service_charge%`** deducted from the gross amount.
3. **Negotiation overlay** — `updated_rate_*` / `is_rates_updated` (only ~624 estimations) when Sales negotiates the rate down.
4. **Purity gain at melting** — melted fine gold typically exceeds the paid-for net; that surplus is realised post-purchase (this is exactly the "gain" GoldApp's bidding/booking model tracks).

## 3B. Release / takeover valuation (RELEASED_GOLD)
Per `PledgeCompany` row (verified on all 2,248):
```
net_weight   = gross − deduction
loan_amount  = release_amount = per_gram_rate × net_weight        (paid to the NBFC to free the gold)
final_amount = final_per_gram_rate × net_weight                   (WG's valuation of the freed gold)
RELEASE LOSS = final_amount < loan_amount   (114 rows; 241 gains, 909 at par)
```
Money out = `Payment.type = RELEASE_PAYMENT` (1,205 rows, mostly OFFLINE). Ties to `Transaction.transaction_type = RELEASED_GOLD` → GoldApp's `TAKEOVER`. `delta`/`interest`/`interest_amount` are dead columns; `Release.total_release_amount` is unreliable — compute from `PledgeCompany` children.

## 3C. Money-out ledger — what actually left the bank
```
paid = Σ FINAL_PAYMENT/DEBITED  +  Σ RELEASE_PAYMENT/DEBITED  −  Σ FINAL_PAYMENT/CREDITED (reversals)
```
- **⚠ CREDITED reversals are stored mostly NEGATIVE (21 of 24)** — so a naive `− CREDITED` *adds* the loss magnitude; handle the sign per-row.
- **Hand-off day / purchase_date** = `MAX(Payment.created_at) WHERE type='FINAL_PAYMENT' AND status='COMPLETED'`, converted UTC→Asia/Kolkata. This equals the invoice day. **Not** `Transaction.created_at`/`updated_at`.
- Payment volumes: FINAL_PAYMENT/DEBITED 9,713 rows ≈ ₹2.52 B (the real payouts); RELEASE_PAYMENT/DEBITED 1,203 ≈ ₹600.7 M; PENNY_DROP/DEBITED 10,398 × ₹1.

## 3D. GST / billing
- **`Invoice`** = customer purchase receipt (no GST — WG buys from an individual).
- **`TaxInvoice`** = GST invoice on WG's **service fee** only: fee + 9% CGST + 9% SGST, per-branch monthly numbering (e.g. `KA-HAS-0826-0013`).
- **`QRCode`** = UPI-collect QR for that service fee.

---

# 4. Reports & analytics blueprint (metric → source)

| Metric / report | Source tables & fields |
|---|---|
| **Purchase register / volume** | Fastest source: the **`latest_gold_transaction_report` view** (per-deal gross/net/purity/rate/service-charge/final, `PHYSICAL_GOLD` only — union with `PledgeCompany` for takeovers). Otherwise `Transaction`(code, transaction_type, status=`FINAL_PAYMENT_COMPLETED`) + `Payment` final-payment day + `Quotation.final_amount` + approved `Ornament`; join `Payment` for the paid figure |
| **Margin analysis** | §3A/§3B formulas; `GoldRate` for reference rate; `branch_purity` vs tested `purity` gap; post-melt gain (`MeltingSummary` net) vs paid net |
| **TAT / stage timing** | Reconstruct from artifact `created_at`/`updated_at`: Estimation → Quotation → `KycLog` → Payment → Order (+ Release/Agreement for takeover). **`Timer` is DEAD — never use it.** |
| **Lead → sale conversion** | `Lead`(status, `transaction_id` 1:1) → `Transaction`(FINAL_PAYMENT_COMPLETED). ~2.8% convert; ~46% INVALID |
| **Calling productivity** | `Call`/`CallHistory`(direction, status/disposition, employee_id→emp_id) |
| **Branch / employee productivity** | `Employee`(emp_id + id), `Branch`, artifact timestamps, `KycLog`; attribution must COALESCE emp_id & id |
| **Billed vs paid reconciliation** | billed = `Quotation.final_amount`; paid = §3C; account-match via `BankAccount` penny-drop |
| **KYC throughput** | `Kyc`/`KycLog`(maker→checker states), `KycChecklist` |

---

# 5. Critical gotchas & data traps (read before querying)

1. **Rate-band columns mislabelled by one level** (§3A) — the #1 margin trap. 22K rate = `margin_24k`.
2. **`margin_24k` means different things** — a full rate on Estimation/Quotation, but a small spread on `GoldRate` (same name).
3. **`branch_purity` (paid) ≠ tested `purity` (Spectrometer)** — deliberate margin lever.
4. **`Employee` has TWO id conventions** — `emp_id` (`WGxxxxx`) for most FKs, but `id` (UUID) for `LeadHistory`/`Notification`/`Settings`/`Target`/`CustomerAuditLog`. Always COALESCE.
5. **`Region` tier is empty** (`Branch.region_id` all NULL) — use `Cluster`/`State`.
6. **CREDITED reversals stored mostly negative** — sign care in the paid formula (§3C).
7. **`Timer` table is dead** — reconstruct TAT from artifact timestamps.
8. **Legacy/empty tables never migrated:** `OLDTransaction`, `OLDKyc`, `ApplicationForm`, `CustomerForm`, `AuditTrails`, and the entire bidding module (`Purchase`/`Batch`/`Bid`/`Bidder`). The OLD CRM lives in a separate MySQL DB.
9. **Purchase date = final-payment day**, not `created_at`/`updated_at`.
10. **Append-only history tables** (`Target`, `GoldRate`, …) — dedupe by latest `created_at`.
11. **`Release.total_release_amount` unreliable** — compute from `PledgeCompany` children.
12. **`code` hyphen** (`WGKA-#####`) distinguishes NEW CRM from OLD (`WGKA#####`).
13. **`GoldRate.updated_at` is misleading** — values are live even when the timestamp is weeks old (the daily-rate write path doesn't bump it).

> **⚠ CONFIRMED — the GoldApp Live Rates board mislabels its bands.** Verified against live `Ornament` data: an actual **22K item (purity 91.6%)** is priced with `gold_rate` = **`margin_24k`** (≈14,360, i.e. the 24K rate), while **`rate_22k` (11,600) is applied to 18–21K gold** (purity ~74–85%) and `rate_17k_21k` to 14–17K. Estimation's `rate_22k`/`rate_17k_21k` values carry over 1:1 from `GoldRate.rate_22k`/`rate_17_21k`, so the same shift applies to `GoldRate`:
>
> | GoldRate column | Live Rates label (current) | **Actual purity band** |
> |---|---|---|
> | `rate_24k` | 24K | **22–24K (the main rate; what standard 22K jewellery is priced off, × purity)** |
> | `rate_22k` | 22K ❌ | **18–21K** |
> | `rate_17_21k` | 17–21K ❌ | **14–17K** |
> | `margin_24k` | (footnote) | a small spread on GoldRate (≈0), but a *full 24K rate* on Estimation — same name, opposite meaning |
>
> **Action:** the Live Rates submodule's band labels should be corrected (rate_22k → "18–21K", rate_17_21k → "14–17K"), or better, show the effective 22K payout (`rate_24k × 0.916`) since most gold is 22K. Flagged for a follow-up fix.


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-1"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 1 — Reference & Org (Employee, Branch, Roles, States)
# ═══════════════════════════════════════════

# NEW CRM — Cluster 1: Reference & Org

Exhaustive technical documentation of the "Reference & Org" tables in the White Gold **NEW CRM** Postgres database (`dbwhitegold_production`, AWS Lightsail/RDS, `ap-south-1`). Purely descriptive; access is **read-only** (SELECT only).

- **Connection**: `NEW_CRM_DB_HOST` (`ls-…rds.amazonaws.com`), port `5432`, db `dbwhitegold_production`, user `nighthack`, SSL `rejectUnauthorized:false`. Credentials live in `c:\Users\chaithanya\goldapp\.env.local`.
- **Convention**: All identifiers are PascalCase and **must be double-quoted** (`SELECT * FROM "Employee"`). Prisma-generated schema.
- **Snapshot date**: 2026-08-06.

Tables covered: `Employee`, `UserRole`, `RolePermission`, `PermissionGroup`, `PermissionResource`, `Branch`, `Region`, `State`, `Cluster`, `Companies`, `Bank`, `Settings`, `Assignment`, `AssignmentGroup`, `Target`, `_BranchToUserRole`, `_StateToUserRole`.

---

## 0. Cluster-level insights (read this first)

### 0.1 Org hierarchy — actual vs. designed
The Prisma schema was designed as **State → Region → Cluster → Branch → Employee**, but in production **Region is dead**:

| Level | Table | Rows | In use? |
|-------|-------|-----:|---------|
| State | `State` | 4 | Yes — KA, KL, AP, TS |
| Region | `Region` | **0** | **No** — table empty; every `Branch.region_id` is NULL |
| Cluster | `Cluster` | 10 | Yes — 134/142 branches linked |
| Branch | `Branch` | 142 (129 active) | Yes |
| Employee | `Employee` | 746 | Yes |

So the **live hierarchy is State → Cluster → Branch → Employee**. `Region` remains as a legacy/aspirational table (it even has a mandatory `manager_id` FK to `Employee.id`, but with zero rows it is inert). Do not rely on `Branch.region_id`.

The 10 clusters map to states like this (from `Cluster.name`): Andhra Pradesh; Telangana; Bangalore East / North & West / South; Rest of Karnataka; Kerala Central / East / North / South. So Karnataka is sub-divided into 4 clusters, Kerala into 4, AP and TS into 1 each.

### 0.2 Two parallel role systems (important)
There are **two independent authorization models** coexisting on `Employee`:

1. **Legacy enum role** — `Employee.role` (Postgres enum `Role`, 21 values). Coarse job-function label (BRANCH, TELE_SALES, ACCOUNTS, …). This is the field GoldApp reads.
2. **New RBAC** — `Employee.role_id` → `UserRole` → `RolePermission` → `PermissionGroup` → `PermissionResource`. Fine-grained per-feature permissions (can_read/create/update/delete). 19 named roles, 45 permission groups, 353 resource strings. This drives the CRM's own UI, **not** GoldApp.

Plus a third axis: **`Employee.access_level`** (enum `AccessLevel`: `BRANCH` | `HO`) — whether the user sees only their branch or head-office-wide data.

### 0.3 The Employee key duality (critical for all joins)
`Employee` has **two identifiers**, and different tables reference different ones:
- `Employee.id` — UUID surrogate PK.
- `Employee.emp_id` — human code like `WG01108` (also `WGINT-0027` for interns). Has a UNIQUE constraint and is the target of **most** FKs.

FKs pointing at **`emp_id`**: Transaction, Payment, Order, Estimation, Quotation, KycLog, Bid, Batch, Companies, Call, GoldCollection, GoldRate, Blocklist, Melting, PledgeCompany, Purchase, Ornament, File, Assignment.
FKs pointing at **`id`** (UUID): CustomerAuditLog, LeadHistory, Notification, `Region.manager_id`, `Settings.employeeId`, `Target.updated_by_id`, `Timer`.

GoldApp's employee-attribution SQL copes with this by `COALESCE`-ing both: `LEFT JOIN "Employee" e1 ON e1.emp_id=h.hk LEFT JOIN "Employee" e2 ON e2.id=h.hk` (see `app/api/sync-branch-employees/route.js`).

### 0.4 Branch → State/Cluster mapping
`Branch` carries redundant state info: a legacy free-text `state` column (values `KA`/`KL`/`AP`/`TS`, NULL for 72 rows) **and** a proper `state_id` FK (populated for 134/142). Prefer `state_id`. `cluster_id` populated for 134/142; `region_id` always NULL.

---

## 1. `Employee`

**Purpose** — Every CRM user / staff member (branch staff, telesales, accounts, KYC, ops, admins). Central actor table: nearly every operational table attributes work to an employee.

**Row count**: **746** (490 active+status-true; 254 active-but-status-false; 2 edge rows).

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text (UUID) | NO | — | Surrogate PK. |
| `first_name` | text | NO | — | Given name. **PII.** |
| `last_name` | text | NO | — | Surname. **PII.** |
| `email` | text | NO | — | Login email. **PII.** |
| `image` | text | YES | — | Avatar/photo URL. |
| `phone` | text | NO | — | Mobile. **PII.** |
| `pan_number` | text | NO | — | Employee PAN. **PII.** |
| `branch_id` | text | YES | — | FK → `Branch.id` (home branch). |
| `status` | boolean | NO | true | Legacy active flag (see state machine). |
| `date_of_joining` | text | YES | — | DOJ as free text (often NULL). |
| `created_at` | timestamp | NO | now() | Row creation. |
| `updated_at` | timestamp | NO | — | Last profile update. |
| `role` | enum `Role` | NO | `'BRANCH'` | Legacy coarse role (see enum below). |
| `existing_employee` | boolean | NO | false | Migrated from old system vs. new hire. |
| `emp_id` | text | NO | — | Human code `WGxxxxx` (UNIQUE); FK target for most tables. |
| `password` | text | YES | — | Hashed password (467/746 set). |
| `designation` | text | YES | — | HR job title (free text, ~60 distinct). |
| `new_crm` | boolean | YES | true | Belongs to the new CRM instance. |
| `active` | boolean | NO | true | Current active flag (see state machine). |
| `role_id` | text | YES | — | FK → `UserRole.id` (new RBAC role). |
| `access_level` | enum `AccessLevel` | YES | `'HO'` | `BRANCH` (own branch only) or `HO` (head-office-wide). |
| `logged_in_at` | timestamp | YES | — | Last login (327/746 have ever logged in). |

### Enum `Role` (21 values, on `Employee.role`)
`ADMIN`, `BRANCH`, `KYC`, `KYC_MAKER`, `KYC_CHECKER`, `CALL_CENTRE`, `CALL_CENTRE_LEAD`, `MELTING_TEAM`, `OPERATIONS`, `SALES`, `SALES_HEAD`, `TELE_SALES`, `TELE_SALES_HEAD`, `ACCOUNTS`, `GOLD_ASSAYER`, `OTHERS`, `ACCOUNTS_HEAD`, `SUPER_USER`.
Live distribution: BRANCH 462, OTHERS 160, TELE_SALES 61, ACCOUNTS 27, SALES 14, KYC_MAKER 6, OPERATIONS 6, KYC_CHECKER 3, SUPER_USER 2, ADMIN 2, TELE_SALES_HEAD 1, MELTING_TEAM 1, SALES_HEAD 1. (KYC, CALL_CENTRE*, SALES_HEAD variants, GOLD_ASSAYER, ACCOUNTS_HEAD exist in the enum but are rarely/never assigned.)

### Enum `AccessLevel` (2 values, on `Employee.access_level`)
- `BRANCH` — sees only their own branch's data (416 employees).
- `HO` — head-office scope, sees across branches (330 employees).

### Keys & relationships
- **PK**: `id`. **UNIQUE**: `emp_id`.
- **Outgoing FKs**: `branch_id → Branch.id`; `role_id → UserRole.id`.
- **Incoming FKs**: ~30 tables reference `emp_id` or `id` (see §0.3). This is the most-referenced table in the DB.

### Status / lifecycle
Two booleans overlap: **`active`** (current, authoritative) and **`status`** (legacy). Typical: `active=true, status=true` = working (490). `active=true, status=false` (254) = active login but legacy flag off (likely support/back-office or partially-migrated). `active=false` = offboarded (2). GoldApp syncs both flags but treats `active` as primary.

### Timestamps
`created_at` (onboarded into CRM), `updated_at` (profile edited), `logged_in_at` (last login — used for "who is actually using the CRM").

### Sample rows (PII masked)
```
{ emp_id: WG01108, name: "Name", role: BRANCH, designation: "Assistant Branch Manager",
  access_level: BRANCH, active: true, status: true, existing_employee: true,
  branch_id: 38286b8a-…, role_id: 28f95e1d-… (Branch User), logged_in_at: 2026-08-05T23:03Z }
{ emp_id: WG01064, name: "Name", role: BRANCH, designation: "Branch Manager",
  access_level: BRANCH, active: true, logged_in_at: 2026-08-05T04:16Z }
{ emp_id: WG01107, name: "Name", role: BRANCH, designation: "Assistant Branch Manager",
  access_level: BRANCH, active: true, logged_in_at: 2026-08-05T23:12Z }
```
(email `xxxx@xxxx`, phone `9xxxxxxxxx`, pan `XXXXX0000X` masked.)

### GoldApp usage
- `app/api/sync-branch-employees/route.js` — **full refresh** of Supabase `branch_employees` from `"Employee"` joined to `"Branch"`, pulling name, email, phone, pan_number, designation, `role::text`, `access_level::text`, DOJ, active, status, logged_in_at, branch name/state/code. Also computes cases-opened / cases-handled per employee by attributing Transaction/Estimation/Quotation/Payment/Order/KycLog rows back to `emp_id` (COALESCE over both keys).
- `app/api/branch-employees/insights/route.js` — same employee↔branch join for per-employee insight.
- `app/api/productivity/route.js` — `SELECT id, emp_id, name, role FROM "Employee"` to label transaction actors in the Productivity module.

---

## 2. `UserRole`

**Purpose** — Named roles in the **new RBAC** system (e.g. "ADMIN", "Branch User", "Telesales Executive"). Each employee optionally points here via `role_id`; permissions attach via `RolePermission`.

**Row count**: **19**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK (UUID). |
| `name` | text | NO | — | Role display name. |
| `description` | text | YES | — | Human description (mostly NULL). |
| `created_at` | timestamp | NO | now() | Created. |
| `updated_at` | timestamp | NO | — | Updated. |
| `default` | boolean | YES | false | The role auto-assigned to new users. |

The 19 roles: ADMIN, **Branch User** (`default=true`), Finance, Head of Sales, Kerala Business Head, Kerala Ops Access, Kerala Sales Access, KYC Checker, KYC Lead Maker and Checker, KYC Maker, Machine Integration, Marketing Analyst, Operations, Read Only Admin, Read Only All, Sales Manager, Telesales Admin, Telesales Executive, Test Account.

### Keys & relationships
- **PK**: `id`.
- **Incoming FKs**: `Employee.role_id`; `RolePermission.role_id`; `_BranchToUserRole.B`; `_StateToUserRole.B`.
- A role is **scoped** to branches and/or states via the two implicit join tables (§16, §17) — e.g. "Kerala Sales Access" is limited to the Kerala state.

---

## 3. `RolePermission`

**Purpose** — The permission matrix: for a given `UserRole` × `PermissionGroup`, which CRUD verbs are granted.

**Row count**: **277** (19 roles × subset of 45 groups).

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `role_id` | text | NO | — | FK → `UserRole.id`. |
| `permission_group_id` | text | NO | — | FK → `PermissionGroup.id`. |
| `can_read` | boolean | NO | false | Read allowed. |
| `can_create` | boolean | NO | false | Create allowed. |
| `can_update` | boolean | NO | false | Update allowed. |
| `can_delete` | boolean | NO | false | Delete allowed. |
| `created_at` | timestamp | NO | now() | Created. |

### Keys
- **PK**: `id`. **FKs**: `role_id → UserRole.id`, `permission_group_id → PermissionGroup.id`.
- Effective permission = union of granted verbs across the groups mapped to a user's role.

### Sample (joined)
```
ADMIN × BRANCH_TARGETS_REPORT → read,create,update (no delete)
ADMIN × MELTING_SUMMARY       → read,create,update
ADMIN × ESTIMATIONS           → read,create,update
ADMIN × NEGOTIATION_APPROVALS → read,create,update
```

---

## 4. `PermissionGroup`

**Purpose** — Feature/capability buckets, grouped by functional "team". A group bundles related resources (§5) and is the unit granted in `RolePermission`.

**Row count**: **45**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `name` | text | NO | — | Display name ("Branch Management"). |
| `code` | text | NO | — | Stable code (`BRANCH_MANAGEMENT`). |
| `description` | text | YES | — | Optional. |
| `default` | boolean | YES | false | Auto-granted group. |
| `team` | text | YES | — | Functional grouping (see below). |

### `team` values (the CRM's functional map)
`ADMIN` (Branch/Cluster/Role/State/User Management, Branch Targets), `BIDDER MANAGEMENT` (Bidder Calculations, Bids), `BRANCH` (Branch Transactions, Estimations), `FINANCE` (Final Payments, Release Gold Payments), `KYC` (Blocklist, KYC Checker, KYC Maker), `MELTING` (Gold Collection, Gold Processing, Melting & Market, Melting Summary), `MELTING AUDIT` (Gold Collection/Processing Audit), `OPERATIONS` (Stone Valuations, Stone Revaluations & Cut & Check), `REPORTS` (Bank, Branch Targets, Branch Wise, Calls, Case Wise, Gold Collection, Gold Processing, Grams, Leads, Purchase reports), `SALES` (Live GOLD Rates, Negotiation/Service-Charge/Pledge-Estimation/Release-Payment Approvals, Threshold Settings), `TELESALES` (Bulk Assign, Calls, Leads, Manage Calls/Leads, Web Assign).

### Keys
- **PK**: `id`. **Incoming FKs**: `RolePermission.permission_group_id`, `PermissionResource.permission_group_id`.

---

## 5. `PermissionResource`

**Purpose** — The finest granularity: individual permission strings (e.g. `branches:select:view`, `purchases:create`) mapped to their parent `PermissionGroup`. Effectively the list of UI/API actions a group unlocks.

**Row count**: **353**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `resource` | text | NO | — | Action string `noun:verb[:qualifier]`. |
| `permission_group_id` | text | NO | — | FK → `PermissionGroup.id`. |

Resource strings follow a `noun:verb` (sometimes `:qualifier`) convention: `transactions:view`, `customers:view:history`, `ornaments:create`, `kyc:update`, `telesales:leads:merge`, `blocklist:add`, `bids:delete`, `purchases:update`, `states:view:select`, etc. The same resource can appear under multiple groups (e.g. `branches:select:view` in 19 groups) so many roles can share a common read.

### Keys
- **PK**: `id`. **FK**: `permission_group_id → PermissionGroup.id`.

---

## 6. `Branch`

**Purpose** — Physical White Gold branch offices where gold is purchased. Anchors transactions, employees, targets.

**Row count**: **142** (129 active `status=true`, 13 inactive; all `new_crm=true`).

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK (UUID). |
| `address` | text | YES | — | Street address. |
| `state` | text | YES | — | **Legacy** free-text state code (`KA`/`KL`/`AP`/`TS`), NULL for 72 rows. |
| `city` | text | YES | — | City/town. |
| `pin` | text | YES | — | 6-digit PIN. |
| `contact` | text | YES | — | Branch phone. |
| `email` | text | YES | — | Branch email. |
| `status` | boolean | NO | true | Branch open/active. |
| `created_at` | timestamp | NO | now() | Onboarded. |
| `updated_at` | timestamp | NO | — | Updated. |
| `region_id` | text | YES | — | FK → `Region.id` — **always NULL** (Region unused). |
| `name` | text | NO | — | Branch name (e.g. `ADUGODI`, `AP-ANAKAPALLI`). Join key GoldApp uses. |
| `data_push` | boolean | NO | true | Whether this branch's data is pushed to downstream systems. |
| `code` | text | YES | — | Short branch code (`ADU`, `CHI`, `KAP`). 134/142 set. Note `KAP` is reused across several AP branches. |
| `branch_code` | text | YES | — | Formal code `WG-2051`, `WG-2140`. 134/142 set. |
| `new_crm` | boolean | YES | true | Belongs to new CRM. |
| `gstin` | text | YES | — | Branch GSTIN (63/142 set). |
| `state_id` | text | YES | — | FK → `State.id` (proper state link, 134/142). |
| `cluster_id` | text | YES | — | FK → `Cluster.id` (134/142). |

### Keys & relationships
- **PK**: `id`.
- **Outgoing FKs**: `cluster_id → Cluster.id`, `region_id → Region.id` (unused), `state_id → State.id`.
- **Incoming FKs**: `Employee.branch_id`, `Target.branch_id`, `Transaction.branch_id`, `OLDTransaction.branch_id`, `Lead.branch_id`, `Lead.visited_branch_id`, `_BranchToUserRole.A`.

### Timestamps
`created_at` = branch onboarded; `updated_at` = record edited.

### Sample rows
```
{ name: AP-ANAKAPALLI, code: KAP, branch_code: WG-2140, city: Anakapalli, pin: 531002,
  state_id: →Andhra Pradesh, cluster_id: →Andhra Pradesh, region_id: null, status: true }
{ name: AP-VIZIANAGARM, code: KAP, branch_code: WG-2139, city: Vizianagaram, pin: 535002,
  state_id: →Andhra Pradesh, cluster_id: →Andhra Pradesh }
{ name: TS-KARIM NAGAR, code: KAP, branch_code: WG-2138, city: Karimnagar, pin: 505001,
  state_id: →Telangana, cluster_id: →Telangana }
```
Note duplicate/near-duplicate rows exist (e.g. `AP-CHITTOOR` vs `AP-CHITTOR`) — GoldApp canonicalizes via `lib/crmBranchAlias.js`.

### GoldApp usage (heavy)
- `app/api/sync-branches-auto/route.js` — treats `"Branch"` (name/address/city/pin/gstin) as the **authoritative valid-branch set**; auto-adds a Supabase master branch the first day it purchases, backfilling address fields (blanks only). Applies `aliasBranchName()` + `IGNORE_NAMES` (BRANCH/HO/HEAD OFFICE/TEST/DUMMY/NA/…) so stray purchase branch names can't create bogus masters.
- `lib/purchaseRegisterData.js`, `app/api/crm-purchases/route.js`, `app/api/sync-new-crm/route.js`, `app/api/productivity/route.js` — all `LEFT JOIN "Branch" b ON b.id=t.branch_id` to label transactions/purchases with branch name.

---

## 7. `Region`

**Purpose** — Designed mid-tier (State → Region → Cluster) with a required regional manager. **Empty in production — feature never launched.**

**Row count**: **0**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `name` | text | NO | — | Region name. |
| `created_at` | timestamp | NO | now() | — |
| `updated_at` | timestamp | NO | — | — |
| `manager_id` | text | NO | — | FK → `Employee.id` (regional manager) — mandatory but no rows. |

### Keys
- **PK**: `id`. **Outgoing FK**: `manager_id → Employee.id`. **Incoming FK**: `Branch.region_id` (all NULL).
- **Not used by GoldApp** (the "Region" facet in `components/productivity/Productivity.js` is derived from branch grouping, not this table).

---

## 8. `State`

**Purpose** — The Indian states White Gold operates in. Top of the live hierarchy; carries the per-state GSTIN used on invoices.

**Row count**: **4**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK (UUID). |
| `name` | text | NO | — | State name. |
| `created_at` | timestamp | NO | now() | — |
| `updated_at` | timestamp | NO | — | — |
| `code` | text | YES | — | 2-letter code. |
| `gstin` | text | YES | — | Company GSTIN registered in that state. |

### The 4 rows (non-PII, real)
| name | code | gstin |
|------|------|-------|
| Karnataka | KA | 29AAPCA3170M1Z5 |
| Kerala | KL | 32AAPCA3170M1ZI |
| Andhra Pradesh | AP | 37AAPCA3170M1Z8 |
| Telangana | TS | 36AAPCA3170M1ZA |

All GSTINs share PAN `AAPCA3170M` (same legal entity), differing by the state numeric prefix — standard for one company registered in 4 states.

### Keys & relationships
- **PK**: `id`. **Incoming FKs**: `Branch.state_id`, `GoldRate.state_id`, `Settings.state_id`, `_StateToUserRole.A`.

### GoldApp usage
- `app/api/gold-rates/route.js` and `app/api/purchases/live-rates/route.js` — `JOIN "State" s ON s.id=gr.state_id` to attach state name/code to live gold rates.

---

## 9. `Cluster`

**Purpose** — Operational grouping of branches within/across a state (the live mid-tier that replaced Region). Used for cluster-manager reporting.

**Row count**: **10**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK (UUID). |
| `name` | text | NO | — | Cluster name. |
| `created_at` | timestamp | NO | now() | — |
| `updated_at` | timestamp | NO | — | — |

### The 10 clusters
Andhra Pradesh · Telangana · Bangalore East · Bangalore North & West · Bangalore South · Rest of Karnataka · Kerala Central · Kerala East · Kerala North · Kerala South.

### Keys
- **PK**: `id`. **Incoming FK**: `Branch.cluster_id` (134/142 branches linked).
- No `state_id` column — cluster→state is inferred by name / by the branches that link to it. Managed via the "Cluster Management" permission group; the CRM role "Cluster Manager" designation (11 employees) operates at this level.

---

## 10. `Companies`

**Purpose** — External finance companies / banks / pawn-brokers referenced in the pledge-and-release flow (where a customer's gold is pledged elsewhere and White Gold takes it over). Essentially a lookup of third-party lenders, created ad-hoc by employees.

**Row count**: **486**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `name` | text | NO | — | Company name (free text, user-entered). |
| `type` | enum `CompanyType` | NO | — | Category (see enum). |
| `created_at` | timestamp | NO | now() | — |
| `updated_at` | timestamp | NO | — | — |
| `employee_id` | text | NO | — | FK → `Employee.emp_id` (who added it). |

### Enum `CompanyType` (13 values)
`GOLD_LOAN`, `HOUSING_FINANCE`, `MICROFINANCE`, `RETAIL_FINANCE`, `CORPORATE_FINANCE`, `OTHERS`, `BANK`, `COOPERATIVE_BANK`, `STATE_COOPERATIVE_BANK`, `MULTISTATE_COOPERATIVE`, `SMALL_FINANCE_BANK`, `PAWN_BROKER`.
Distribution: OTHERS 433 (dominant — users rarely pick a precise type), BANK 22, COOPERATIVE_BANK 6, GOLD_LOAN 6, STATE_COOPERATIVE_BANK 5, CORPORATE_FINANCE 3, SMALL_FINANCE_BANK 3, HOUSING_FINANCE 2, MULTISTATE_COOPERATIVE 2, RETAIL_FINANCE 2, MICROFINANCE 1, PAWN_BROKER 1.

### Keys & relationships
- **PK**: `id`. **Outgoing FK**: `employee_id → Employee.emp_id`.
- **Incoming FKs**: `Lead.company_id`, `PledgeCompany.company_id`.
- Because entries are free-text and mostly typed as OTHERS, the same real company appears under many spellings (e.g. "co operative", "jana finance", "MNC Bank"). Not consumed by GoldApp.

---

## 11. `Bank`

**Purpose** — Master list of Indian banks (for customer bank-account entry / payout selection). Static reference data.

**Row count**: **105** (all `active=true`).

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `name` | text | NO | — | Bank name. |
| `created_at` | timestamp | NO | now() | — |
| `updated_at` | timestamp | NO | — | — |
| `active` | boolean | NO | true | Selectable in dropdowns. |

### Keys
- **PK**: `id`. No FKs in/out (pure lookup; `BankAccount` stores the chosen bank by value, not via constrained FK).
- Sample names: Axis Bank, Bank of Baroda, AU Small Finance Bank, Bandhan Bank, Allahabad Bank, American Express Banking Corporation… Not used by GoldApp.

---

## 12. `Settings`

**Purpose** — Per-state, per-employee configuration events for gold-rate/threshold editing. In practice functions as an **audit/permission log for "who can edit gold rates in which state"** — the numeric min/max threshold columns are all NULL (that feature is unused); only `edit_goldrates` carries signal.

**Row count**: **8**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `created_at` | timestamp | NO | now() | When this settings event was written. |
| `updated_at` | timestamp | NO | — | — |
| `wastage_min` / `wastage_max` | float8 | YES | — | Allowed wastage % band — **all NULL**. |
| `service_charge_min` / `service_charge_max` | float8 | YES | — | Service-charge band — **all NULL**. |
| `gold_rate_9987_min` / `_max` | float8 | YES | — | 99.87% purity rate band — **all NULL**. |
| `gold_rate_8790_min` / `_max` | float8 | YES | — | 87.90% purity rate band — **all NULL**. |
| `gold_rate_7058_min` / `_max` | float8 | YES | — | 70.58% purity rate band — **all NULL**. |
| `state_id` | text | YES | — | FK → `State.id` (Kerala or Karnataka in current rows). |
| `employeeId` | text | NO | — | FK → `Employee.id` (who the setting applies to/was set by). |
| `edit_goldrates` | boolean | NO | false | Whether gold-rate editing is enabled for that state/employee. |

The 3 purity tiers (9987 / 8790 / 7058) correspond to 24K-ish / 22K / ~17K fineness bands White Gold prices against. All 8 rows belong to a single employee (`7ae9da51-…`) across Kerala & Karnataka, toggling `edit_goldrates`.

### Keys
- **PK**: `id`. **FKs**: `state_id → State.id`, `employeeId → Employee.id`.
- Threshold logic in GoldApp comes from Supabase, not this table.

---

## 13. `Assignment`

**Purpose** — Lead-routing rule: for a given lead-source group (§14), which telecaller (`assignee`) receives leads, who supervises (`reporter`), and how many cases have flowed through. Round-robin / ownership map for inbound leads.

**Row count**: **9**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | uuid | NO | — | PK. |
| `group_id` | uuid | NO | — | FK → `AssignmentGroup.id` (lead source). |
| `assignee_id` | text | NO | — | FK → `Employee.emp_id` (telecaller who gets the leads). |
| `reporter_id` | text | YES | — | FK → `Employee.emp_id` (supervisor). |
| `created_at` | timestamp | NO | now() | Rule created. |
| `updated_at` | timestamp | NO | — | Last time counter/rule changed. |
| `cases` | integer | NO | 0 | Cumulative leads routed to this assignee for this source. |

### Keys
- **PK**: `id`. **FKs**: `group_id → AssignmentGroup.id`, `assignee_id → Employee.emp_id`, `reporter_id → Employee.emp_id`.

### Sample
```
group=WEBFORM  assignee=WG00589 reporter=WG00935 cases=11899
group=JUSTDIAL assignee=WG00589 reporter=WG00935 cases=992
group=Meta-WG Money-MALAYALAM assignee=WGINT-0027 reporter=WG00328 cases=208
```
High `cases` counts show WEBFORM/JUSTDIAL are the dominant lead sources. Not used by GoldApp.

---

## 14. `AssignmentGroup`

**Purpose** — Lead-source channels that leads arrive from (used to bucket `Assignment` routing).

**Row count**: **6**.

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | uuid | NO | — | PK. |
| `name` | text | NO | — | Channel name. |
| `created_at` | timestamp | NO | now() | — |
| `updated_at` | timestamp | NO | — | — |

The 6 groups: `JUSTDIAL`, `WEBFORM` (both seeded 2025-12-22), and four Meta ad campaigns added 2026-07: `Meta - WG Money - ENG`, `- KANNADA`, `- MALAYALAM`, `- TELUGU` (one per language).

### Keys
- **PK**: `id`. **Incoming FK**: `Assignment.group_id`.

---

## 15. `Target`

**Purpose** — Monthly performance targets set per branch (grams purchased, service-charge revenue, bill count, wastage). Stored as an **append-only history** — each edit inserts a new row rather than updating, so a branch has many rows (up to 15).

**Row count**: **818** across **111** branches (created 2026-06-12 → 2026-07-02).

### Columns
| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|---------|
| `id` | text | NO | — | PK. |
| `monthly_target` | float8 | YES | 0 | Target grams of gold for the month. |
| `service_charge_target` | float8 | YES | 0 | Target service-charge revenue (₹). |
| `bill_target` | float8 | YES | 0 | Target number of bills/transactions. |
| `wastage_target` | float8 | YES | 0 | Target wastage grams. |
| `branch_id` | text | NO | — | FK → `Branch.id`. |
| `updated_by_id` | text | YES | — | FK → `Employee.id` (who set it). |
| `created_at` | timestamp | NO | now() | When this target version was written. |
| `updated_at` | timestamp | NO | — | — |

### Keys
- **PK**: `id`. **FKs**: `branch_id → Branch.id`, `updated_by_id → Employee.id`.
- To get a branch's current target, take the latest `created_at` per `branch_id`.

### Sample
```
branch=daa77339… monthly=3500g service_charge=₹275000 bills=110 wastage=60g  (2026-07-02)
branch=b1b30846… monthly=1000g service_charge=₹85000  bills=40  wastage=22.5g (2026-06-29)
```
Feeds the CRM "Branch Targets" permission group / "Branch Targets Report". Not read directly by GoldApp today.

---

## 16. `_BranchToUserRole` (Prisma implicit M:N)

**Purpose** — Scopes a `UserRole` to a set of `Branch`es (a role's visible/allowed branches). Prisma implicit join table for a many-to-many `Branch ↔ UserRole`.

**Row count**: **2080**.

### Columns
| Column | Type | Null | Meaning |
|--------|------|------|---------|
| `A` | text | NO | FK → `Branch.id`. |
| `B` | text | NO | FK → `UserRole.id`. |

- No surrogate PK; unique index on (`A`,`B`). A role tied to many branches (2080 pairs across 19 roles ≈ broad scoping — several roles cover most of the 142 branches).

---

## 17. `_StateToUserRole` (Prisma implicit M:N)

**Purpose** — Scopes a `UserRole` to a set of `State`s (e.g. "Kerala Sales Access" limited to Kerala). Prisma implicit join for `State ↔ UserRole`.

**Row count**: **63**.

### Columns
| Column | Type | Null | Meaning |
|--------|------|------|---------|
| `A` | text | NO | FK → `State.id`. |
| `B` | text | NO | FK → `UserRole.id`. |

- Unique index on (`A`,`B`). Example: "Test Account", "Telesales Executive", "ADMIN", "Finance", "Operations", "Read Only All" all scoped to Andhra Pradesh (and typically the other states too). 63 pairs ≈ most roles span all 4 states, a few are state-specific.

---

## Appendix A — Entity relationship summary (this cluster)

```
State ──< Branch >── Cluster
  │         │  └─(region_id → Region  [UNUSED])
  │         ├──< Employee (branch_id)
  │         ├──< Target (branch_id, versioned history)
  │         └──< Transaction / Lead / OLDTransaction (branch_id)  [other clusters]
  ├──< GoldRate.state_id / Settings.state_id                      [rates cluster]
  ├──< _StateToUserRole >── UserRole
  └─ (Region.manager_id → Employee.id)

Employee ──(role, enum)  legacy coarse role
   │      ──(role_id) → UserRole ──< RolePermission >── PermissionGroup ──< PermissionResource
   │                       ├──< _BranchToUserRole >── Branch
   │                       └──< _StateToUserRole  >── State
   ├──< Companies (employee_id → emp_id)
   ├──< Assignment (assignee_id / reporter_id → emp_id)
   └── (referenced by ~30 tables via emp_id or id — see §0.3)

AssignmentGroup ──< Assignment >── Employee
Bank  (standalone lookup, 105 rows)
```

## Appendix B — Key gotchas
1. **Region is empty** — never join through it; use `Cluster` + `State`.
2. **Two Employee keys** — always COALESCE `emp_id` (WGxxxxx) and `id` (UUID) when resolving actors.
3. **Two role systems** — GoldApp reads the enum `Employee.role`; the CRM UI uses `role_id`/RBAC. `access_level` (BRANCH/HO) is a separate scoping axis.
4. **Branch.state (text) vs state_id** — prefer `state_id`; the text column is legacy and 72 rows are NULL.
5. **Target is append-only** — dedupe by latest `created_at` per branch.
6. **Settings thresholds all NULL** — only `edit_goldrates` is meaningful; it is effectively a gold-rate-edit permission log.
7. **Companies is 89% OTHERS + free-text** — unreliable for typed categorization; expect duplicate spellings.
8. GoldApp's authoritative NEW-CRM reads in this cluster are: `sync-branch-employees` (Employee+Branch), `sync-branches-auto` (Branch validity gate), `gold-rates`/`live-rates` (State), `productivity`/`crm-purchases`/`purchaseRegisterData` (Branch labels).
```


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-2"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 2 — Lead & Calling Funnel
# ═══════════════════════════════════════════

# NEW CRM — Cluster 2: Lead & Calling Funnel

> **Scope:** the pre-purchase front funnel of the NEW CRM Postgres DB (`dbwhitegold_production` on AWS Lightsail RDS, `ap-south-1`).
> **Tables:** `Lead`, `LeadHistory`, `Call`, `CallHistory`, `Gnani`, `Notification`, `Blocklist`, `ActionControl`.
> **Nature:** READ-ONLY technical deep-dive. All identifiers are PascalCase and must be quoted (`SELECT * FROM "Lead"`).
> **Snapshot date:** 2026-08-06. Row counts are live and grow continuously.

---

## 0. Cluster overview — the lead → call → follow-up → conversion funnel

This cluster is the **top of the White Gold sales funnel**: it captures inbound/outbound interest, drives the tele-calling operation, and hands warm leads off to a branch as a **walk-in Transaction**. The downstream purchase machinery (Transaction, Estimation, Quotation, KYC, Payment, Order, Release) lives in other clusters; this cluster **feeds** them.

The end-to-end flow:

```
  Ad / Website / Webform / TV / Bus campaign / JustDial / Social
        │  (marketing "source" / "survey")
        ▼
   ┌─────────┐   incoming call OR webform push
   │  Call   │◄──────────────────────────────────────────────┐
   │ (event) │   auto-dialer / IVR / Gnani voicebot           │
   └────┬────┘                                                │
        │ call.customer_mobile matched / de-duped              │ repeat &
        ▼                                                      │ follow-up
   ┌─────────┐   status machine: PENDING → PLANNING_TO_VISIT   │ calls
   │  Lead   │   → ENQUIRY / INVALID / VISITED / MERGED         │
   │(entity) │───────────────────────────────────────────────┘
   └────┬────┘
        │ lead.transaction_id  (1:1, UNIQUE)  set when customer walks in
        ▼
   ┌──────────────┐    ActionControl gates the UI actions on this txn
   │ Transaction  │───────────────────────────────────────────────► (purchase clusters)
   │  (walk-in)   │    Notification pings employees at each stage
   └──────────────┘
```

**Two parallel history tables** provide an append-only audit trail:
- `LeadHistory` — one row per **lead status change** (avg 1.41 rows/lead, max 9).
- `CallHistory` — one row per **call state transition / snapshot** (≈1.27 rows per Call; it also denormalises a copy of the lead fields at the time of the call).

**The exact status vocabulary of this cluster:**

| Domain | Enum | Values |
|---|---|---|
| Lead lifecycle | `LeadStatus` | `PENDING`, `ENQUIRY`, `PLANNING_TO_VISIT`, `VISITED`, `VISITED_SOLD`, `VISITED_NOT_SOLD`, `INVALID`, `MERGED`, `TEST_CALL` |
| Lead intent | `LeadTransactionType` | `PHYSICAL_GOLD`, `RELEASED_GOLD` |
| Lead visit outcome | `LeadVisitStatus` | `SOLD`, `NOT_SOLD` |
| Call outcome | `CallStatus` | `PENDING`, `CALLING`, `ANSWERED`, `RNR`, `MISSED_CALL`, `UNANSWERED_CALL`, `REPEATED_CALL` |
| Call direction | `CallDirection` | `INCOMING`, `OUTGOING` |
| Voicebot analysis | `GnaniProcessingStatus` | `PENDING`, `QUEUED`, `COMPLETED`, `FAILED` |
| Voicebot verdict | `GnaniStatus` | `VALID`, `INVALID` |
| Blocklist reason | `BlocklistType` | `BLOCK`, `THEFT` |

`Call.action` and `CallHistory.action` are **free-text** telephony provider raw codes (not an enum): `ANSWER`, `BUSY`, `ASSIGNED`, `NOANSWER`, `CANCEL`, `Executive Busy`, `RINGING`, `CONNECTING`.

**Conversion headline (snapshot):** of 110,061 leads, **3,081 (2.8%) carry a `transaction_id`** (converted to a walk-in). 28,593 reached `VISITED` but only 3,067 of those are linked to a Transaction — the rest are visits logged before/without a CRM transaction record. INVALID is the single largest bucket (50,626 ≈ 46%), i.e. the calling team disqualifies nearly half of all leads.

---

## 1. `Lead` — the lead entity (110,061 rows)

### 1.1 Purpose
The canonical record of one prospective customer's interest. Created from a marketing source (website, webform, TV, bus ad, JustDial…) or an inbound/outbound call. Carries the customer's contact, rough gold weight, intent (sell physical gold vs. release pledged gold), assigned calling employee, target branch, and — once they walk in — a 1:1 link to a `Transaction`. `new_crm = true` on **all** rows (this DB only holds new-CRM leads).

### 1.2 Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text (uuid) | NO | — | **PK**. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Lead creation time. Range 2025-12-29 → live. |
| `updated_at` | timestamp | NO | — | Last modification. |
| `customer_mobile` | text | NO | — | Primary phone. **Indexed** (`lead_customer_mobile_index`, plus composite `(customer_mobile,status)`). Core matching key against `Call.customer_mobile`. |
| `alternate_phone_number` | text | YES | — | Second phone; indexed. |
| `invalid_reason` | text | YES | — | Free-text disqualification reason (set when `status=INVALID`). See §1.5. |
| `other_reason` | text | YES | — | Free-text overflow when `invalid_reason='Others'`. |
| `branch_id` | text | YES | — | **FK → Branch.id**. Branch the lead is assigned to (nearest / preferred). |
| `employee_id` | text | YES | — | **FK → Employee.emp_id** (note: `emp_id` = `WGxxxxx` code, not the UUID). Calling agent who owns the lead. |
| `status` | `LeadStatus` | NO | — | Lifecycle state. Indexed. See §1.4. |
| `parent_lead_id` | text | YES | — | **FK → Lead.id** (self-ref). Set when this lead is a duplicate merged into another (see `MERGED`). 622 rows have a parent. |
| `transaction_type` | `LeadTransactionType` | YES | — | Intent: `PHYSICAL_GOLD` (sell) vs `RELEASED_GOLD` (release/takeover pledged gold). 43,112 null (not yet qualified). |
| `approx_gross_weight` | float8 | YES | — | Customer-stated rough gold weight (grams). Consumed downstream by GoldApp (see §9). |
| `customer_name` | text | NO | — | Prospect name. |
| `customer_location` | text | YES | — | Free-text / geocoded address string. |
| `visit_date` | timestamp | YES | — | Actual date the lead visited a branch. |
| `visited_branch_id` | text | YES | — | **FK → Branch.id**. Branch actually visited (may differ from assigned `branch_id`). |
| `transaction_id` | text | YES | — | **FK → Transaction.id, UNIQUE (1:1)**. The conversion link — set when the lead becomes a walk-in. 3,081 populated. |
| `remarks` | text | YES | — | Agent's free-text note. |
| `survey` | text | YES | — | **Marketing channel / source name** (e.g. `Website`, `WEBFORM`, `Kerala Leads`, `ROK Bus Campaign`). See §1.5. |
| `survey_advertisement` | text | YES | — | Sub-channel / specific ad. |
| `survey_custom` | text | YES | — | Free-text custom source. |
| `not_sold_reason` | text | YES | — | Why a visited lead did not sell (free-text; e.g. `price issue`, `kyc rejected`). |
| `new_crm` | bool | YES | `true` | Always true here. Legacy discriminator vs old CRM. |
| `company_id` | text | YES | — | **FK → Companies.id**. For `RELEASED_GOLD` leads: the NBFC/bank the gold is currently pledged with. |
| `company_name` | text | YES | — | Free-text pledgee name (dirty: `muthoot`, `Muthoot finace`, `manappuram`…). |
| `pledge_location` | text | YES | — | Where the gold is currently pledged. |
| `planning_to_visit_date` | timestamp | YES | — | Promised/booked future visit date (drives follow-up when `status=PLANNING_TO_VISIT`). |
| `branch_gross_weight` | float8 | YES | — | Weight as re-stated at branch (vs customer's `approx_gross_weight`). |
| `visit_status` | `LeadVisitStatus` | YES | — | `SOLD` / `NOT_SOLD` outcome of the visit. Mostly null (106,589); 2,162 SOLD, 1,311 NOT_SOLD. |

### 1.3 Keys & relationships
- **PK:** `id`.
- **Out-FKs:** `branch_id`→Branch, `visited_branch_id`→Branch, `employee_id`→Employee.emp_id, `company_id`→Companies, `parent_lead_id`→Lead (self), `transaction_id`→Transaction (UNIQUE).
- **In-FKs (children point here):** `LeadHistory.leadId`, `Call.lead_id`, `Notification.lead_id`.
- **Indexes:** PK; unique on `transaction_id`; btree on `customer_mobile`, `alternate_phone_number`, `status`, and composite `(customer_mobile,status)` — all tuned for phone-number de-dup and status filtering by the calling team.

### 1.4 `LeadStatus` state machine (with live counts)

| Status | Count | Meaning / position in funnel |
|---|---:|---|
| `PENDING` | 0* | Freshly created, not yet worked. (Currently 0 in `Lead` but present as a transient; leads move off it quickly.) |
| `ENQUIRY` | 26,993 | Active/warm — customer enquired, being nurtured. Largest **live** working bucket. |
| `PLANNING_TO_VISIT` | 2,951 | Customer committed to visit; `planning_to_visit_date` set → drives Followup Reminder notifications. |
| `VISITED` | 28,593 | Customer walked into a branch. 3,067 of these carry a `transaction_id`. |
| `VISITED_SOLD` | 0 | Reserved enum value — visited and sold (in practice tracked via `visit_status=SOLD`). |
| `VISITED_NOT_SOLD` | 0 | Reserved — visited, didn't sell (tracked via `visit_status=NOT_SOLD` + `not_sold_reason`). |
| `INVALID` | 50,626 | Disqualified / dead (wrong number, no plans, wants to pledge, sub-threshold weight…). ~46% of all leads. |
| `MERGED` | 601 | Duplicate folded into a `parent_lead_id`. |
| `TEST_CALL` | 298 | Internal test / QA calls, excluded from real funnel metrics. |

\* The `PENDING` value exists in the enum and appears heavily in `Call.status`/`CallHistory`, but `Lead.status` rows resolve off PENDING immediately, so the live Lead distribution shows none.

Typical progression: `PENDING → ENQUIRY → PLANNING_TO_VISIT → VISITED (+transaction_id) → [downstream Transaction]`, with `INVALID` and `MERGED` as terminal side-exits.

### 1.5 Key free-text vocabularies (top values)

**`invalid_reason`** (why leads die): `No plans` (11,540), `Want to release less than 10 gms gold` (4,114), `Want to sell less than 5 gms physical gold` (3,861), `Invalid number` (3,861), `Not enquired` (3,481), `Location not feasible (barring our existing branches)` (3,250), `Others` (2,715), `Number Does Not Exist` (2,481), `Want to sell silver` (2,012), `Want to pledge gold` (1,857), `Wrong number`, `Call by mistake`, `Incoming Number Barred`, `Marketing call`. (~19,843 leads have an empty-string reason.)

**`survey`** (marketing source): `Website` (47,403), `WEBFORM` (16,185), `Kerala Leads` (13,511), `Andhra Pradesh Calls` (11,436), `Call Back` (4,031), `ROK Bus Campaign` (3,000), `BMTC Bus Campaign` (2,224), `Social Media New`, `Signage`, `JUSTDIAL`, `Zee Kannada`, `Callcenter`, `Colors Kannada`, `TV 9`, `News 18`. → shows the channel mix: digital (website/webform) dominates, then regional call lists, bus-wrap campaigns, and TV.

**`not_sold_reason`**: `will check and get back`, `price issue`, `kyc rejected`, `price enquiry`, `low purity`, `verification failed`, `will come tomorrow`, `release loss`, `taken quotation`.

### 1.6 Masked sample rows

```jsonc
// Converted lead (walked in, PHYSICAL_GOLD, has transaction_id)
{ "id":"886fd141-…","created_at":"2026-08-06T00:56:10Z","updated_at":"2026-08-06T01:31:28Z",
  "customer_mobile":"9xxxxxxxxx","status":"VISITED","transaction_type":"PHYSICAL_GOLD",
  "approx_gross_weight":10,"customer_name":"Name","branch_id":"35be6e9d-…",
  "employee_id":"WG00973","visit_date":"2026-08-06T01:30:00Z","visited_branch_id":"35be6e9d-…",
  "transaction_id":"d21bd64c-…","remarks":"visited","survey":"Website","new_crm":true }

// Converted lead (Kerala, sold)
{ "id":"663cc596-…","status":"VISITED","transaction_type":"PHYSICAL_GOLD","approx_gross_weight":9.96,
  "customer_mobile":"9xxxxxxxxx","employee_id":"WG-INT-0025","transaction_id":"2237b00e-…",
  "remarks":"sold","survey":"Kerala Leads","customer_location":"Kottayam … Kerala, India" }

// Dead lead (INVALID, no transaction)
{ "id":"b28278a9-…","status":"INVALID","invalid_reason":"No plans","transaction_type":null,
  "customer_mobile":"9xxxxxxxxx","employee_id":"WG00780","transaction_id":null,
  "survey":"Website","remarks":"Cx not ready to give proper details and he already sold with…" }
```

---

## 2. `LeadHistory` — lead status audit trail (155,711 rows)

### 2.1 Purpose
Append-only log: **one row each time a lead's status is set/changed**, capturing who did it and any remark. Powers the lead timeline and per-agent productivity/stage-timing analysis. Avg 1.41 history rows per lead (max 9).

### 2.2 Columns

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | text (uuid) | NO | **PK**. |
| `leadId` | text | YES | **FK → Lead.id** (note camelCase). Parent lead. |
| `visited_date` | timestamp | YES | Timestamp of the visit (set on VISITED transitions). |
| `visit_date` | timestamp | YES | Planned/target visit date snapshot. |
| `status` | `LeadStatus` | NO | The status **being recorded** at this step. |
| `remarks` | text | YES | Agent note for this transition. |
| `employee_id` | text | YES | **FK → Employee.id** (UUID form here, unlike `Lead.employee_id` which uses `emp_id`). Who made the change. |
| `created_at` | timestamp | NO | When the change happened — the true event clock. |
| `invalid_reason` | text | YES | Reason snapshot when moving to INVALID. |

### 2.3 Status distribution (transitions, not current state)
`ENQUIRY` 57,104 · `INVALID` 51,335 · `VISITED` 29,099 · `PLANNING_TO_VISIT` 17,871 · `TEST_CALL` 304. (PLANNING_TO_VISIT is far more common as a *transition* than as a resting state — leads pass through it then move on.)

### 2.4 Masked samples
```jsonc
{ "leadId":"dc6ca7dc-…","status":"VISITED","visited_date":"2026-08-06T01:41:00Z",
  "remarks":"Visited","employee_id":"c976c821-… (uuid)","created_at":"2026-08-06T01:41:57Z" }
{ "leadId":"6680ad95-…","status":"ENQUIRY","remarks":"Will let us know about the visit","created_at":"2026-08-06T01:41:42Z" }
{ "leadId":"e6e963ad-…","status":"INVALID","invalid_reason":"Want to pledge gold","remarks":"Wanted to pledge gold","created_at":"2026-08-06T01:41:33Z" }
```

---

## 3. `Call` — the live/current call record (391,347 rows)

### 3.1 Purpose
One row per call **event** between a customer and the calling operation (or the Gnani voicebot). Holds the current state of that call, telephony provider IDs, recording URL, marketing attribution (UTM + Meta ad fields), and links to the Lead and calling Employee. This is the **highest-volume operational table** in the cluster.

### 3.2 Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text (uuid) | NO | — | **PK**. |
| `created_at` / `updated_at` | timestamp | NO | `CURRENT_TIMESTAMP` / — | Event create / last update. Range 2025-12-29 → live. |
| `call_id` | text | NO | — | **Telephony provider's call reference. UNIQUE** (`Call_call_id_key`). |
| `action` | text | NO | — | Raw provider action code (free-text; see §3.4). Indexed. |
| `recording_url` | text | YES | — | URL of the call recording (if captured). |
| `call_direction` | `CallDirection` | NO | — | `INCOMING` (216,215) / `OUTGOING` (175,137). |
| `start_time` / `end_time` | text | YES | — | Call start/end (stored as text strings, not timestamps). |
| `status` | `CallStatus` | NO | — | Call outcome state. Indexed. See §3.4. |
| `lead_id` | text | YES | — | **FK → Lead.id**. 268,586 linked (68%); 122,767 unlinked (raw inbound not yet tied to a lead). Indexed. |
| `employee_id` | text | YES | — | **FK → Employee.emp_id**. Agent handling the call. |
| `customer_mobile` | text | NO | — | Customer phone. Indexed — the join key to Lead. |
| `missed_call_count` | int | YES | — | Number of missed attempts rolled into this record. |
| `source` | text | YES | — | Marketing source (mirrors Lead.survey vocabulary; top: `WEBFORM` 190k, `Website` 98k, `Andhra Pradesh Calls`, `Kerala Leads`, `Call Back`, bus campaigns, `JUSTDIAL`…). |
| `metadata` | jsonb | YES | — | Provider/lead payload, e.g. `{name, mobile, gross_weight, utm_*}`. Webform pushes arrive as `{"name":"Live Gold API Lead","mobile":"…"}`. |
| `gross_weight` | int | YES | — | Rough gold weight stated on the call. Indexed. |
| `disconnected_by` | text | YES | — | `Customer` (201,307) / `Executive` (102,393) / null. |
| `is_post_working_hour` | bool | YES | `false` | Call landed outside working hours. |
| `utm_campaign` / `utm_medium` / `utm_source` | text | YES | — | Web attribution (mostly empty-string; `google`, `ig`, `fb`, `chatgpt.com` seen). |
| `gnani_id` | text | YES | — | **FK → Gnani.id, UNIQUE**. Set when the call was handled/analysed by the Gnani voicebot. Only 57 populated. |
| `meta_ad_id` / `meta_ad_name` / `meta_adset_id` / `meta_adset_name` / `meta_campaign_id` / `meta_campaign_name` / `meta_form_id` / `meta_lead_id` / `meta_platform` | text | YES | — | Meta (Facebook/Instagram) Lead-Ads attribution. Currently unused in this DB (`meta_lead_id` 100% null) — schema provisioned for Meta lead-ad ingestion. |

### 3.3 Keys & relationships
- **PK:** `id`. **UNIQUE:** `call_id`, `gnani_id`.
- **Out-FKs:** `lead_id`→Lead, `employee_id`→Employee.emp_id, `gnani_id`→Gnani.
- **In-FK:** none direct; `CallHistory` links logically by `call_id` (not a DB FK).
- **Indexes:** PK, unique(call_id), unique(gnani_id), btree on `action`, `customer_mobile`, `lead_id`, `status`, `gross_weight`.

### 3.4 Call state model
`CallStatus` (enum) — current values in use:
| status | count | meaning |
|---|---:|---|
| `ANSWERED` | 262,328 | Call connected & answered. |
| `RNR` | 81,697 | Ring No Response (rang, not picked). |
| `PENDING` | 29,940 | Queued / not yet dialled or in progress. |
| `REPEATED_CALL` | 17,387 | A repeat attempt to the same customer. |
| `CALLING` / `MISSED_CALL` / `UNANSWERED_CALL` | — | Defined in enum, transient / not present in current snapshot. |

`action` (free-text provider code) — `ANSWER` 203k, `BUSY` 90k, `ASSIGNED` 77k, `NOANSWER` 10k, `CANCEL` 5.4k, `Executive Busy` 2.2k, `RINGING`, `CONNECTING`. The status↔action crosstab confirms: `ANSWERED`↔`ANSWER` (203k), `RNR`↔`BUSY`/`NOANSWER`, `PENDING`↔`ASSIGNED`, `REPEATED_CALL`↔`ASSIGNED`. So **`action` is the raw dialer event; `status` is the CRM's normalised bucket** derived from it. Avg 2.55 calls per linked lead (max 2,103 — a hot/looping number).

### 3.5 Masked sample (webform inbound, PENDING/ASSIGNED)
```jsonc
{ "id":"829a3e26-…","call_id":"63030696221786000315651","action":"ASSIGNED","status":"PENDING",
  "call_direction":"INCOMING","source":"WEBFORM","employee_id":"WG01011","customer_mobile":"9xxxxxxxxx",
  "lead_id":null,"gnani_id":null,"metadata":{"name":"Live Gold API Lead","mobile":"6303069622","utm_medium":"","utm_source":"","utm_campaign":""},
  "disconnected_by":null,"is_post_working_hour":false,"created_at":"2026-08-06T01:41:55Z" }
```

---

## 4. `CallHistory` — call audit trail + denormalised lead snapshot (496,344 rows)

### 4.1 Purpose
The **largest table in the cluster**. Append-only log of call state transitions/snapshots. Unlike `Call`, it (a) keyed uniquely by `call_id`, (b) **denormalises a copy of the associated lead's fields** (`lead_*`) as they were at call time, and (c) carries the fresh/follow-up classification flags used for calling-productivity analytics.

### 4.2 Columns (delta vs `Call`)
Shares the core call fields (`call_id` UNIQUE, `customer_mobile`, `action`, `status`, `call_direction`, `recording_url`, `missed_call_count`, `start_time`, `end_time`, `source`, `metadata`, `gross_weight`, `disconnected_by`, `is_post_working_hour`, `lead_id`, `employee_id`). Additional/notable columns:

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `dialstatus` | text | YES | — | Provider dial status. **100% null** in snapshot (reserved). |
| `is_fresh_call` | bool | YES | `true` | First-touch call to this customer. 119,555 true. |
| `is_followup_call` | bool | YES | `false` | A scheduled follow-up. 4,780 true. |
| `lead_alternate_phone` | text | YES | — | Snapshot of Lead.alternate_phone_number. |
| `lead_branch_id` | text | YES | — | Snapshot of Lead.branch_id. |
| `lead_customer_name` | text | YES | — | Snapshot of Lead.customer_name. |
| `lead_invalid_reason` | text | YES | — | Snapshot of Lead.invalid_reason. |
| `lead_location` | text | YES | — | Snapshot of Lead.customer_location. |
| `lead_other_reason` | text | YES | — | Snapshot of Lead.other_reason. |
| `lead_plan_visit_date` | timestamp | YES | — | Snapshot of Lead.planning_to_visit_date. |
| `lead_status` | `LeadStatus` | YES | — | **Snapshot of the lead's status at call time.** Indexed. |
| `lead_visit_date` | timestamp | YES | — | Snapshot of Lead.visit_date. |
| `lead_approx_weight` | float8 | YES | — | Snapshot of Lead.approx_gross_weight. |

> **No DB-level FKs** on this table (unlike `Call`). It links by value: `call_id` (unique) back to `Call`, `lead_id` to `Lead`. Indexed on `call_id`, `lead_id`, `lead_status`, `customer_mobile`, `status`, `gross_weight`.

### 4.3 Distributions
- `status`: `PENDING` 216,044 · `RNR` 134,088 · `ANSWERED` 120,935 · `REPEATED_CALL` 25,284.
- `action`: `ASSIGNED` 173k · `BUSY` 123k · `ANSWER` 119k · `CANCEL` 49k · `NOANSWER` 18k · `Executive Busy` 9.7k.
- `call_direction`: `INCOMING` 324,021 · `OUTGOING` 172,330.
- fresh/followup flags: fresh-only 119,479 · neither 372,092 · followup-only 4,704 · both 76.
- `lead_status` snapshot: null 328,362 (call not yet lead-linked) · `ENQUIRY` 98,652 · `INVALID` 45,661 · `PLANNING_TO_VISIT` 14,995 · `TEST_CALL` 7,618 · `VISITED` 1,031 · `MERGED` 32.

### 4.4 Masked sample
```jsonc
{ "id":"3d173833-…","call_id":"63030696221786000315651","customer_mobile":"9xxxxxxxxx",
  "action":"ASSIGNED","status":"PENDING","call_direction":"INCOMING","source":"WEBFORM",
  "employee_id":"WG01011","lead_id":null,"lead_status":null,"is_fresh_call":false,"is_followup_call":false,
  "metadata":{"name":"Live Gold API Lead","mobile":"6303069622"},"created_at":"2026-08-06T01:41:55Z" }
```

---

## 5. `Gnani` — AI voicebot / auto-dialer call analysis (57 rows)

### 5.1 Purpose
**Gnani.ai** is a third-party conversational-AI / voicebot vendor. This table is the CRM-side record of a voicebot-handled call and its **post-call analytics**: transcript, sentiment, emotion, QA/analytics scores, detected language, and a VALID/INVALID verdict on the lead. A `Call` row points to it via `Call.gnani_id` (UNIQUE, so 1 Gnani ↔ 1 Call).

### 5.2 Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text (uuid) | NO | — | **PK** (referenced by `Call.gnani_id`). |
| `processing_status` | `GnaniProcessingStatus` | NO | `'PENDING'` | Pipeline state: `PENDING`→`QUEUED`→`COMPLETED`/`FAILED`. **All 57 rows PENDING** — analysis never ran on this batch. |
| `remarks` | text | YES | — | Bot/analysis remark. |
| `transcript` | text | YES | — | Call transcript (JSON array of `{speaker,…}` turns, per the GoldApp parser). |
| `agent_sentiment` | text | YES | — | Sentiment of the (bot) agent. |
| `customer_sentiment` | text | YES | — | Sentiment of the customer. |
| `emotion` | text | YES | — | Detected emotion. |
| `analytics_score` | float8 | YES | — | Overall analytics score. |
| `qa_score` | float8 | YES | — | Quality-assurance score. |
| `status` | `GnaniStatus` | YES | — | `VALID` / `INVALID` verdict on the lead. All null here. |
| `language` | text | YES | — | Detected language (Kannada/Telugu/etc.). All null here. |
| `created_at` / `updated_at` | timestamp | NO | `CURRENT_TIMESTAMP` / — | Created 2026-02-18 (a single ~40-min batch window). |

### 5.3 State of the integration
All 57 rows are a **single pilot batch on 2026-02-18**, all `processing_status=PENDING` with every analysis field null. The joined calls are real (`status=ANSWERED`, `action=ANSWER`, `INCOMING`). **Conclusion: the CRM's Gnani analytics pipeline was piloted once and never completed/rolled out inside the CRM DB.** The *actual* Gnani voicebot recordings live on S3 and are consumed by GoldApp separately (see §9) — GoldApp does **not** read this CRM `Gnani` table.

### 5.4 Masked sample
```jsonc
{ "id":"af1c0838-…","processing_status":"PENDING","transcript":null,"agent_sentiment":null,
  "customer_sentiment":null,"emotion":null,"analytics_score":null,"qa_score":null,"status":null,
  "language":null,"created_at":"2026-02-18T00:10:08Z" }
// Joined Call: { gnani_id:"9d90ef1e-…", status:"ANSWERED", action:"ANSWER", call_direction:"INCOMING" }
```

---

## 6. `Notification` — in-app employee notifications (118,117 rows)

### 6.1 Purpose
In-app / push notifications delivered to **employees** (not customers) as a transaction moves through its lifecycle, plus follow-up reminders on leads. Each carries a `web_url` deep-link into the CRM UI. Effectively the CRM's work-queue signalling layer that ties the calling funnel to downstream purchase stages.

### 6.2 Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text (uuid) | NO | — | **PK**. |
| `employee_id` | text | YES | — | **FK → Employee.id** (UUID). Recipient. |
| `title` | text | YES | — | Notification headline (see §6.3). |
| `content` | text | YES | — | Body text (e.g. "Payment request from HOSAKOTE branch. Click to view"). |
| `web_url` | text | YES | — | Deep-link, e.g. `/transaction/{id}/quotation/{id}`, `/payments`. |
| `created_at` | timestamp | NO | `CURRENT_TIMESTAMP` | Sent time. Range 2026-04-05 → live (younger than other tables — feature added later). |
| `read` | bool | NO | `false` | Read flag. Only 1,397 read vs 116,616 unread — largely fire-and-forget. |
| `transaction_id` | text | YES | — | **FK → Transaction.id**. Indexed. 108,527 rows link to a txn. |
| `lead_id` | text | YES | — | **FK → Lead.id**. For lead-level (follow-up) notifications. |

### 6.3 Title vocabulary (top)
`Sales Negotiation` 55,877 · `Final Payment Pending` 30,369 · `Followup Reminder` 9,475 · `KYC Verification` 6,846 · `Pledge Estimation` 6,457 · `Final Payment Completed` 3,240 · `Release Payment Update` 2,607 · `Release Payment` 1,290 · `Purity Evaluation` 620 · `New update from Sales Team` · `KYC Rejected` · `Stone Evaluation` · `Customer Walkout` · `KYC Approved` · `Revaluation Completed` · `OCR Completed`. → mirrors the downstream Transaction stage machine; `Followup Reminder` is the lead-side one.

### 6.4 Masked samples
```jsonc
{ "employee_id":"e4114758-… (uuid)","title":"Revaluation Completed","content":"Revaluation has been completed. Click here to view details","web_url":"/transaction/9ec4…/quotation/9880…","read":false,"transaction_id":"9ec4…","lead_id":null }
{ "title":"Final Payment Pending","content":"Payment request from HOSAKOTE branch. Click to view","web_url":"/payments","transaction_id":"360b…","lead_id":null }
{ "title":"Customer Walkout","content":"Name has Walked Out. Click here to view the Reason" }
```

---

## 7. `Blocklist` — barred customers (3,211 rows)

### 7.1 Purpose
Customers barred from transacting — for compliance/fraud (`THEFT`) or operational reasons (`BLOCK`, e.g. refused KYC, ornament ownership doubtful, underage). Checked before/at walk-in so a blocked mobile doesn't proceed.

### 7.2 Columns

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | text (uuid) | NO | — | **PK**. |
| `customer_id` | text | NO | — | **FK → Customer.id. UNIQUE** (one blocklist row per customer). In practice stores the customer's mobile/identifier. |
| `remarks` | text | NO | — | Reason (free-text). |
| `employee_id` | text | YES | — | **FK → Employee.emp_id**. Who blocked. |
| `created_at` / `updated_at` | timestamp | NO | `CURRENT_TIMESTAMP` / — | Block time. Range 2021-03-07 → live (oldest data in the cluster — migrated from old CRM). |
| `blocklist_type` | `BlocklistType` | NO | — | `BLOCK` (3,180) / `THEFT` (31). |

### 7.3 Remarks vocabulary
Dominated by migration rows: `OLD CRM Blocked Customer` (2,737) and `OLD CRM Theft Block` (5). Live reasons: refused KYC docs, no proper KYC details, underage without parent reference, ornament ownership disputes.

### 7.4 Masked samples
```jsonc
{ "customer_id":"9xxxxxxxxx","remarks":"ornament does not belong to cust .","employee_id":"WG00544","blocklist_type":"BLOCK","created_at":"2026-08-06T00:29:37Z" }
{ "customer_id":"9xxxxxxxxx","remarks":"cust brought ladies ornament he is not ready to give referen…","employee_id":"WG00544","blocklist_type":"BLOCK" }
{ "customer_id":"9xxxxxxxxx","remarks":"OLD CRM Blocked Customer","blocklist_type":"BLOCK","created_at":"2021-…" }
```

---

## 8. `ActionControl` — per-transaction UI action gate (14,912 rows)

### 8.1 Purpose
A **feature-flag / permission row per Transaction** that gates which UI actions/buttons are enabled for that transaction as it moves through its lifecycle. Not strictly "lead funnel", but it is the bridge from a converted lead's `transaction_id` into the branch UI: when a lead walks in, its Transaction gets an ActionControl row (defaults `walkin=true`, `process_ocr=true`, everything else false), and flags flip on as stages complete.

### 8.2 Columns
`id` (PK, text), `transaction_id` (text, NOT NULL — implicit link to Transaction; no declared FK), plus **26 boolean action gates**, all `NOT NULL`:

`walkin` (dflt true) · `update_estimation` · `sales_approval` · `kyc` · `walkout` · `quotation` · `penny_drop` · `pledge_estimation` · `add_ornament` · `update_bank` · `request_release` · `proceed_to_pennydrop` · `request_revaluation` · `confirm_pickup` · `download_invoice` · `download_tax_invoice` · `downloads` · `proceed_to_agreement` · `sign_agreement` · `download_agreement` · `download_kyc_form` · `proceed_to_estimation` · `release_quotation` · `collect_payment` · `zero_difference` · `process_ocr` (dflt true) · `download_application_form`.

Each maps to a specific button/step in the transaction workflow (estimation, KYC, quotation, penny-drop, release, agreement, payment, invoice/downloads, OCR).

### 8.3 Enablement rates (snapshot)
`walkin` true in 40.3% · `kyc` 35.5% · `quotation` 0.7% · `collect_payment` 0.2% · `confirm_pickup` ~0%. → most rows are early-stage (walk-in + KYC gates on); very few progress to payment/pickup, consistent with the funnel drop-off.

### 8.4 Masked samples
```jsonc
{ "transaction_id":"e9f0e7ee-…","walkin":true,"kyc":true,"quotation":false,"collect_payment":false,"confirm_pickup":false,"process_ocr":true }
{ "transaction_id":"12644116-…","walkin":true,"kyc":false,"quotation":true,"collect_payment":false,"process_ocr":false }
```

---

## 9. How GoldApp (this repo) uses these tables

A repo-wide grep (`app/`, `lib/`, `components/`, `scripts/`) shows **deliberately light** direct use of the CRM cluster-2 tables — GoldApp is primarily a purchases/analytics layer over the CRM:

1. **`app/api/crm-purchases/route.js`** — the only place that reads a cluster-2 table directly. It queries `"Lead"` for a rough lead weight to attach to a purchase:
   ```sql
   leadw AS (SELECT DISTINCT ON (transaction_id) transaction_id tid, approx_gross_weight ag
             FROM "Lead" WHERE transaction_id IS NOT NULL
             ORDER BY transaction_id, created_at DESC)
   ```
   i.e. it uses `Lead.transaction_id` (the conversion link) + `approx_gross_weight` as a fallback rough weight when Order/Quotation weights aren't yet computed. It does **not** read Call/CallHistory/LeadHistory/Gnani/Notification/Blocklist/ActionControl.

2. **`app/api/sync-gnani/route.js` + `components/telesales/InboundBotTesting.js`** — the **Gnani voicebot** integration, but via **S3, not the CRM `Gnani` table**. The route pulls voicebot call recordings (`.tar.gz` of `.mp3`) and `metadata.json` from the `whitegold-call-recordings` S3 bucket, uploads MP3s, and writes to a **Supabase `telesales_calls`** table (fields: `gnani_call_id`, `customer_number`, `call_date`, `language`, `duration_seconds`, `call_disposition`, `system_disposition`, `summary`, `recording_url`, `outcome`). `InboundBotTesting.js` is the telesales UI to review these recordings/transcripts and tag an `outcome` (`pending`/`interested`/`callback`/`not_interested`/`no_answer`/`wrong_number`). So GoldApp maintains its **own** parallel copy of voicebot data in Supabase; the CRM `Gnani` table (which was only ever a 57-row pilot) is bypassed.

**Net:** GoldApp treats this cluster as an upstream source of truth it mostly *doesn't* touch, except (a) `Lead → transaction_id → approx_gross_weight` for purchase weight fallback, and (b) a Supabase-side re-implementation of the Gnani voicebot analytics fed from S3.

---

## 10. Cluster-level insights & gotchas

- **Two employee-ID conventions coexist.** `Lead.employee_id`, `Call.employee_id`, `Blocklist.employee_id` → **Employee.emp_id** (`WGxxxxx` code). `LeadHistory.employee_id`, `Notification.employee_id` → **Employee.id** (UUID). Don't join them interchangeably.
- **Conversion link is `Lead.transaction_id`** — 1:1 UNIQUE to `Transaction`. Only 2.8% of leads convert; a `VISITED` status does *not* guarantee a linked transaction (25,527 VISITED leads have none).
- **`Call` vs `CallHistory`:** `Call` = current state (FKs enforced); `CallHistory` = append-only log keyed by unique `call_id`, with a **denormalised `lead_*` snapshot** and the `is_fresh_call`/`is_followup_call` flags for productivity metrics. Neither has FKs to Call.
- **`action` (free-text raw dialer code) vs `status` (normalised enum bucket).** Analyse on `status`; `action` includes vendor strings like `Executive Busy`.
- **Marketing attribution lives in two shapes:** `survey`/`source` (channel name, heavily used) and the `utm_*` + `meta_*` columns (largely empty — Meta Lead-Ads ingestion is provisioned but not populated in this DB).
- **Gnani in the CRM is dormant** (57 pilot rows, all PENDING, 2026-02-18). The live voicebot pipeline runs through S3 → GoldApp Supabase.
- **Notifications are employee work-queue signals**, overwhelmingly unread (98.8%), and mirror the downstream Transaction stage names; the lead-side signal is `Followup Reminder`.
- **Data age:** Blocklist reaches back to 2021 (old-CRM migration); Lead/Call/History start 2025-12-29; Notification starts 2026-04-05.

---

*Generated read-only from `dbwhitegold_production`. Row counts current as of 2026-08-06 and will drift upward.*


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-3"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 3 — Transaction, Walk-in, KYC & Customer (the hub)
# ═══════════════════════════════════════════

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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-4"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 4 — Valuation & Pricing (the margin engine)
# ═══════════════════════════════════════════

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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-5"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 5 — Payment & Billing
# ═══════════════════════════════════════════

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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-6"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 6 — Post-purchase Gold (Release / Pledge / Melting)
# ═══════════════════════════════════════════

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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-7"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 7 — System & Misc
# ═══════════════════════════════════════════

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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-8"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 8 — Data Provenance & External Integrations
# ═══════════════════════════════════════════

# NEW CRM — Data Provenance & External Integrations

> **Purpose.** Where the NEW CRM's data *originates*: the ingestion pipelines and third-party integrations that write into `dbwhitegold_production`. This is a companion to [00-CRM-MASTER.md](#part-toc) and the cluster docs — it does **not** re-dump the schema; it traces each table back to the external system (or human process) that produces its rows, with queried evidence.
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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---

<a id="part-9"></a>



<div style="page-break-before:always"></div>

# ═══════════════════════════════════════════
# Part 9 — DB Objects: Reporting View, Functions & Sequences
# ═══════════════════════════════════════════

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


<p align="right"><a href="#part-toc">↑ back to contents</a></p>

---
