# White Gold — NEW CRM: complete technical reference

> **Purpose.** Exhaustive map of the NEW CRM Postgres database — every table, field, enum, relationship, lifecycle and calculation. The NEW CRM owns the customer journey **up to and including the purchase**; **GoldApp takes over post-purchase** (inventory movement, consignments, bidding/booking, margins, reports & analytics). The hand-off point is the **final payment / invoice** (a purchase belongs to its final-payment day == invoice date).
>
> Generated from a live read-only schema pull. **69 base tables · 1 reporting view · 901 columns · 128 foreign keys · 42 enum types · 6 ID-minting functions · 3 sequences · ~2.32 M rows.** Deep field-level detail per area lives in the cluster docs (see §Cluster docs); the view + functions are in [db-objects-views-functions.md](db-objects-views-functions.md).

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

1. [Reference & Org](cluster-1-reference-org.md)
2. [Lead & Calling funnel](cluster-2-lead-calling.md)
3. [Transaction / Walk-in / KYC / Customer](cluster-3-transaction-kyc.md)
4. [Valuation & Pricing (the margin engine)](cluster-4-valuation-pricing.md)
5. [Payment & Billing](cluster-5-payment-billing.md)
6. [Post-purchase Gold (release/pledge/melting)](cluster-6-postpurchase-gold.md)
7. [System & Misc](cluster-7-system-misc.md)

**Cross-cutting:**
- [Data provenance & external integrations](data-provenance-integrations.md) — where every table's data originates (lead webhooks, telephony/Gnani, spectrometer, RazorpayX, S3/OCR, GST, Qandle HRMS, GoldRate) + a live/dormant breakdown.
- [DB objects beyond the base tables](db-objects-views-functions.md) — the `latest_gold_transaction_report` **view** (the CRM's ready-made per-deal purchase report), the ID-minting **functions**, and sequences.
- [GoldApp ↔ CRM integration layer](goldapp-crm-integration.md) — **the seam**: every place GoldApp reads a CRM — the two purchase syncs, the `goldapp-cron` heartbeat, branch/employee sync, live gold rates, the direct-read dashboards, the `purchases` mirror schema, auth, and sync health.

---

# 3. Money-math & margins (the core)

> Full per-column derivations and paisa-verified worked examples are in [cluster-4 (Valuation)](cluster-4-valuation-pricing.md), [cluster-5 (Payment)](cluster-5-payment-billing.md) and [cluster-6 (Post-purchase Gold)](cluster-6-postpurchase-gold.md). This is the consolidated model.

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
