# New CRM — Case-wise Stage Timeline (2026-06-15 IST)

Reconstructed from stage-artifact timestamps (Transaction / Estimation / Quotation / Kyc+KycLog / Payment / Order / Release / Agreement). All times **IST**, snapshot at **17:08:03**. The native `Timer` table is not populated for current cases. "(reorder)" = the artifact was timestamped before the previous milestone (stages overlap in the CRM).

## A · Live WIP — in-flight cases created today (NOT yet completed)

**172 cases** still open (created today). Plus **2662 older cases** still open from previous days (carried-over backlog).

### Where they're stuck (by current status)

| Current status | Waiting on | open cases | median age | oldest |
|---|---|---|---|---|
| ESTIMATION_PENDING | Branch / Assayer (valuation) | 75 | 8.4h | 12.7h |
| SALES_NEGOTIATION_PENDING | Sales (negotiation) | 20 | 8.6h | 12.1h |
| BRANCH_KYC_PENDING | Branch (KYC capture) | 19 | 10.5h | 12.0h |
| WALKIN | Branch (intake) | 14 | 10.9h | 12.6h |
| KYC_PENDING | KYC Checker | 13 | 8.4h | 11.9h |
| PLEDGE_ESTIMATION_PENDING | Release / Valuation | 10 | 9.4h | 11.8h |
| QUOTATION_PENDING | Sales (quotation) | 7 | 10.0h | 11.8h |
| RELEASE_PENDING | Release / Ops | 6 | 11.7h | 12.5h |
| RELEASE_AGREEMENT_PENDING | Release (agreement) | 4 | 10.1h | 12.5h |
| PLEDGE_APPROVAL_PENDING | Sales Head (pledge) | 2 | 11.3h | 11.7h |
| REVALUATION_PENDING | Assayer (revaluation) | 1 | 12.6h | 12.6h |
| PENNY_DROP_PENDING | Accounts / Bank (penny-drop) | 1 | 6.0h | 6.0h |

### 20 oldest open cases right now

| Code | Customer | Branch | Type | Status (waiting on) | Open since | Age |
|---|---|---|---|---|---|---|
| WGKA-55434 | TEST ASBEER MK | Branch | PHYSICAL | ESTIMATION_PENDING — Branch / Assayer (valuation) | 04:27:02 | 12.7h |
| WGKA-55435 | — | MYSURU | RELEASED | WALKIN — Branch (intake) | 04:31:05 | 12.6h |
| WGKA-55436 | Manasa  D S | MYSURU | RELEASED | REVALUATION_PENDING — Assayer (revaluation) | 04:33:35 | 12.6h |
| WGKA-55437 | Lakshmi parcathi Samarajupalli | AP-ONGOLE | RELEASED | RELEASE_PENDING — Release / Ops | 04:37:54 | 12.5h |
| WGKA-55438 | Rajendra  Kambale | BELAGAVI | RELEASED | RELEASE_AGREEMENT_PENDING — Release (agreement) | 04:40:30 | 12.5h |
| WGKA-55439 | Kiran L | SARJAPURA | PHYSICAL | ESTIMATION_PENDING — Branch / Assayer (valuation) | 04:42:35 | 12.4h |
| WGKA-55440 | NITHEESH TEST BILL TEST | KL-KESHAVADASAPURAM | PHYSICAL | WALKIN — Branch (intake) | 04:43:58 | 12.4h |
| WGKA-55441 | — | KL-KESHAVADASAPURAM | PHYSICAL | WALKIN — Branch (intake) | 04:44:23 | 12.4h |
| WGKA-55443 | Preetham  Sadhu | BASAWESHWARANAGAR | PHYSICAL | WALKIN — Branch (intake) | 04:47:38 | 12.3h |
| WGKA-55446 | Linto GEORGE | KL-VENNALA-BY-PASS | RELEASED | RELEASE_AGREEMENT_PENDING — Release (agreement) | 04:54:24 | 12.2h |
| WGKA-55447 | Murali  Venkatraman | KAIKONDRAHALLI | PHYSICAL | ESTIMATION_PENDING — Branch / Assayer (valuation) | 05:01:21 | 12.1h |
| WGKA-55449 | Kumaraswamy  K | HASSAN | RELEASED | RELEASE_PENDING — Release / Ops | 05:03:02 | 12.1h |
| WGKA-55450 | Goviind Badiger | HOSAKOTE | PHYSICAL | SALES_NEGOTIATION_PENDING — Sales (negotiation) | 05:03:27 | 12.1h |
| WGKA-55451 | Deepu nai B | ULLAL | PHYSICAL | BRANCH_KYC_PENDING — Branch (KYC capture) | 05:05:26 | 12.0h |
| WGKA-55452 | Pradeep Kodavoor thoma | UDUPI | RELEASED | RELEASE_PENDING — Release / Ops | 05:05:36 | 12.0h |
| WGKA-55455 | TITUS ISSAC | KL-ADOOR | PHYSICAL | ESTIMATION_PENDING — Branch / Assayer (valuation) | 05:10:52 | 12.0h |
| WGKA-55456 | Shivakumar  A G | Flagship Store | RELEASED | KYC_PENDING — KYC Checker | 05:15:22 | 11.9h |
| WGKA-55459 | Basavaraj  S | HOSPETE | PHYSICAL | ESTIMATION_PENDING — Branch / Assayer (valuation) | 05:18:56 | 11.8h |
| WGKA-55460 | Umesh J | KENGERI | RELEASED | QUOTATION_PENDING — Sales (quotation) | 05:19:00 | 11.8h |
| WGKA-55461 | Nagaraja P | DAVANAGERE | PHYSICAL | ESTIMATION_PENDING — Branch / Assayer (valuation) | 05:19:06 | 11.8h |

---

## B · Completed cases — overall medians (decomposed)

**Cohort:** 132 completed & created today (note: 3 cases completed today but created on a prior day are not included here).

| Stage | n | median |
|---|---|---|
| 1 · Valuation (open → estimation) | 132 | 1.0m |
| 2 · Estimation + negotiation/SC approval | 132 | 10.8m |
| 3 · Quotation prep (estimation → quotation) | 131 | 12.0m |
| 4 · Quotation approval | 132 | 5.8m |
| 5 · KYC maker → checker | 132 | 1.2m |
| 6 · Payment | 132 | 9.7m |
| 7 · Order → completion | 132 | 4.0m |
| **TOTAL open → completed** | 132 | **53.6m** |

---

## Case-by-case detail

### 1. WGKA-55442 · Paritosh Khare · HOSA ROAD · PHYSICAL
Opened **04:45:59** → Completed **05:14:04** · total **28.1m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 04:45:59 | 04:46:46 | 0.8m | Hareesh  Naik (BRANCH) |
| 2 · Estimation + negotiation | 04:46:46 | 04:49:30 | 2.7m | Banuprathap P (SALES) |
| 3 · Quotation prep | 04:49:30 | 05:00:18 | 10.8m | Hareesh  Naik (BRANCH) |
| 4 · Quotation approval | 05:00:18 | 05:05:33 | 5.3m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 04:57:33 | 04:57:33 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 04:59:02 | 04:59:02 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:00:02 | 05:00:02 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:00:02 | 05:05:56 | 5.9m | Praveen J (BRANCH) |
| 7 · Order | 05:05:56 | 05:14:04 | 8.1m | — |
| 8 · Completion | 05:05:56 | 05:14:04 | 8.1m | system |

### 2. WGKA-55444 · ABHISH P RAJ · KL-PALA · PHYSICAL
Opened **04:51:25** → Completed **05:37:10** · total **45.8m** · opened by Shebin  Shaji (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 04:51:25 | 04:51:57 | 0.5m | Shebin  Shaji (BRANCH) |
| 2 · Estimation + negotiation | 04:51:57 | 05:12:01 | 20.1m | assayer / sales |
| 3 · Quotation prep | 05:12:01 | 05:26:20 | 14.3m | Shebin  Shaji (BRANCH) |
| 4 · Quotation approval | 05:26:20 | 05:29:55 | 3.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:18:48 | 05:18:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:24:36 | 05:24:36 | — | Jinu Prakash (OPERATIONS) · KYC_CHECKER |
| 6 · Payment | 05:24:36 | 05:30:15 | 5.6m | Shebin  Shaji (BRANCH) |
| 7 · Order | 05:30:15 | 05:37:10 | 6.9m | — |
| 8 · Completion | 05:30:15 | 05:37:10 | 6.9m | system |

### 3. WGKA-55445 · Sreeja T K · BANNERGHATTA · PHYSICAL
Opened **04:51:31** → Completed **05:53:25** · total **1.0h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 04:51:31 | 04:53:28 | 1.9m | Harshith V (BRANCH) |
| 2 · Estimation + negotiation | 04:53:28 | 05:00:58 | 7.5m | Manoj B (BRANCH) |
| 3 · Quotation prep | 05:00:58 | 05:33:07 | 32.2m | Harshith V (BRANCH) |
| 4 · Quotation approval | 05:33:07 | 05:49:33 | 16.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:25:05 | 05:25:05 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:26:44 | 05:26:44 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:26:44 | 05:51:02 | 24.3m | Harshith V (BRANCH) |
| 7 · Order | 05:51:02 | 05:53:26 | 2.4m | — |
| 8 · Completion | 05:51:02 | 05:53:25 | 2.4m | system |

### 4. WGKA-55448 · Krishna Murthy  M · JAYANAGAR · RELEASED
Opened **05:02:10** → Completed **08:07:08** · total **3.1h** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:02:10 | 07:27:17 | 2.4h | Preethi s (BRANCH) |
| 2 · Estimation + negotiation | 07:27:17 | 07:50:26 | 23.1m | Banuprathap P (SALES) |
| 3 · Quotation prep | 07:50:26 | 07:50:40 | 0.2m | Preethi s (BRANCH) |
| 4 · Quotation approval | 07:50:40 | 08:00:48 | 10.1m | Chethan A N (OPERATIONS) |
| R · Release sales approval | 05:02:46 | 06:25:40 | 1.4h | sales: APPROVED / head: — |
| R · Takeover agreement | 05:33:53 | 05:50:55 | 17.0m | signed |
| KYC · APPROVED | 05:25:49 | 05:25:49 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 05:26:59 | 05:26:59 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:26:59 | 06:25:40 | 58.7m | Sudarshan  B L (ACCOUNTS) |
| 7 · Order | 06:25:40 | 08:07:08 | 1.7h | — |
| 8 · Completion | 06:25:40 | 08:07:08 | 1.7h | system |

### 5. WGKA-55453 · Chaitra G · UTTARAHALLI · RELEASED
Opened **05:05:45** → Completed **09:06:47** · total **4.0h** · opened by Harinakshi T M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:05:45 | 07:52:52 | 2.8h | Harinakshi T M (BRANCH) |
| 2 · Estimation + negotiation | 07:52:52 | 08:13:02 | 20.2m | Vasantha N (SALES) |
| 3 · Quotation prep | 08:13:02 | 08:13:25 | 0.4m | Harinakshi T M (BRANCH) |
| 4 · Quotation approval | 08:13:25 | 09:02:25 | 49.0m | Sanathana K (OTHERS) |
| R · Release sales approval | 05:07:30 | 06:46:41 | 1.7h | sales: APPROVED / head: — |
| R · Takeover agreement | 05:59:46 | 06:10:47 | 11.0m | signed |
| KYC · REQUESTED | 05:30:04 | 05:30:04 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 05:42:34 | 05:42:34 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:53:41 | 05:53:41 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:57:39 | 05:57:39 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:57:39 | 06:46:41 | 49.0m | Sudarshan  B L (ACCOUNTS) |
| 7 · Order | 06:46:41 | 09:06:47 | 2.3h | — |
| 8 · Completion | 06:46:41 | 09:06:47 | 2.3h | system |

### 6. WGKA-55454 · Akshatha M p · SHIVAMOGGA · PHYSICAL
Opened **05:08:17** → Completed **05:41:58** · total **33.7m** · opened by Rakshath M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:08:17 | 05:08:50 | 0.5m | Rakshath M (BRANCH) |
| 2 · Estimation + negotiation | 05:08:50 | 05:13:06 | 4.3m | assayer / sales |
| 3 · Quotation prep | 05:13:06 | 05:32:36 | 19.5m | Rakshath M (BRANCH) |
| 4 · Quotation approval | 05:32:36 | 05:37:23 | 4.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:30:32 | 05:30:32 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:31:02 | 05:31:02 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:31:02 | 05:39:34 | 8.5m | Rakshath M (BRANCH) |
| 7 · Order | 05:39:34 | 05:41:58 | 2.4m | — |
| 8 · Completion | 05:39:34 | 05:41:58 | 2.4m | system |

### 7. WGKA-55457 · SHABEER K · KL-MALAPPURAM · PHYSICAL
Opened **05:16:52** → Completed **06:36:24** · total **1.3h** · opened by Pranav K P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:16:52 | 05:18:23 | 1.5m | Pranav K P (BRANCH) |
| 2 · Estimation + negotiation | 05:18:23 | 06:26:08 | 1.1h | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:26:08 | 06:27:46 | 1.6m | Pranav K P (BRANCH) |
| 4 · Quotation approval | 06:27:46 | 06:30:21 | 2.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:23:10 | 06:23:10 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:23:17 | 06:23:17 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:23:17 | 06:31:08 | 7.8m | Pranav K P (BRANCH) |
| 7 · Order | 06:31:08 | 06:36:24 | 5.3m | — |
| 8 · Completion | 06:31:08 | 06:36:24 | 5.3m | system |

### 8. WGKA-55458 · Linto GEORGE · KL-VENNALA-BY-PASS · RELEASED
Opened **05:18:47** → Completed **10:19:00** · total **5.0h** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:18:47 | 08:48:23 | 3.5h | Arun Kumar P K (BRANCH) |
| 2 · Estimation + negotiation | 08:48:23 | 08:51:07 | 2.7m | assayer / sales |
| 3 · Quotation prep | 08:51:07 | 08:51:54 | 0.8m | Arun Kumar P K (BRANCH) |
| 4 · Quotation approval | 08:51:54 | 10:09:22 | 1.3h | Vishnupriya U (BRANCH) |
| R · Release sales approval | 05:19:00 | 07:48:16 | 2.5h | sales: APPROVED / head: — |
| R · Takeover agreement | 05:43:05 | 07:05:34 | 1.4h | signed |
| KYC · APPROVED | 05:26:07 | 05:26:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:27:12 | 05:27:12 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:27:12 | 07:48:16 | 2.4h | Harish  K (ACCOUNTS) |
| 7 · Order | 07:48:16 | 10:19:00 | 2.5h | — |
| 8 · Completion | 07:48:16 | 10:19:00 | 2.5h | system |

### 9. WGKA-55462 · Pramod  C · KODIGEHALLI · PHYSICAL
Opened **05:19:24** → Completed **05:50:36** · total **31.2m** · opened by Sridhara L (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:19:24 | 05:19:58 | 0.6m | Sridhara L (BRANCH) |
| 2 · Estimation + negotiation | 05:19:58 | 05:23:55 | 3.9m | assayer / sales |
| 3 · Quotation prep | 05:23:55 | 05:39:44 | 15.8m | Sridhara L (BRANCH) |
| 4 · Quotation approval | 05:39:44 | 05:47:40 | 7.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:36:53 | 05:36:53 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:39:31 | 05:39:31 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:39:31 | 05:48:13 | 8.7m | Sridhara L (BRANCH) |
| 7 · Order | 05:48:13 | 05:50:36 | 2.4m | — |
| 8 · Completion | 05:48:13 | 05:50:36 | 2.4m | system |

### 10. WGKA-55463 · Siranjeev A · MYSURU · PHYSICAL
Opened **05:19:24** → Completed **07:01:09** · total **1.7h** · opened by Dhananjaya  P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:19:24 | 05:20:26 | 1.0m | Dhananjaya  P (BRANCH) |
| 2 · Estimation + negotiation | 05:20:26 | 05:37:49 | 17.4m | Manoj B (BRANCH) |
| 3 · Quotation prep | 05:37:49 | 06:43:40 | 1.1h | Dhananjaya  P (BRANCH) |
| 4 · Quotation approval | 06:43:40 | 06:49:32 | 5.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:56:48 | 05:56:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 06:05:53 | 06:05:53 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 06:08:16 | 06:08:16 | — | Gunjan Gupta (ADMIN) · KYC_MAKER |
| KYC · APPROVED | 06:37:49 | 06:37:49 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 06:38:38 | 06:38:38 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:43:24 | 06:43:24 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:43:24 | 06:53:10 | 9.8m | Dhananjaya  P (BRANCH) |
| 7 · Order | 06:53:10 | 07:01:09 | 8.0m | — |
| 8 · Completion | 06:53:10 | 07:01:09 | 8.0m | system |

### 11. WGKA-55465 · Raghu R · Flagship Store · PHYSICAL
Opened **05:22:08** → Completed **06:43:23** · total **1.4h** · opened by Niroop K N (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:22:08 | 05:22:52 | 0.7m | Niroop K N (BRANCH) |
| 2 · Estimation + negotiation | 05:22:52 | 06:10:22 | 47.5m | Banuprathap P (SALES) |
| 3 · Quotation prep | 06:10:22 | 06:12:16 | 1.9m | Niroop K N (BRANCH) |
| 4 · Quotation approval | 06:12:16 | 06:22:58 | 10.7m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:49:47 | 05:49:47 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 05:54:54 | 05:54:54 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:56:03 | 05:56:03 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:58:48 | 05:58:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:58:48 | 06:23:58 | 25.2m | accounts / branch |
| 8 · Completion | 06:23:58 | 06:43:23 | 19.4m | system |

### 12. WGKA-55466 · MAYAMADHU  SM · KL-THIRUVANANTHAPURAM MGROAD · PHYSICAL
Opened **05:25:03** → Completed **05:52:20** · total **27.3m** · opened by Sajith M V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:25:03 | 05:25:42 | 0.7m | Sajith M V (BRANCH) |
| 2 · Estimation + negotiation | 05:25:42 | 05:38:06 | 12.4m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 05:38:06 | 05:40:29 | 2.4m | Sajith M V (BRANCH) |
| 4 · Quotation approval | 05:40:29 | 05:43:15 | 2.8m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 05:32:30 | 05:32:30 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:33:19 | 05:33:19 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:33:19 | 05:43:56 | 10.6m | Sajith M V (BRANCH) |
| 7 · Order | 05:43:56 | 05:52:20 | 8.4m | — |
| 8 · Completion | 05:43:56 | 05:52:20 | 8.4m | system |

### 13. WGKA-55467 · Sayed  Habeebur · BANNERGHATTA · PHYSICAL
Opened **05:25:15** → Completed **07:06:26** · total **1.7h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:25:15 | 05:26:19 | 1.1m | Harshith V (BRANCH) |
| 2 · Estimation + negotiation | 05:26:19 | 06:00:06 | 33.8m | Manoj B (BRANCH) |
| 3 · Quotation prep | 06:00:06 | 06:43:15 | 43.1m | Harshith V (BRANCH) |
| 4 · Quotation approval | 06:43:15 | 06:59:32 | 16.3m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:29:42 | 06:29:42 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:40:17 | 06:40:17 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:01 | 06:42:01 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:42:01 | 06:59:55 | 17.9m | Harshith V (BRANCH) |
| 8 · Completion | 06:59:55 | 07:06:26 | 6.5m | system |

### 14. WGKA-55469 · Shakunthala N · DAVANAGERE · PHYSICAL
Opened **05:27:20** → Completed **06:47:31** · total **1.3h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:27:20 | 05:30:10 | 2.8m | Venkatesh Naik (BRANCH) |
| 2 · Estimation + negotiation | 05:30:10 | 05:51:30 | 21.3m | Banuprathap P (SALES) |
| 3 · Quotation prep | 05:51:30 | 06:17:34 | 26.1m | Venkatesh Naik (BRANCH) |
| 4 · Quotation approval | 06:17:34 | 06:29:18 | 11.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:14:52 | 06:14:52 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:17:03 | 06:17:03 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:17:03 | 06:32:14 | 15.2m | Venkatesh Naik (BRANCH) |
| 7 · Order | 06:32:14 | 06:47:31 | 15.3m | — |
| 8 · Completion | 06:32:14 | 06:47:31 | 15.3m | system |

### 15. WGKA-55471 · Sumangala Bhuti · HUBLI · PHYSICAL
Opened **05:27:55** → Completed **06:00:22** · total **32.4m** · opened by Shivanand Kabbalageri (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:27:55 | 05:29:18 | 1.4m | Shivanand Kabbalageri (BRANCH) |
| 2 · Estimation + negotiation | 05:29:18 | 05:38:25 | 9.1m | assayer / sales |
| 3 · Quotation prep | 05:38:25 | 05:48:44 | 10.3m | Shivanand Kabbalageri (BRANCH) |
| 4 · Quotation approval | 05:48:44 | 05:54:26 | 5.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:48:05 | 05:48:05 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 05:48:16 | 05:48:16 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:48:16 | 05:55:51 | 7.6m | Seema Savanur (BRANCH) |
| 7 · Order | 05:55:51 | 06:00:22 | 4.5m | — |
| 8 · Completion | 05:55:51 | 06:00:22 | 4.5m | system |

### 16. WGKA-55474 · Veerabhadrappa  Hb · BASAWESHWARANAGAR · RELEASED
Opened **05:29:24** → Completed **08:42:55** · total **3.2h** · opened by Yashas Gowda H R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:29:24 | 08:26:06 | 2.9h | Yashas Gowda H R (BRANCH) |
| 2 · Estimation + negotiation | 08:26:06 | 08:32:49 | 6.7m | Praveen N (SALES) |
| 3 · Quotation prep | 08:32:49 | 08:33:06 | 0.3m | Yashas Gowda H R (BRANCH) |
| 4 · Quotation approval | 08:33:06 | 08:37:02 | 3.9m | Sanathana K (OTHERS) |
| R · Release sales approval | 05:30:34 | 06:28:03 | 57.5m | sales: APPROVED / head: — |
| R · Takeover agreement | 05:55:45 | 06:05:32 | 9.8m | signed |
| KYC · APPROVED | 05:49:05 | 05:49:05 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:50:20 | 05:50:20 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:50:20 | 06:28:03 | 37.7m | Augustine T (ACCOUNTS) |
| 7 · Order | 06:28:03 | 08:42:55 | 2.2h | — |
| 8 · Completion | 06:28:03 | 08:42:55 | 2.2h | system |

### 17. WGKA-55475 · Srinivas Murthy · KATRIGUPPE · PHYSICAL
Opened **05:31:59** → Completed **06:26:17** · total **54.3m** · opened by Manoj K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:31:59 | 05:34:44 | 2.8m | Manoj K (BRANCH) |
| 2 · Estimation + negotiation | 05:34:44 | 06:11:13 | 36.5m | Pradeepa Noolageri (BRANCH) |
| 3 · Quotation prep | 06:11:13 | 06:13:50 | 2.6m | Manoj K (BRANCH) |
| 4 · Quotation approval | 06:13:50 | 06:20:02 | 6.2m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:59:26 | 05:59:26 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:11:52 | 06:11:52 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:12:13 | 06:12:13 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:12:13 | 06:21:06 | 8.9m | Manoj K (BRANCH) |
| 7 · Order | 06:21:06 | 06:26:04 | 5.0m | — |
| 8 · Completion | 06:21:06 | 06:26:17 | 5.2m | system |

### 18. WGKA-55476 · Damini  V · HOSA ROAD · PHYSICAL
Opened **05:32:42** → Completed **06:02:05** · total **29.4m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:32:42 | 05:33:39 | 1.0m | Hareesh  Naik (BRANCH) |
| 2 · Estimation + negotiation | 05:33:39 | 05:35:48 | 2.1m | assayer / sales |
| 3 · Quotation prep | 05:35:48 | 05:52:55 | 17.1m | Hareesh  Naik (BRANCH) |
| 4 · Quotation approval | 05:52:55 | 06:00:12 | 7.3m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:48:25 | 05:48:25 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:50:31 | 05:50:31 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:52:48 | 05:52:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:52:48 | 06:00:33 | 7.8m | Praveen J (BRANCH) |
| 7 · Order | 06:00:33 | 06:02:05 | 1.5m | — |
| 8 · Completion | 06:00:33 | 06:02:05 | 1.5m | system |

### 19. WGKA-55477 · TITUS ISSAC · KL-ADOOR · PHYSICAL
Opened **05:34:42** → Completed **06:01:12** · total **26.5m** · opened by Jayan  C (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:34:42 | 05:35:12 | 0.5m | Jayan  C (BRANCH) |
| 2 · Estimation + negotiation | 05:35:12 | 05:45:49 | 10.6m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 05:45:49 | 05:50:01 | 4.2m | Jayan  C (BRANCH) |
| 4 · Quotation approval | 05:50:01 | 05:52:54 | 2.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:44:09 | 05:44:09 | — | Jinu Prakash (OPERATIONS) · KYC_MAKER |
| KYC · APPROVED | 05:44:21 | 05:44:21 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:44:31 | 05:44:31 | — | Jinu Prakash (OPERATIONS) · KYC_CHECKER |
| KYC · APPROVED | 05:44:49 | 05:44:49 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:44:49 | 05:59:40 | 14.8m | Jayan  C (BRANCH) |
| 7 · Order | 05:59:40 | 06:01:12 | 1.5m | — |
| 8 · Completion | 05:59:40 | 06:01:12 | 1.5m | system |

### 20. WGKA-55479 · Pradeep K · CHITRADURGA · PHYSICAL
Opened **05:37:36** → Completed **07:36:25** · total **2.0h** · opened by Honnuramma E (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:37:36 | 05:38:47 | 1.2m | Honnuramma E (BRANCH) |
| 2 · Estimation + negotiation | 05:38:47 | 07:15:56 | 1.6h | Vasantha N (SALES) |
| 3 · Quotation prep | 07:15:56 | 07:16:01 | 0.1m | Honnuramma E (BRANCH) |
| 4 · Quotation approval | 07:16:01 | 07:24:39 | 8.6m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:55:47 | 06:55:47 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:58:43 | 06:58:43 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:11:29 | 07:11:29 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:11:29 | 07:28:50 | 17.4m | Honnuramma E (BRANCH) |
| 7 · Order | 07:28:50 | 07:36:25 | 7.6m | — |
| 8 · Completion | 07:28:50 | 07:36:25 | 7.6m | system |

### 21. WGKA-55480 · DIVYA KG KG · KL-MUVATTUPUZHA · PHYSICAL
Opened **05:39:22** → Completed **06:08:48** · total **29.4m** · opened by Ajnas K A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:39:22 | 05:40:18 | 0.9m | Ajnas K A (BRANCH) |
| 2 · Estimation + negotiation | 05:40:18 | 05:58:30 | 18.2m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 05:58:30 | 05:59:16 | 0.8m | Ajnas K A (BRANCH) |
| 4 · Quotation approval | 05:59:16 | 06:02:04 | 2.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:53:24 | 05:53:24 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:54:49 | 05:54:49 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 05:54:49 | 06:02:54 | 8.1m | Ajnas K A (BRANCH) |
| 7 · Order | 06:02:54 | 06:08:48 | 5.9m | — |
| 8 · Completion | 06:02:54 | 06:08:48 | 5.9m | system |

### 22. WGKA-55483 · Jayalaxmi Acharya · UDUPI · PHYSICAL
Opened **05:40:53** → Completed **06:50:49** · total **1.2h** · opened by Shailesh M Palan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:40:53 | 05:41:59 | 1.1m | Shailesh M Palan (BRANCH) |
| 2 · Estimation + negotiation | 05:41:59 | 06:03:58 | 22.0m | Praveen N (SALES) |
| 3 · Quotation prep | 06:03:58 | 06:37:35 | 33.6m | Shailesh M Palan (BRANCH) |
| 4 · Quotation approval | 06:37:35 | 06:45:34 | 8.0m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:36:50 | 06:36:50 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:37:13 | 06:37:13 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:37:13 | 06:47:28 | 10.2m | Shailesh M Palan (BRANCH) |
| 7 · Order | 06:47:28 | 06:50:49 | 3.4m | — |
| 8 · Completion | 06:47:28 | 06:50:49 | 3.4m | system |

### 23. WGKA-55484 · Harish T Y · KENGERI · PHYSICAL
Opened **05:41:45** → Completed **06:29:23** · total **47.6m** · opened by Punith R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:41:45 | 05:42:09 | 0.4m | Punith R (BRANCH) |
| 2 · Estimation + negotiation | 05:42:09 | 05:44:44 | 2.6m | assayer / sales |
| 3 · Quotation prep | 05:44:44 | 06:20:17 | 35.5m | Punith R (BRANCH) |
| 4 · Quotation approval | 06:20:17 | 06:25:25 | 5.1m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:19:08 | 06:19:08 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:19:14 | 06:19:14 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:19:14 | 06:26:55 | 7.7m | Punith R (BRANCH) |
| 7 · Order | 06:26:55 | 06:29:23 | 2.5m | — |
| 8 · Completion | 06:26:55 | 06:29:23 | 2.5m | system |

### 24. WGKA-55485 · SHRUTHI KARANTH · VAJRAHALLI · PHYSICAL
Opened **05:42:12** → Completed **06:13:31** · total **31.3m** · opened by Priya Prakash (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:42:12 | 05:42:30 | 0.3m | Priya Prakash (BRANCH) |
| 2 · Estimation + negotiation | 05:42:30 | 05:58:53 | 16.4m | Praveen N (SALES) |
| 3 · Quotation prep | 05:58:53 | 06:07:18 | 8.4m | Priya Prakash (BRANCH) |
| 4 · Quotation approval | 06:07:18 | 06:10:26 | 3.1m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:05:08 | 06:05:08 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:06:33 | 06:06:33 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:06:33 | 06:11:10 | 4.6m | Priya Prakash (BRANCH) |
| 7 · Order | 06:11:10 | 06:13:31 | 2.4m | — |
| 8 · Completion | 06:11:10 | 06:13:31 | 2.4m | system |

### 25. WGKA-55486 · SAVITHRI SREEKUMAR S · KL-NEYATINKARA · PHYSICAL
Opened **05:42:49** → Completed **06:12:03** · total **29.2m** · opened by Sam P Roy (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:42:49 | 05:44:09 | 1.3m | Sam P Roy (BRANCH) |
| 2 · Estimation + negotiation | 05:44:09 | 05:55:14 | 11.1m | assayer / sales |
| 3 · Quotation prep | 05:55:14 | 06:03:28 | 8.2m | Sam P Roy (BRANCH) |
| 4 · Quotation approval | 06:03:28 | 06:05:36 | 2.1m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:01:12 | 06:01:12 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:01:42 | 06:01:42 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:01:42 | 06:07:31 | 5.8m | Sam P Roy (BRANCH) |
| 7 · Order | 06:07:31 | 06:12:03 | 4.5m | — |
| 8 · Completion | 06:07:31 | 06:12:03 | 4.5m | system |

### 26. WGKA-55487 · VINEETH KUMAR KK · KL-OTTAPALAM · PHYSICAL
Opened **05:43:15** → Completed **06:38:40** · total **55.4m** · opened by Roopesh  K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:43:15 | 05:44:26 | 1.2m | Roopesh  K (BRANCH) |
| 2 · Estimation + negotiation | 05:44:26 | 06:11:44 | 27.3m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:11:44 | 06:12:39 | 0.9m | Roopesh  K (BRANCH) |
| 4 · Quotation approval | 06:12:39 | 06:15:23 | 2.7m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:05:41 | 06:05:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:06:08 | 06:06:08 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:06:08 | 06:16:19 | 10.2m | Roopesh  K (BRANCH) |
| 7 · Order | 06:16:19 | 06:38:40 | 22.4m | — |
| 8 · Completion | 06:16:19 | 06:38:40 | 22.4m | system |

### 27. WGKA-55492 · Sivakumar  K · AP-NAD · PHYSICAL
Opened **05:48:25** → Completed **07:05:10** · total **1.3h** · opened by Polamarasetti  Govardan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:48:25 | 05:49:08 | 0.7m | Polamarasetti  Govardan (BRANCH) |
| 2 · Estimation + negotiation | 05:49:08 | 06:15:34 | 26.4m | Anand R (SALES) |
| 3 · Quotation prep | 06:15:34 | 06:48:26 | 32.9m | Polamarasetti  Govardan (BRANCH) |
| 4 · Quotation approval | 06:48:26 | 07:01:47 | 13.4m | Nagendra Prasad D (OPERATIONS) |
| KYC · REQUESTED | 06:39:29 | 06:39:29 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:44:38 | 06:44:38 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · REQUESTED | 06:45:54 | 06:45:54 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:48:17 | 06:48:17 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:48:17 | 07:02:11 | 13.9m | accounts / branch |
| 7 · Order | 07:02:11 | 07:05:11 | 3.0m | — |
| 8 · Completion | 07:02:11 | 07:05:10 | 3.0m | system |

### 28. WGKA-55493 · ANIL  KUMAR · KL-EDAPPALLY · PHYSICAL
Opened **05:49:33** → Completed **06:21:49** · total **32.3m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:49:33 | 05:50:14 | 0.7m | Anand M Menon (BRANCH) |
| 2 · Estimation + negotiation | 05:50:14 | 06:07:36 | 17.4m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:07:36 | 06:12:10 | 4.6m | Anand M Menon (BRANCH) |
| 4 · Quotation approval | 06:12:10 | 06:17:15 | 5.1m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:10:57 | 06:10:57 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:12:05 | 06:12:05 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:12:05 | 06:15:19 | 3.2m | Anand M Menon (BRANCH) |
| 7 · Order | 06:15:19 | 06:21:49 | 6.5m | — |
| 8 · Completion | 06:15:19 | 06:21:49 | 6.5m | system |

### 29. WGKA-55494 · Chandrashekhar  M S · JAYANAGAR · PHYSICAL
Opened **05:49:41** → Completed **07:44:55** · total **1.9h** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:49:41 | 05:50:26 | 0.8m | Preethi s (BRANCH) |
| 2 · Estimation + negotiation | 05:50:26 | 05:52:45 | 2.3m | Banuprathap P (SALES) |
| 3 · Quotation prep | 05:52:45 | 07:34:22 | 1.7h | Preethi s (BRANCH) |
| 4 · Quotation approval | 07:34:22 | 07:40:01 | 5.7m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:22:01 | 06:22:01 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:33:10 | 07:33:10 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:33:24 | 07:33:24 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:33:24 | 07:43:21 | 9.9m | Preethi s (BRANCH) |
| 7 · Order | 07:43:21 | 07:44:55 | 1.6m | — |
| 8 · Completion | 07:43:21 | 07:44:55 | 1.6m | system |

### 30. WGKA-55497 · Uddapdebnath B · ADUGODI · PHYSICAL
Opened **05:52:41** → Completed **06:24:30** · total **31.8m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:52:41 | 05:54:12 | 1.5m | Tejus A (BRANCH) |
| 2 · Estimation + negotiation | 05:54:12 | 05:56:59 | 2.8m | assayer / sales |
| 3 · Quotation prep | 05:56:59 | 06:17:05 | 20.1m | Tejus A (BRANCH) |
| 4 · Quotation approval | 06:17:05 | 06:21:42 | 4.6m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:10:25 | 06:10:25 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:12:41 | 06:12:41 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:16:56 | 06:16:56 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:16:56 | 06:22:26 | 5.5m | Tejus A (BRANCH) |
| 7 · Order | 06:22:26 | 06:24:30 | 2.1m | — |
| 8 · Completion | 06:22:26 | 06:24:30 | 2.1m | system |

### 31. WGKA-55498 · mahesh M · KL-KADAPPAKKADA · PHYSICAL
Opened **05:52:50** → Completed **06:20:40** · total **27.8m** · opened by Renjith  V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:52:50 | 05:57:29 | 4.7m | Renjith  V (BRANCH) |
| 2 · Estimation + negotiation | 05:57:29 | 06:06:25 | 8.9m | assayer / sales |
| 3 · Quotation prep | 06:06:25 | 06:12:08 | 5.7m | Renjith  V (BRANCH) |
| 4 · Quotation approval | 06:12:08 | 06:14:36 | 2.5m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:11:30 | 06:11:30 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:12:00 | 06:12:00 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:12:00 | 06:14:56 | 2.9m | Renjith  V (BRANCH) |
| 7 · Order | 06:14:56 | 06:20:40 | 5.7m | — |
| 8 · Completion | 06:14:56 | 06:20:40 | 5.7m | system |

### 32. WGKA-55500 · Karthik  M · K R PURAM · PHYSICAL
Opened **05:54:10** → Completed **07:13:12** · total **1.3h** · opened by Sridhara MS (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:54:10 | 05:55:06 | 0.9m | Sridhara MS (BRANCH) |
| 2 · Estimation + negotiation | 05:55:06 | 06:00:21 | 5.3m | assayer / sales |
| 3 · Quotation prep | 06:00:21 | 06:19:50 | 19.5m | Sridhara MS (BRANCH) |
| 4 · Quotation approval | 06:19:50 | 06:48:16 | 28.4m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:17:08 | 06:17:08 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:19:22 | 06:19:22 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:19:22 | 07:09:47 | 50.4m | Sridhara MS (BRANCH) |
| 7 · Order | 07:09:47 | 07:13:12 | 3.4m | — |
| 8 · Completion | 07:09:47 | 07:13:12 | 3.4m | system |

### 33. WGKA-55501 · SREEDEVI PR · KL-THRIPPUNITHURA · PHYSICAL
Opened **05:54:58** → Completed **06:26:43** · total **31.7m** · opened by Roni Raymond (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:54:58 | 05:55:33 | 0.6m | Roni Raymond (BRANCH) |
| 2 · Estimation + negotiation | 05:55:33 | 06:14:36 | 19.0m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:14:36 | 06:20:10 | 5.6m | Roni Raymond (BRANCH) |
| 4 · Quotation approval | 06:20:10 | 06:23:46 | 3.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:19:40 | 06:19:40 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:19:59 | 06:19:59 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:19:59 | 06:24:41 | 4.7m | Roni Raymond (BRANCH) |
| 7 · Order | 06:24:41 | 06:26:43 | 2.0m | — |
| 8 · Completion | 06:24:41 | 06:26:43 | 2.0m | system |

### 34. WGKA-55504 · Prema H · SHIVAMOGGA · PHYSICAL
Opened **05:56:56** → Completed **06:45:41** · total **48.8m** · opened by Pooja K G (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:56:56 | 05:57:41 | 0.8m | Pooja K G (BRANCH) |
| 2 · Estimation + negotiation | 05:57:41 | 06:18:54 | 21.2m | assayer / sales |
| 3 · Quotation prep | 06:18:54 | 06:31:53 | 13.0m | Pooja K G (BRANCH) |
| 4 · Quotation approval | 06:31:53 | 06:39:46 | 7.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:30:18 | 06:30:18 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:30:33 | 06:30:33 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:30:33 | 06:40:23 | 9.8m | Pooja K G (BRANCH) |
| 7 · Order | 06:40:23 | 06:45:41 | 5.3m | — |
| 8 · Completion | 06:40:23 | 06:45:41 | 5.3m | system |

### 35. WGKA-55505 · Vijay M · BANNERGHATTA · RELEASED
Opened **05:57:46** → Completed **10:07:38** · total **4.2h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 05:57:46 | 08:28:43 | 2.5h | Harshith V (BRANCH) |
| 2 · Estimation + negotiation | 08:28:43 | 08:38:13 | 9.5m | assayer / sales |
| 3 · Quotation prep | 08:38:13 | 08:38:16 | 0.0m | Harshith V (BRANCH) |
| 4 · Quotation approval | 08:38:16 | 10:03:00 | 1.4h | Vinay M (OPERATIONS) |
| R · Release sales approval | 05:58:48 | 06:57:22 | 58.6m | sales: APPROVED / head: — |
| R · Takeover agreement | 06:20:38 | 06:29:33 | 8.9m | signed |
| KYC · APPROVED | 06:19:19 | 06:19:19 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:19:33 | 06:19:33 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:19:44 | 06:19:44 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:19:44 | 06:57:22 | 37.6m | Kajji Sathish (ACCOUNTS) |
| 7 · Order | 06:57:22 | 10:07:38 | 3.2h | — |
| 8 · Completion | 06:57:22 | 10:07:38 | 3.2h | system |

### 36. WGKA-55507 · SWAPNA  NANDAKUMAR · KL-KANHANGAD · PHYSICAL
Opened **06:01:17** → Completed **06:24:03** · total **22.8m** · opened by Sheik Muhammed Afthab (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:01:17 | 06:02:22 | 1.1m | Sheik Muhammed Afthab (BRANCH) |
| 2 · Estimation + negotiation | 06:02:22 | 06:06:24 | 4.0m | assayer / sales |
| 3 · Quotation prep | 06:06:24 | 06:16:23 | 10.0m | Sheik Muhammed Afthab (BRANCH) |
| 4 · Quotation approval | 06:16:23 | 06:19:43 | 3.3m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:15:55 | 06:15:55 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:16:13 | 06:16:13 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:16:13 | 06:21:17 | 5.1m | Sheik Muhammed Afthab (BRANCH) |
| 7 · Order | 06:21:17 | 06:24:03 | 2.8m | — |
| 8 · Completion | 06:21:17 | 06:24:03 | 2.8m | system |

### 37. WGKA-55508 · Rachana  Shetty · MANGALURU · PHYSICAL
Opened **06:02:06** → Completed **08:10:15** · total **2.1h** · opened by Sowmya Devadiga (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:02:06 | 06:04:33 | 2.5m | Sowmya Devadiga (BRANCH) |
| 2 · Estimation + negotiation | 06:04:33 | 06:55:35 | 51.0m | Praveen N (SALES) |
| 3 · Quotation prep | 06:55:35 | 07:36:18 | 40.7m | Sowmya Devadiga (BRANCH) |
| 4 · Quotation approval | 07:36:18 | 08:00:24 | 24.1m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:35:41 | 07:35:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:35:59 | 07:35:59 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:35:59 | 08:01:01 | 25.0m | Sowmya Devadiga (BRANCH) |
| 8 · Completion | 08:01:01 | 08:10:15 | 9.2m | system |

### 38. WGKA-55510 · Saritha S · LINGARAJPURAM · PHYSICAL
Opened **06:07:41** → Completed **06:58:34** · total **50.9m** · opened by Umar Farooq (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:07:41 | 06:08:57 | 1.3m | Umar Farooq (BRANCH) |
| 2 · Estimation + negotiation | 06:08:57 | 06:33:58 | 25.0m | assayer / sales |
| 3 · Quotation prep | 06:33:58 | 06:39:00 | 5.0m | Umar Farooq (BRANCH) |
| 4 · Quotation approval | 06:39:00 | 06:47:52 | 8.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:29:56 | 06:29:56 | — | Inchara R (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:35:52 | 06:35:52 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:36:16 | 06:36:16 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:36:16 | 06:52:34 | 16.3m | Umar Farooq (BRANCH) |
| 7 · Order | 06:52:34 | 06:58:34 | 6.0m | — |
| 8 · Completion | 06:52:34 | 06:58:34 | 6.0m | system |

### 39. WGKA-55511 · SURESH  PK · KL-KOTTAKKAL · RELEASED
Opened **06:07:44** → Completed **10:25:56** · total **4.3h** · opened by Mohsin  Edakkandan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:07:44 | 08:51:11 | 2.7h | Mohsin  Edakkandan (BRANCH) |
| 2 · Estimation + negotiation | 08:51:11 | 09:14:20 | 23.2m | assayer / sales |
| 3 · Quotation prep | 09:14:20 | 09:15:19 | 1.0m | Mohsin  Edakkandan (BRANCH) |
| 4 · Quotation approval | 09:15:19 | 09:29:43 | 14.4m | Sanathana K (OTHERS) |
| R · Release sales approval | 06:10:41 | 07:12:19 | 1.0h | sales: APPROVED / head: — |
| R · Takeover agreement | 06:24:13 | 06:42:17 | 18.1m | signed |
| KYC · APPROVED | 06:23:38 | 06:23:38 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:23:43 | 06:23:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:23:43 | 07:12:19 | 48.6m | Neslin A (ACCOUNTS) |
| 7 · Order | 07:12:19 | 10:25:57 | 3.2h | — |
| 8 · Completion | 07:12:19 | 10:25:56 | 3.2h | system |

### 40. WGKA-55515 · Bhama  D c · TC PALYA · PHYSICAL
Opened **06:14:47** → Completed **07:39:46** · total **1.4h** · opened by Srinivas Kempanna (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:14:47 | 06:16:13 | 1.4m | Srinivas Kempanna (BRANCH) |
| 2 · Estimation + negotiation | 06:16:13 | 07:30:31 | 1.2h | assayer / sales |
| 3 · Quotation prep | 07:30:31 | 07:30:35 | 0.1m | Srinivas Kempanna (BRANCH) |
| 4 · Quotation approval | 07:30:35 | 07:35:34 | 5.0m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:50:30 | 06:50:30 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 07:17:01 | 07:17:01 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:25:08 | 07:25:08 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:25:31 | 07:25:31 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:25:31 | 07:36:45 | 11.2m | Srinivas Kempanna (BRANCH) |
| 7 · Order | 07:36:45 | 07:39:46 | 3.0m | — |
| 8 · Completion | 07:36:45 | 07:39:46 | 3.0m | system |

### 41. WGKA-55517 · sebastian  ac · KL-THOPPUMPADY · PHYSICAL
Opened **06:16:31** → Completed **06:51:23** · total **34.9m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:16:31 | 06:17:45 | 1.2m | Glen Joseph (BRANCH) |
| 2 · Estimation + negotiation | 06:17:45 | 06:39:51 | 22.1m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:39:51 | 06:41:40 | 1.8m | Glen Joseph (BRANCH) |
| 4 · Quotation approval | 06:41:40 | 06:45:25 | 3.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:41:14 | 06:41:14 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:41:26 | 06:41:26 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:41:26 | 06:46:09 | 4.7m | Glen Joseph (BRANCH) |
| 7 · Order | 06:46:09 | 06:51:23 | 5.2m | — |
| 8 · Completion | 06:46:09 | 06:51:23 | 5.2m | system |

### 42. WGKA-55520 · Jayanthi  M · BANNERGHATTA · PHYSICAL
Opened **06:19:09** → Completed **07:41:50** · total **1.4h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:19:09 | 06:19:48 | 0.6m | Harshith V (BRANCH) |
| 2 · Estimation + negotiation | 06:19:48 | 07:05:39 | 45.9m | Vasantha N (SALES) |
| 3 · Quotation prep | 07:05:39 | 07:29:33 | 23.9m | Harshith V (BRANCH) |
| 4 · Quotation approval | 07:29:33 | 07:37:17 | 7.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:28:50 | 07:28:50 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:29:15 | 07:29:15 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:29:15 | 07:37:47 | 8.5m | Harshith V (BRANCH) |
| 7 · Order | 07:37:47 | 07:41:50 | 4.0m | — |
| 8 · Completion | 07:37:47 | 07:41:50 | 4.0m | system |

### 43. WGKA-55521 · Sheela  Krishna · JAYANAGAR · PHYSICAL
Opened **06:20:36** → Completed **07:23:05** · total **1.0h** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:20:36 | 06:21:21 | 0.7m | Preethi s (BRANCH) |
| 2 · Estimation + negotiation | 06:21:21 | 06:27:50 | 6.5m | assayer / sales |
| 3 · Quotation prep | 06:27:50 | 06:43:03 | 15.2m | Preethi s (BRANCH) |
| 4 · Quotation approval | 06:43:03 | 07:10:19 | 27.3m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:40:50 | 06:40:50 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:12 | 06:42:12 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:24 | 06:42:24 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:42:24 | 07:10:56 | 28.5m | Preethi s (BRANCH) |
| 8 · Completion | 07:10:56 | 07:23:05 | 12.1m | system |

### 44. WGKA-55523 · Rajeev R · HASSAN · PHYSICAL
Opened **06:22:59** → Completed **07:21:33** · total **58.6m** · opened by Pavan Kumar H C (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:22:59 | 06:23:31 | 0.5m | Pavan Kumar H C (BRANCH) |
| 2 · Estimation + negotiation | 06:23:31 | 06:56:39 | 33.1m | Banuprathap P (SALES) |
| 3 · Quotation prep | 06:56:39 | 06:59:17 | 2.6m | Pavan Kumar H C (BRANCH) |
| 4 · Quotation approval | 06:59:17 | 07:08:01 | 8.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:58:13 | 06:58:13 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:58:46 | 06:58:46 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:58:46 | 07:20:11 | 21.4m | Santhosha  Kumar B S (BRANCH) |
| 7 · Order | 07:20:11 | 07:21:33 | 1.4m | — |
| 8 · Completion | 07:20:11 | 07:21:33 | 1.4m | system |

### 45. WGKA-55524 · FRANCIS N L · KL-CHAVAKKAD · PHYSICAL
Opened **06:23:33** → Completed **07:05:20** · total **41.8m** · opened by Shaji Varghese (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:23:33 | 06:24:48 | 1.2m | Shaji Varghese (BRANCH) |
| 2 · Estimation + negotiation | 06:24:48 | 06:38:35 | 13.8m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:38:35 | 06:42:27 | 3.9m | Shaji Varghese (BRANCH) |
| 4 · Quotation approval | 06:42:27 | 06:46:06 | 3.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:42:00 | 06:42:00 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:19 | 06:42:19 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:42:19 | 06:47:11 | 4.9m | Shaji Varghese (BRANCH) |
| 7 · Order | 06:47:11 | 07:05:20 | 18.2m | — |
| 8 · Completion | 06:47:11 | 07:05:20 | 18.2m | system |

### 46. WGKA-55527 · Aishwarya  K · HOSA ROAD · PHYSICAL
Opened **06:25:56** → Completed **06:54:27** · total **28.5m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:25:56 | 06:26:11 | 0.2m | Hareesh  Naik (BRANCH) |
| 2 · Estimation + negotiation | 06:26:11 | 06:29:02 | 2.8m | assayer / sales |
| 3 · Quotation prep | 06:29:02 | 06:46:59 | 17.9m | Hareesh  Naik (BRANCH) |
| 4 · Quotation approval | 06:46:59 | 06:51:47 | 4.8m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:41:32 | 06:41:32 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:44:54 | 06:44:54 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:45:06 | 06:45:06 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:45:06 | 06:51:00 | 5.9m | Praveen J (BRANCH) |
| 7 · Order | 06:51:00 | 06:54:27 | 3.5m | — |
| 8 · Completion | 06:51:00 | 06:54:27 | 3.5m | system |

### 47. WGKA-55528 · Anna JOHN · KL-EDAPPALLY · PHYSICAL
Opened **06:26:20** → Completed **06:48:00** · total **21.7m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:26:20 | 06:26:52 | 0.5m | Anand M Menon (BRANCH) |
| 2 · Estimation + negotiation | 06:26:52 | 06:37:33 | 10.7m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:37:33 | 06:41:29 | 3.9m | Anand M Menon (BRANCH) |
| 4 · Quotation approval | 06:41:29 | 06:42:56 | 1.4m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:39:42 | 06:39:42 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:41:20 | 06:41:20 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:41:25 | 06:41:25 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:41:25 | 06:43:11 | 1.8m | Anand M Menon (BRANCH) |
| 7 · Order | 06:43:11 | 06:48:00 | 4.8m | — |
| 8 · Completion | 06:43:11 | 06:48:00 | 4.8m | system |

### 48. WGKA-55529 · Arjun NA · SHIVAMOGGA · PHYSICAL
Opened **06:27:12** → Completed **08:01:55** · total **1.6h** · opened by Varun S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:27:12 | 06:28:16 | 1.1m | Varun S (BRANCH) |
| 2 · Estimation + negotiation | 06:28:16 | 06:45:16 | 17.0m | assayer / sales |
| 3 · Quotation prep | 06:45:16 | 07:46:18 | 1.0h | Varun S (BRANCH) |
| 4 · Quotation approval | 07:46:18 | 07:58:17 | 12.0m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:45:02 | 07:45:02 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:45:43 | 07:45:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:45:43 | 08:00:00 | 14.3m | Pooja K G (BRANCH) |
| 7 · Order | 08:00:00 | 08:01:55 | 1.9m | — |
| 8 · Completion | 08:00:00 | 08:01:55 | 1.9m | system |

### 49. WGKA-55532 · Rohini  K · KENGERI · PHYSICAL
Opened **06:29:11** → Completed **07:05:31** · total **36.3m** · opened by Punith R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:29:11 | 06:29:37 | 0.4m | Punith R (BRANCH) |
| 2 · Estimation + negotiation | 06:29:37 | 06:33:40 | 4.0m | assayer / sales |
| 3 · Quotation prep | 06:33:40 | 06:55:36 | 21.9m | Punith R (BRANCH) |
| 4 · Quotation approval | 06:55:36 | 07:01:33 | 5.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:51:10 | 06:51:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:54:17 | 06:54:17 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:55:05 | 06:55:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:55:05 | 07:01:51 | 6.8m | Punith R (BRANCH) |
| 7 · Order | 07:01:51 | 07:05:31 | 3.7m | — |
| 8 · Completion | 07:01:51 | 07:05:31 | 3.7m | system |

### 50. WGKA-55533 · UNMESH RAJENDRAN · KL-KADAPPAKKADA · PHYSICAL
Opened **06:30:02** → Completed **06:52:41** · total **22.6m** · opened by Renjith  V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:30:02 | 06:31:16 | 1.2m | Renjith  V (BRANCH) |
| 2 · Estimation + negotiation | 06:31:16 | 06:40:07 | 8.8m | assayer / sales |
| 3 · Quotation prep | 06:40:07 | 06:47:54 | 7.8m | Renjith  V (BRANCH) |
| 4 · Quotation approval | 06:47:54 | 06:50:56 | 3.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:46:42 | 06:46:42 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:46:48 | 06:46:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:46:49 | 06:46:49 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:47:44 | 06:47:44 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:47:44 | 06:51:04 | 3.3m | Renjith  V (BRANCH) |
| 7 · Order | 06:51:04 | 06:52:41 | 1.6m | — |
| 8 · Completion | 06:51:04 | 06:52:41 | 1.6m | system |

### 51. WGKA-55537 · Usha sanjeevi P · MATHIKERE · PHYSICAL
Opened **06:33:05** → Completed **07:18:49** · total **45.7m** · opened by Harish M A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:33:05 | 06:35:07 | 2.0m | Harish M A (BRANCH) |
| 2 · Estimation + negotiation | 06:35:07 | 06:45:55 | 10.8m | Banuprathap P (SALES) |
| 3 · Quotation prep | 06:45:55 | 07:08:44 | 22.8m | Harish M A (BRANCH) |
| 4 · Quotation approval | 07:08:44 | 07:15:35 | 6.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:07:58 | 07:07:58 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:08:08 | 07:08:08 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:08:08 | 07:16:09 | 8.0m | Harish M A (BRANCH) |
| 7 · Order | 07:16:09 | 07:18:49 | 2.7m | — |
| 8 · Completion | 07:16:09 | 07:18:49 | 2.7m | system |

### 52. WGKA-55540 · dileep kumar · KL-ADOOR · PHYSICAL
Opened **06:34:34** → Completed **07:10:10** · total **35.6m** · opened by Jayan  C (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:34:34 | 06:35:20 | 0.8m | Jayan  C (BRANCH) |
| 2 · Estimation + negotiation | 06:35:20 | 06:55:37 | 20.3m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 06:55:37 | 07:03:38 | 8.0m | Jayan  C (BRANCH) |
| 4 · Quotation approval | 07:03:38 | 07:05:15 | 1.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:02:59 | 07:02:59 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:03:17 | 07:03:17 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:03:17 | 07:06:07 | 2.8m | Jayan  C (BRANCH) |
| 7 · Order | 07:06:07 | 07:10:10 | 4.1m | — |
| 8 · Completion | 07:06:07 | 07:10:10 | 4.1m | system |

### 53. WGKA-55543 · Sachin Kumar  Kumar · ADUGODI · PHYSICAL
Opened **06:38:00** → Completed **07:09:32** · total **31.5m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:38:00 | 06:38:46 | 0.8m | Tejus A (BRANCH) |
| 2 · Estimation + negotiation | 06:38:46 | 06:42:26 | 3.7m | assayer / sales |
| 3 · Quotation prep | 06:42:26 | 06:58:51 | 16.4m | Tejus A (BRANCH) |
| 4 · Quotation approval | 06:58:51 | 07:06:11 | 7.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:57:43 | 06:57:43 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:58:43 | 06:58:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:58:43 | 07:06:21 | 7.6m | Tejus A (BRANCH) |
| 7 · Order | 07:06:21 | 07:09:32 | 3.2m | — |
| 8 · Completion | 07:06:21 | 07:09:32 | 3.2m | system |

### 54. WGKA-55547 · Mohith S · K R PURAM · PHYSICAL
Opened **06:38:45** → Completed **07:47:34** · total **1.1h** · opened by Sridhara MS (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:38:45 | 06:39:25 | 0.7m | Sridhara MS (BRANCH) |
| 2 · Estimation + negotiation | 06:39:25 | 07:05:52 | 26.4m | Manoj B (BRANCH) |
| 3 · Quotation prep | 07:05:52 | 07:38:40 | 32.8m | Sridhara MS (BRANCH) |
| 4 · Quotation approval | 07:38:40 | 07:44:03 | 5.4m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 07:30:07 | 07:30:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:32:48 | 07:32:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:33:26 | 07:33:26 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:33:26 | 07:44:46 | 11.3m | Sridhara MS (BRANCH) |
| 7 · Order | 07:44:46 | 07:47:34 | 2.8m | — |
| 8 · Completion | 07:44:46 | 07:47:34 | 2.8m | system |

### 55. WGKA-55548 · Kalyan  Sri · TS-KUKATPALLY · PHYSICAL
Opened **06:40:51** → Completed **07:19:41** · total **38.8m** · opened by Gaddala Paul  Dinakar (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:40:51 | 06:42:05 | 1.2m | Gaddala Paul  Dinakar (BRANCH) |
| 2 · Estimation + negotiation | 06:42:05 | 06:47:05 | 5.0m | assayer / sales |
| 3 · Quotation prep | 06:47:05 | 07:09:51 | 22.8m | Gaddala Paul  Dinakar (BRANCH) |
| 4 · Quotation approval | 07:09:51 | 07:15:43 | 5.9m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 07:00:18 | 07:00:18 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 07:03:58 | 07:03:58 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:08:41 | 07:08:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:09:27 | 07:09:27 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:09:27 | 07:16:35 | 7.1m | Gaddala Paul  Dinakar (BRANCH) |
| 7 · Order | 07:16:35 | 07:19:29 | 2.9m | — |
| 8 · Completion | 07:16:35 | 07:19:41 | 3.1m | system |

### 56. WGKA-55549 · Satya brata Behuria · HOSA ROAD · PHYSICAL
Opened **06:41:48** → Completed **07:06:29** · total **24.7m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:41:48 | 06:42:52 | 1.1m | Hareesh  Naik (BRANCH) |
| 2 · Estimation + negotiation | 06:42:52 | 06:44:04 | 1.2m | assayer / sales |
| 3 · Quotation prep | 06:44:04 | 06:58:26 | 14.4m | Hareesh  Naik (BRANCH) |
| 4 · Quotation approval | 06:58:26 | 07:02:20 | 3.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:56:17 | 06:56:17 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:56:44 | 06:56:44 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:56:44 | 07:02:44 | 6.0m | Praveen J (BRANCH) |
| 7 · Order | 07:02:44 | 07:06:29 | 3.8m | — |
| 8 · Completion | 07:02:44 | 07:06:29 | 3.8m | system |

### 57. WGKA-55551 · SIDHARTH SETHU · KL-CALICUT · PHYSICAL
Opened **06:45:32** → Completed **07:00:21** · total **14.8m** · opened by Urmila P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:45:32 | 06:46:01 | 0.5m | Urmila P (BRANCH) |
| 2 · Estimation + negotiation | 06:46:01 | 06:50:05 | 4.1m | assayer / sales |
| 3 · Quotation prep | 06:50:05 | 06:55:07 | 5.0m | Urmila P (BRANCH) |
| 4 · Quotation approval | 06:55:07 | 06:57:56 | 2.8m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:54:38 | 06:54:38 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:54:54 | 06:54:54 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:54:54 | 06:58:40 | 3.8m | Urmila P (BRANCH) |
| 7 · Order | 06:58:40 | 07:00:21 | 1.7m | — |
| 8 · Completion | 06:58:40 | 07:00:21 | 1.7m | system |

### 58. WGKA-55553 · Gangadhar  G · YELAHANKA · PHYSICAL
Opened **06:47:33** → Completed **07:43:24** · total **55.9m** · opened by Bhavanising  Ramachandra Rajaput (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:47:33 | 06:47:53 | 0.3m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| 2 · Estimation + negotiation | 06:47:53 | 07:20:08 | 32.2m | Praveen N (SALES) |
| 3 · Quotation prep | 07:20:08 | 07:25:32 | 5.4m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| 4 · Quotation approval | 07:25:32 | 07:39:33 | 14.0m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:01:04 | 07:01:04 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:02:23 | 07:02:23 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:02:23 | 07:41:19 | 38.9m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| 7 · Order | 07:41:19 | 07:43:24 | 2.1m | — |
| 8 · Completion | 07:41:19 | 07:43:24 | 2.1m | system |

### 59. WGKA-55554 · Linto GEORGE · KL-VENNALA-BY-PASS · PHYSICAL
Opened **06:49:04** → Completed **07:04:24** · total **15.3m** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:49:04 | 06:49:14 | 0.2m | Arun Kumar P K (BRANCH) |
| 2 · Estimation + negotiation | 06:49:14 | 07:00:05 | 10.9m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 07:00:05 | 07:00:19 | 0.2m | Arun Kumar P K (BRANCH) |
| 4 · Quotation approval | 07:00:19 | 07:02:09 | 1.8m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:52:47 | 06:52:47 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:54:43 | 06:54:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 06:54:43 | 07:02:38 | 7.9m | Arun Kumar P K (BRANCH) |
| 7 · Order | 07:02:38 | 07:04:24 | 1.8m | — |
| 8 · Completion | 07:02:38 | 07:04:24 | 1.8m | system |

### 60. WGKA-55557 · Rituparna Chakraborty · WHITE FIELD · PHYSICAL
Opened **06:50:58** → Completed **07:25:53** · total **34.9m** · opened by Devaraju M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:50:58 | 06:52:53 | 1.9m | Devaraju M (BRANCH) |
| 2 · Estimation + negotiation | 06:52:53 | 06:56:12 | 3.3m | assayer / sales |
| 3 · Quotation prep | 06:56:12 | 07:10:22 | 14.2m | Devaraju M (BRANCH) |
| 4 · Quotation approval | 07:10:22 | 07:21:37 | 11.2m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:06:40 | 07:06:40 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:08:48 | 07:08:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:08:48 | 07:22:16 | 13.5m | Devaraju M (BRANCH) |
| 7 · Order | 07:22:16 | 07:25:53 | 3.6m | — |
| 8 · Completion | 07:22:16 | 07:25:53 | 3.6m | system |

### 61. WGKA-55558 · Madhusudhan H · JALAHALLI · PHYSICAL
Opened **06:55:12** → Completed **08:10:20** · total **1.3h** · opened by Madhusudhan P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:55:12 | 06:56:25 | 1.2m | Madhusudhan P (BRANCH) |
| 2 · Estimation + negotiation | 06:56:25 | 07:53:18 | 56.9m | Praveen N (SALES) |
| 3 · Quotation prep | 07:53:18 | 07:52:57 | (reorder) | Madhusudhan P (BRANCH) |
| 4 · Quotation approval | 07:52:57 | 08:01:20 | 8.4m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 07:16:50 | 07:16:50 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 07:20:10 | 07:20:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:30:35 | 07:30:35 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:30:49 | 07:30:49 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:30:49 | 08:03:20 | 32.5m | Madhusudhan P (BRANCH) |
| 7 · Order | 08:03:20 | 08:10:20 | 7.0m | — |
| 8 · Completion | 08:03:20 | 08:10:20 | 7.0m | system |

### 62. WGKA-55559 · Nagaveni r rao Rao · HUBLI · RELEASED
Opened **06:55:30** → Completed **09:48:33** · total **2.9h** · opened by Seema Savanur (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:55:30 | 08:58:54 | 2.1h | Seema Savanur (BRANCH) |
| 2 · Estimation + negotiation | 08:58:54 | 09:07:54 | 9.0m | Manoj B (BRANCH) |
| 3 · Quotation prep | 09:07:54 | 09:11:08 | 3.2m | Seema Savanur (BRANCH) |
| 4 · Quotation approval | 09:11:08 | 09:25:09 | 14.0m | Vinay M (OPERATIONS) |
| R · Release sales approval | 06:57:17 | 08:12:47 | 1.3h | sales: APPROVED / head: — |
| R · Takeover agreement | 07:24:45 | 07:36:10 | 11.4m | signed |
| KYC · APPROVED | 07:24:13 | 07:24:13 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:24:26 | 07:24:26 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:24:26 | 08:12:47 | 48.3m | Augustine T (ACCOUNTS) |
| 7 · Order | 08:12:47 | 09:48:33 | 1.6h | — |
| 8 · Completion | 08:12:47 | 09:48:33 | 1.6h | system |

### 63. WGKA-55560 · Irfan jes Abishek a · TC PALYA · PHYSICAL
Opened **06:56:08** → Completed **08:19:26** · total **1.4h** · opened by Srinivas Kempanna (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:56:08 | 06:57:09 | 1.0m | Srinivas Kempanna (BRANCH) |
| 2 · Estimation + negotiation | 06:57:09 | 07:04:58 | 7.8m | assayer / sales |
| 3 · Quotation prep | 07:04:58 | 08:08:59 | 1.1h | Srinivas Kempanna (BRANCH) |
| 4 · Quotation approval | 08:08:59 | 08:14:36 | 5.6m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 07:26:39 | 07:26:39 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:04:12 | 08:04:12 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:08:35 | 08:08:35 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:08:35 | 08:13:42 | 5.1m | Srinivas Kempanna (BRANCH) |
| 7 · Order | 08:13:42 | 08:19:26 | 5.7m | — |
| 8 · Completion | 08:13:42 | 08:19:26 | 5.7m | system |

### 64. WGKA-55561 · binu DELENA · KL-THOPPUMPADY · PHYSICAL
Opened **06:56:34** → Completed **07:52:37** · total **56.1m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:56:34 | 06:57:07 | 0.5m | Glen Joseph (BRANCH) |
| 2 · Estimation + negotiation | 06:57:07 | 07:11:00 | 13.9m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 07:11:00 | 07:40:09 | 29.2m | Glen Joseph (BRANCH) |
| 4 · Quotation approval | 07:40:09 | 07:45:26 | 5.3m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:38:41 | 07:38:41 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:39:46 | 07:39:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:39:46 | 07:45:39 | 5.9m | Glen Joseph (BRANCH) |
| 7 · Order | 07:45:39 | 07:52:37 | 7.0m | — |
| 8 · Completion | 07:45:39 | 07:52:37 | 7.0m | system |

### 65. WGKA-55563 · Mahanthesh N · CHITRADURGA · PHYSICAL
Opened **06:57:25** → Completed **08:32:15** · total **1.6h** · opened by Honnuramma E (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:57:25 | 06:58:32 | 1.1m | Honnuramma E (BRANCH) |
| 2 · Estimation + negotiation | 06:58:32 | 07:42:49 | 44.3m | assayer / sales |
| 3 · Quotation prep | 07:42:49 | 08:19:42 | 36.9m | Honnuramma E (BRANCH) |
| 4 · Quotation approval | 08:19:42 | 08:23:29 | 3.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:09:47 | 08:09:47 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:15:39 | 08:15:39 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:18:52 | 08:18:52 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:18:52 | 08:24:01 | 5.2m | Honnuramma E (BRANCH) |
| 7 · Order | 08:24:01 | 08:32:15 | 8.2m | — |
| 8 · Completion | 08:24:01 | 08:32:15 | 8.2m | system |

### 66. WGKA-55565 · Manjunath g  P · BOMMANAHALLI · PHYSICAL
Opened **06:58:09** → Completed **08:03:47** · total **1.1h** · opened by Mallikarjun Dalavi (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:58:09 | 06:59:17 | 1.1m | Mallikarjun Dalavi (BRANCH) |
| 2 · Estimation + negotiation | 06:59:17 | 07:10:29 | 11.2m | assayer / sales |
| 3 · Quotation prep | 07:10:29 | 07:23:48 | 13.3m | Mallikarjun Dalavi (BRANCH) |
| 4 · Quotation approval | 07:23:48 | 07:46:58 | 23.2m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:22:44 | 07:22:44 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:23:00 | 07:23:00 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:23:00 | 07:59:46 | 36.8m | Mallikarjun Dalavi (BRANCH) |
| 7 · Order | 07:59:46 | 08:03:47 | 4.0m | — |
| 8 · Completion | 07:59:46 | 08:03:47 | 4.0m | system |

### 67. WGKA-55566 · Krishna  Murthy · KAIKONDRAHALLI · PHYSICAL
Opened **06:59:31** → Completed **07:49:06** · total **49.6m** · opened by Saibanna . (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 06:59:31 | 07:00:30 | 1.0m | Saibanna . (BRANCH) |
| 2 · Estimation + negotiation | 07:00:30 | 07:16:27 | 15.9m | assayer / sales |
| 3 · Quotation prep | 07:16:27 | 07:31:28 | 15.0m | Saibanna . (BRANCH) |
| 4 · Quotation approval | 07:31:28 | 07:40:14 | 8.8m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:29:41 | 07:29:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:31:21 | 07:31:21 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:31:21 | 07:41:04 | 9.7m | M Anthony Frank  Chinnappa (BRANCH) |
| 7 · Order | 07:41:04 | 07:49:06 | 8.0m | — |
| 8 · Completion | 07:41:04 | 07:49:06 | 8.0m | system |

### 68. WGKA-55569 · shamjith AK · KL-THIRUVANANTHAPURAM MGROAD · RELEASED
Opened **07:02:23** → Completed **10:49:04** · total **3.8h** · opened by Sajith M V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:02:23 | 09:30:56 | 2.5h | Sajith M V (BRANCH) |
| 2 · Estimation + negotiation | 09:30:56 | 09:35:14 | 4.3m | assayer / sales |
| 3 · Quotation prep | 09:35:14 | 09:36:08 | 0.9m | Sajith M V (BRANCH) |
| 4 · Quotation approval | 09:36:08 | 10:23:28 | 47.3m | Sanathana K (OTHERS) |
| R · Release sales approval | 07:03:29 | 08:32:49 | 1.5h | sales: APPROVED / head: — |
| R · Takeover agreement | 07:45:34 | 07:59:59 | 14.4m | signed |
| KYC · APPROVED | 07:24:45 | 07:24:45 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:24:57 | 07:24:57 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:24:57 | 08:32:49 | 1.1h | Sudarshan  B L (ACCOUNTS) |
| 7 · Order | 08:32:49 | 10:49:04 | 2.3h | — |
| 8 · Completion | 08:32:49 | 10:49:04 | 2.3h | system |

### 69. WGKA-55570 · Rahul K · TS-PANJAGUTTA · PHYSICAL
Opened **07:03:26** → Completed **08:47:32** · total **1.7h** · opened by Ramidi Srikanth  Reddy (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:03:26 | 07:04:18 | 0.9m | Ramidi Srikanth  Reddy (BRANCH) |
| 2 · Estimation + negotiation | 07:04:18 | 07:27:38 | 23.3m | Anand R (SALES) |
| 3 · Quotation prep | 07:27:38 | 08:21:25 | 53.8m | Ramidi Srikanth  Reddy (BRANCH) |
| 4 · Quotation approval | 08:21:25 | 08:30:36 | 9.2m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:16:00 | 08:16:00 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:20:49 | 08:20:49 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:21:05 | 08:21:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:21:05 | 08:40:46 | 19.7m | accounts / branch |
| 8 · Completion | 08:40:46 | 08:47:32 | 6.8m | system |

### 70. WGKA-55573 · Linda EDNA ABY GEORGE · KL-KESHAVADASAPURAM · PHYSICAL
Opened **07:05:11** → Completed **07:40:33** · total **35.4m** · opened by Jinu Chandran  B S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:05:11 | 07:06:50 | 1.6m | Jinu Chandran  B S (BRANCH) |
| 2 · Estimation + negotiation | 07:06:50 | 07:34:35 | 27.7m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 07:34:35 | 07:36:24 | 1.8m | Jinu Chandran  B S (BRANCH) |
| 4 · Quotation approval | 07:36:24 | 07:37:19 | 0.9m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 07:15:18 | 07:15:18 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:19:21 | 07:19:21 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:19:21 | 07:38:16 | 18.9m | Jinu Chandran  B S (BRANCH) |
| 7 · Order | 07:38:16 | 07:40:33 | 2.3m | — |
| 8 · Completion | 07:38:16 | 07:40:33 | 2.3m | system |

### 71. WGKA-55574 · Ropali Nayak · BOMMANAHALLI · PHYSICAL
Opened **07:05:57** → Completed **08:33:30** · total **1.5h** · opened by Mallikarjun Dalavi (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:05:57 | 07:06:22 | 0.4m | Mallikarjun Dalavi (BRANCH) |
| 2 · Estimation + negotiation | 07:06:22 | 07:14:37 | 8.3m | Praveen N (SALES) |
| 3 · Quotation prep | 07:14:37 | 08:12:04 | 57.4m | Mallikarjun Dalavi (BRANCH) |
| 4 · Quotation approval | 08:12:04 | 08:29:33 | 17.5m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:11:33 | 08:11:33 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:11:57 | 08:11:57 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:11:57 | 08:31:36 | 19.6m | Mallikarjun Dalavi (BRANCH) |
| 7 · Order | 08:31:36 | 08:33:30 | 1.9m | — |
| 8 · Completion | 08:31:36 | 08:33:30 | 1.9m | system |

### 72. WGKA-55575 · Ganesh T A · DAVANAGERE · RELEASED
Opened **07:06:16** → Completed **11:23:21** · total **4.3h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:06:16 | 11:02:46 | 3.9h | Venkatesh Naik (BRANCH) |
| 2 · Estimation + negotiation | 11:02:46 | 11:12:40 | 9.9m | Manoj B (BRANCH) |
| 3 · Quotation prep | 11:12:40 | 11:14:18 | 1.6m | Venkatesh Naik (BRANCH) |
| 4 · Quotation approval | 11:14:18 | 11:19:08 | 4.8m | Sanathana K (OTHERS) |
| R · Release sales approval | 07:07:34 | 08:55:44 | 1.8h | sales: APPROVED / head: — |
| R · Takeover agreement | 08:03:07 | 08:09:48 | 6.7m | signed |
| KYC · REQUESTED | 07:26:41 | 07:26:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:57:44 | 07:57:44 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:58:48 | 07:58:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:58:48 | 08:55:44 | 56.9m | Harish  K (ACCOUNTS) |
| 7 · Order | 08:55:44 | 11:23:21 | 2.5h | — |
| 8 · Completion | 08:55:44 | 11:23:21 | 2.5h | system |

### 73. WGKA-55578 · SYAMALA N · KL-CHAVAKKAD · RELEASED
Opened **07:09:17** → Completed **10:45:00** · total **3.6h** · opened by Shaji Varghese (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:09:17 | 08:41:57 | 1.5h | Shaji Varghese (BRANCH) |
| 2 · Estimation + negotiation | 08:41:57 | 09:05:34 | 23.6m | assayer / sales |
| 3 · Quotation prep | 09:05:34 | 09:07:07 | 1.6m | Shaji Varghese (BRANCH) |
| 4 · Quotation approval | 09:07:07 | 09:13:57 | 6.8m | Sanathana K (OTHERS) |
| R · Release sales approval | 07:11:51 | 08:12:29 | 1.0h | sales: APPROVED / head: — |
| R · Takeover agreement | 07:36:14 | 07:49:12 | 13.0m | signed |
| KYC · APPROVED | 07:33:59 | 07:33:59 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:35:50 | 07:35:50 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:35:50 | 08:12:29 | 36.7m | Abin Antony (BRANCH) |
| 7 · Order | 08:12:29 | 10:45:00 | 2.5h | — |
| 8 · Completion | 08:12:29 | 10:45:00 | 2.5h | system |

### 74. WGKA-55580 · Yogesh C · UDUPI · PHYSICAL
Opened **07:12:23** → Completed **08:05:46** · total **53.4m** · opened by Shailesh M Palan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:12:23 | 07:13:27 | 1.1m | Shailesh M Palan (BRANCH) |
| 2 · Estimation + negotiation | 07:13:27 | 07:23:07 | 9.7m | assayer / sales |
| 3 · Quotation prep | 07:23:07 | 07:56:24 | 33.3m | Shailesh M Palan (BRANCH) |
| 4 · Quotation approval | 07:56:24 | 08:02:01 | 5.6m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 07:48:43 | 07:48:43 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:55:05 | 07:55:05 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:56:13 | 07:56:13 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:56:13 | 08:03:28 | 7.3m | Shailesh M Palan (BRANCH) |
| 7 · Order | 08:03:28 | 08:05:35 | 2.1m | — |
| 8 · Completion | 08:03:28 | 08:05:46 | 2.3m | system |

### 75. WGKA-55585 · Nagaraja N · LINGARAJPURAM · PHYSICAL
Opened **07:15:31** → Completed **08:41:32** · total **1.4h** · opened by Umar Farooq (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:15:31 | 07:16:18 | 0.8m | Umar Farooq (BRANCH) |
| 2 · Estimation + negotiation | 07:16:18 | 07:28:15 | 11.9m | Praveen N (SALES) |
| 3 · Quotation prep | 07:28:15 | 08:12:44 | 44.5m | Umar Farooq (BRANCH) |
| 4 · Quotation approval | 08:12:44 | 08:18:50 | 6.1m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:01:37 | 08:01:37 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:12:29 | 08:12:29 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:12:36 | 08:12:36 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:12:36 | 08:19:50 | 7.2m | Umar Farooq (BRANCH) |
| 7 · Order | 08:19:50 | 08:41:32 | 21.7m | — |
| 8 · Completion | 08:19:50 | 08:41:32 | 21.7m | system |

### 76. WGKA-55586 · Raghuneer N · SUNKADAKATTE · PHYSICAL
Opened **07:19:05** → Completed **08:36:41** · total **1.3h** · opened by Yathish N (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:19:05 | 07:19:22 | 0.3m | Yathish N (BRANCH) |
| 2 · Estimation + negotiation | 07:19:22 | 07:35:46 | 16.4m | Manoj B (BRANCH) |
| 3 · Quotation prep | 07:35:46 | 08:09:54 | 34.1m | Yathish N (BRANCH) |
| 4 · Quotation approval | 08:09:54 | 08:33:08 | 23.2m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:09:00 | 08:09:00 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:09:41 | 08:09:41 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:09:41 | 08:34:56 | 25.3m | Yathish N (BRANCH) |
| 7 · Order | 08:34:56 | 08:36:41 | 1.7m | — |
| 8 · Completion | 08:34:56 | 08:36:41 | 1.7m | system |

### 77. WGKA-55587 · VIVEK VINCENT · KL-KALPETTA · PHYSICAL
Opened **07:19:18** → Completed **07:48:15** · total **28.9m** · opened by ANEESH  A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:19:18 | 07:19:57 | 0.6m | ANEESH  A (BRANCH) |
| 2 · Estimation + negotiation | 07:19:57 | 07:29:57 | 10.0m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 07:29:57 | 07:39:41 | 9.7m | ANEESH  A (BRANCH) |
| 4 · Quotation approval | 07:39:41 | 07:41:41 | 2.0m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:32:42 | 07:32:42 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:33:04 | 07:33:04 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:33:04 | 07:42:45 | 9.7m | ANEESH  A (BRANCH) |
| 7 · Order | 07:42:45 | 07:48:15 | 5.5m | — |
| 8 · Completion | 07:42:45 | 07:48:15 | 5.5m | system |

### 78. WGKA-55588 · Srinivas K · MALLESHWARAM · PHYSICAL
Opened **07:19:51** → Completed **08:26:21** · total **1.1h** · opened by Madhan Kumar G G (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:19:51 | 07:20:40 | 0.8m | Madhan Kumar G G (BRANCH) |
| 2 · Estimation + negotiation | 07:20:40 | 07:23:16 | 2.6m | assayer / sales |
| 3 · Quotation prep | 07:23:16 | 08:08:59 | 45.7m | Madhan Kumar G G (BRANCH) |
| 4 · Quotation approval | 08:08:59 | 08:19:58 | 11.0m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 07:41:33 | 07:41:33 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:06:34 | 08:06:34 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:08:27 | 08:08:27 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:08:27 | 08:21:52 | 13.4m | Madhan Kumar G G (BRANCH) |
| 7 · Order | 08:21:52 | 08:26:21 | 4.5m | — |
| 8 · Completion | 08:21:52 | 08:26:21 | 4.5m | system |

### 79. WGKA-55590 · Prabhakara S · ADUGODI · PHYSICAL
Opened **07:21:40** → Completed **08:04:13** · total **42.6m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:21:40 | 07:22:13 | 0.6m | Tejus A (BRANCH) |
| 2 · Estimation + negotiation | 07:22:13 | 07:29:50 | 7.6m | Pradeepa Noolageri (BRANCH) |
| 3 · Quotation prep | 07:29:50 | 07:56:13 | 26.4m | Tejus A (BRANCH) |
| 4 · Quotation approval | 07:56:13 | 07:59:07 | 2.9m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:55:39 | 07:55:39 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:56:05 | 07:56:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:56:05 | 07:59:35 | 3.5m | Tejus A (BRANCH) |
| 8 · Completion | 07:59:35 | 08:04:13 | 4.6m | system |

### 80. WGKA-55591 · Asif A · THANISANDRA · PHYSICAL
Opened **07:22:12** → Completed **09:06:52** · total **1.7h** · opened by Sushmitha H T (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:22:12 | 07:22:48 | 0.6m | Sushmitha H T (BRANCH) |
| 2 · Estimation + negotiation | 07:22:48 | 08:01:37 | 38.8m | Banuprathap P (SALES) |
| 3 · Quotation prep | 08:01:37 | 08:39:02 | 37.4m | Sushmitha H T (BRANCH) |
| 4 · Quotation approval | 08:39:02 | 09:03:31 | 24.5m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 08:33:23 | 08:33:23 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:35:55 | 08:35:55 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:38:08 | 08:38:08 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:38:08 | 09:03:52 | 25.7m | Sushmitha H T (BRANCH) |
| 7 · Order | 09:03:52 | 09:06:52 | 3.0m | — |
| 8 · Completion | 09:03:52 | 09:06:52 | 3.0m | system |

### 81. WGKA-55592 · Ganesh SV · KENGERI · PHYSICAL
Opened **07:22:14** → Completed **08:09:23** · total **47.2m** · opened by Punith R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:22:14 | 07:22:40 | 0.4m | Punith R (BRANCH) |
| 2 · Estimation + negotiation | 07:22:40 | 07:29:45 | 7.1m | assayer / sales |
| 3 · Quotation prep | 07:29:45 | 07:56:05 | 26.3m | Punith R (BRANCH) |
| 4 · Quotation approval | 07:56:05 | 08:04:26 | 8.4m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:50:11 | 07:50:11 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:55:55 | 07:55:55 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:55:55 | 08:05:12 | 9.3m | Punith R (BRANCH) |
| 7 · Order | 08:05:12 | 08:09:23 | 4.2m | — |
| 8 · Completion | 08:05:12 | 08:09:23 | 4.2m | system |

### 82. WGKA-55593 · Lakshmana K · YELAHANKA · PHYSICAL
Opened **07:22:33** → Completed **10:26:30** · total **3.1h** · opened by Bhavanising  Ramachandra Rajaput (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:22:33 | 07:24:59 | 2.4m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| 2 · Estimation + negotiation | 07:24:59 | 08:43:04 | 1.3h | Anand R (SALES) |
| 3 · Quotation prep | 08:43:04 | 09:08:47 | 25.7m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| 4 · Quotation approval | 09:08:47 | 09:49:06 | 40.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:07:05 | 09:07:05 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:07:09 | 09:07:09 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:07:09 | 10:19:09 | 1.2h | accounts / branch |
| 8 · Completion | 10:19:09 | 10:26:30 | 7.4m | system |

### 83. WGKA-55596 · Mounesh B · HOSPETE · PHYSICAL
Opened **07:27:54** → Completed **08:30:08** · total **1.0h** · opened by Sangeetha J (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:27:54 | 07:29:22 | 1.5m | Sangeetha J (BRANCH) |
| 2 · Estimation + negotiation | 07:29:22 | 07:32:32 | 3.2m | assayer / sales |
| 3 · Quotation prep | 07:32:32 | 08:15:15 | 42.7m | Sangeetha J (BRANCH) |
| 4 · Quotation approval | 08:15:15 | 08:18:07 | 2.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:04:32 | 08:04:32 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 08:08:32 | 08:08:32 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:12:37 | 08:12:37 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:14:51 | 08:14:51 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:14:51 | 08:22:51 | 8.0m | Sangeetha J (BRANCH) |
| 7 · Order | 08:22:51 | 08:30:08 | 7.3m | — |
| 8 · Completion | 08:22:51 | 08:30:08 | 7.3m | system |

### 84. WGKA-55597 · Jayanth S · KATRIGUPPE · RELEASED
Opened **07:29:50** → Completed **10:49:49** · total **3.3h** · opened by Manoj K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:29:50 | 09:31:46 | 2.0h | Manoj K (BRANCH) |
| 2 · Estimation + negotiation | 09:31:46 | 10:09:08 | 37.4m | assayer / sales |
| 3 · Quotation prep | 10:09:08 | 10:11:46 | 2.6m | Manoj K (BRANCH) |
| 4 · Quotation approval | 10:11:46 | 10:46:05 | 34.3m | Sanathana K (OTHERS) |
| R · Release sales approval | 07:30:19 | 08:23:19 | 53.0m | sales: APPROVED / head: — |
| R · Takeover agreement | 07:43:15 | 07:51:06 | 7.9m | signed |
| KYC · APPROVED | 07:42:42 | 07:42:42 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:42:50 | 07:42:50 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:42:50 | 08:23:19 | 40.5m | Sudarshan  B L (ACCOUNTS) |
| 7 · Order | 08:23:19 | 10:49:49 | 2.4h | — |
| 8 · Completion | 08:23:19 | 10:49:49 | 2.4h | system |

### 85. WGKA-55598 · RADHIKA RAMDAS KT · KL-CALICUT · PHYSICAL
Opened **07:30:18** → Completed **07:46:06** · total **15.8m** · opened by Urmila P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:30:18 | 07:30:56 | 0.6m | Urmila P (BRANCH) |
| 2 · Estimation + negotiation | 07:30:56 | 07:35:18 | 4.4m | assayer / sales |
| 3 · Quotation prep | 07:35:18 | 07:40:06 | 4.8m | Urmila P (BRANCH) |
| 4 · Quotation approval | 07:40:06 | 07:42:39 | 2.6m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:39:42 | 07:39:42 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:39:50 | 07:39:50 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:39:50 | 07:42:32 | 2.7m | Urmila P (BRANCH) |
| 7 · Order | 07:42:32 | 07:46:06 | 3.6m | — |
| 8 · Completion | 07:42:32 | 07:46:06 | 3.6m | system |

### 86. WGKA-55601 · Ravi S · MYSURU · PHYSICAL
Opened **07:38:46** → Completed **10:03:46** · total **2.4h** · opened by Leena K L (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:38:46 | 07:39:39 | 0.9m | Leena K L (BRANCH) |
| 2 · Estimation + negotiation | 07:39:39 | 09:23:36 | 1.7h | Manoj B (BRANCH) |
| 3 · Quotation prep | 09:23:36 | 09:25:24 | 1.8m | Leena K L (BRANCH) |
| 4 · Quotation approval | 09:25:24 | 09:50:35 | 25.2m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:13:43 | 09:13:43 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:17:37 | 09:17:37 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:17:40 | 09:17:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:17:40 | 09:59:09 | 41.5m | accounts / branch |
| 8 · Completion | 09:59:09 | 10:03:46 | 4.6m | system |

### 87. WGKA-55603 · DEEPA  B · KL-OTTAPALAM · PHYSICAL
Opened **07:40:15** → Completed **08:04:55** · total **24.7m** · opened by Roopesh  K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:40:15 | 07:41:16 | 1.0m | Roopesh  K (BRANCH) |
| 2 · Estimation + negotiation | 07:41:16 | 07:49:34 | 8.3m | assayer / sales |
| 3 · Quotation prep | 07:49:34 | 07:56:33 | 7.0m | Roopesh  K (BRANCH) |
| 4 · Quotation approval | 07:56:33 | 07:58:56 | 2.4m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 07:55:10 | 07:55:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:55:46 | 07:55:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:55:46 | 08:00:07 | 4.3m | Roopesh  K (BRANCH) |
| 7 · Order | 08:00:07 | 08:04:55 | 4.8m | — |
| 8 · Completion | 08:00:07 | 08:04:55 | 4.8m | system |

### 88. WGKA-55607 · Dinesh A · BANNERGHATTA · PHYSICAL
Opened **07:47:23** → Completed **08:29:52** · total **42.5m** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:47:23 | 07:48:06 | 0.7m | Harshith V (BRANCH) |
| 2 · Estimation + negotiation | 07:48:06 | 07:53:21 | 5.2m | assayer / sales |
| 3 · Quotation prep | 07:53:21 | 08:15:21 | 22.0m | Harshith V (BRANCH) |
| 4 · Quotation approval | 08:15:21 | 08:24:46 | 9.4m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 08:14:31 | 08:14:31 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:14:42 | 08:14:42 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:14:42 | 08:25:03 | 10.4m | Neslin A (ACCOUNTS) |
| 7 · Order | 08:25:03 | 08:29:52 | 4.8m | — |
| 8 · Completion | 08:25:03 | 08:29:52 | 4.8m | system |

### 89. WGKA-55611 · ATHIRA A U A U · KL-KESHAVADASAPURAM · PHYSICAL
Opened **07:51:03** → Completed **08:20:36** · total **29.5m** · opened by Jinu Chandran  B S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:51:03 | 07:51:40 | 0.6m | Jinu Chandran  B S (BRANCH) |
| 2 · Estimation + negotiation | 07:51:40 | 08:08:51 | 17.2m | assayer / sales |
| 3 · Quotation prep | 08:08:51 | 08:08:53 | 0.0m | Jinu Chandran  B S (BRANCH) |
| 4 · Quotation approval | 08:08:53 | 08:12:58 | 4.1m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:57:06 | 07:57:06 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:57:10 | 07:57:10 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 07:57:10 | 08:13:15 | 16.1m | Jinu Chandran  B S (BRANCH) |
| 7 · Order | 08:13:15 | 08:20:36 | 7.3m | — |
| 8 · Completion | 08:13:15 | 08:20:36 | 7.3m | system |

### 90. WGKA-55612 · Nikhil  N · TUMKUR · PHYSICAL
Opened **07:53:23** → Completed **09:26:20** · total **1.5h** · opened by Mohammed Pasha (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:53:23 | 07:53:35 | 0.2m | Mohammed Pasha (BRANCH) |
| 2 · Estimation + negotiation | 07:53:35 | 08:17:08 | 23.6m | Vasantha N (SALES) |
| 3 · Quotation prep | 08:17:08 | 08:55:12 | 38.1m | Mohammed Pasha (BRANCH) |
| 4 · Quotation approval | 08:55:12 | 09:17:40 | 22.5m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:41:38 | 08:41:38 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:54:48 | 08:54:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:55:04 | 08:55:04 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:55:04 | 09:19:48 | 24.7m | Mohammed Pasha (BRANCH) |
| 8 · Completion | 09:19:48 | 09:26:20 | 6.5m | system |

### 91. WGKA-55613 · Chethan Kumar Rai · MANGALURU · PHYSICAL
Opened **07:54:21** → Completed **11:04:54** · total **3.2h** · opened by Sowmya Devadiga (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:54:21 | 07:54:47 | 0.4m | Sowmya Devadiga (BRANCH) |
| 2 · Estimation + negotiation | 07:54:47 | 09:45:29 | 1.8h | Vasantha N (SALES) |
| 3 · Quotation prep | 09:45:29 | 10:24:12 | 38.7m | Sowmya Devadiga (BRANCH) |
| 4 · Quotation approval | 10:24:12 | 10:57:44 | 33.5m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 10:23:51 | 10:23:51 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:24:02 | 10:24:02 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:24:02 | 10:59:21 | 35.3m | accounts / branch |
| 8 · Completion | 10:59:21 | 11:04:54 | 5.6m | system |

### 92. WGKA-55615 · JOHN KM · KL-THIRUVALLA · PHYSICAL
Opened **07:55:42** → Completed **08:29:03** · total **33.3m** · opened by Arun  Kumar M S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:55:42 | 07:56:52 | 1.2m | Arun  Kumar M S (BRANCH) |
| 2 · Estimation + negotiation | 07:56:52 | 08:10:20 | 13.5m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 08:10:20 | 08:21:22 | 11.0m | Arun  Kumar M S (BRANCH) |
| 4 · Quotation approval | 08:21:22 | 08:25:25 | 4.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:19:46 | 08:19:46 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:20:56 | 08:20:56 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:20:56 | 08:26:01 | 5.1m | Arun  Kumar M S (BRANCH) |
| 7 · Order | 08:26:01 | 08:29:03 | 3.0m | — |
| 8 · Completion | 08:26:01 | 08:29:03 | 3.0m | system |

### 93. WGKA-55616 · HEMA  SUNU · KL-THOPPUMPADY · PHYSICAL
Opened **07:56:32** → Completed **08:24:04** · total **27.5m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:56:32 | 07:56:43 | 0.2m | Glen Joseph (BRANCH) |
| 2 · Estimation + negotiation | 07:56:43 | 08:07:18 | 10.6m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 08:07:18 | 08:12:00 | 4.7m | Glen Joseph (BRANCH) |
| 4 · Quotation approval | 08:12:00 | 08:20:59 | 9.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 08:10:08 | 08:10:08 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:11:46 | 08:11:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:11:46 | 08:21:24 | 9.6m | Glen Joseph (BRANCH) |
| 7 · Order | 08:21:24 | 08:24:04 | 2.7m | — |
| 8 · Completion | 08:21:24 | 08:24:04 | 2.7m | system |

### 94. WGKA-55618 · USHA JAYADEVAN · KL-THRISSUR · PHYSICAL
Opened **07:59:43** → Completed **08:27:18** · total **27.6m** · opened by Ciljan George (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 07:59:43 | 07:59:56 | 0.2m | Ciljan George (BRANCH) |
| 2 · Estimation + negotiation | 07:59:56 | 08:08:52 | 8.9m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 08:08:52 | 08:12:19 | 3.4m | Ciljan George (BRANCH) |
| 4 · Quotation approval | 08:12:19 | 08:21:12 | 8.9m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 08:11:13 | 08:11:13 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:11:40 | 08:11:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:11:40 | 08:23:29 | 11.8m | Neslin A (ACCOUNTS) |
| 7 · Order | 08:23:29 | 08:27:18 | 3.8m | — |
| 8 · Completion | 08:23:29 | 08:27:18 | 3.8m | system |

### 95. WGKA-55619 · BIJOY HARIDAS · KL-EDAPPALLY · PHYSICAL
Opened **08:08:06** → Completed **08:28:51** · total **20.8m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:08:06 | 08:08:30 | 0.4m | Anand M Menon (BRANCH) |
| 2 · Estimation + negotiation | 08:08:30 | 08:25:23 | 16.9m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 08:25:23 | 08:25:49 | 0.4m | Anand M Menon (BRANCH) |
| 4 · Quotation approval | 08:25:49 | 08:26:48 | 1.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 08:18:38 | 08:18:38 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:18:45 | 08:18:45 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:18:45 | 08:27:04 | 8.3m | Anand M Menon (BRANCH) |
| 7 · Order | 08:27:04 | 08:28:51 | 1.8m | — |
| 8 · Completion | 08:27:04 | 08:28:51 | 1.8m | system |

### 96. WGKA-55623 · vasanth Kumar  K E · JALAHALLI · PHYSICAL
Opened **08:14:56** → Completed **09:27:18** · total **1.2h** · opened by Madhusudhan P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:14:56 | 08:16:03 | 1.1m | Madhusudhan P (BRANCH) |
| 2 · Estimation + negotiation | 08:16:03 | 08:34:42 | 18.6m | Praveen N (SALES) |
| 3 · Quotation prep | 08:34:42 | 09:13:18 | 38.6m | Madhusudhan P (BRANCH) |
| 4 · Quotation approval | 09:13:18 | 09:25:34 | 12.3m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:04:24 | 09:04:24 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · REQUESTED | 09:10:08 | 09:10:08 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:12:52 | 09:12:52 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:13:04 | 09:13:04 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:13:04 | 09:25:53 | 12.8m | Madhusudhan P (BRANCH) |
| 7 · Order | 09:25:53 | 09:27:18 | 1.4m | — |
| 8 · Completion | 09:25:53 | 09:27:18 | 1.4m | system |

### 97. WGKA-55625 · Abiswetha S · HOSA ROAD · PHYSICAL
Opened **08:18:11** → Completed **08:44:32** · total **26.3m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:18:11 | 08:18:40 | 0.5m | Hareesh  Naik (BRANCH) |
| 2 · Estimation + negotiation | 08:18:40 | 08:22:14 | 3.6m | assayer / sales |
| 3 · Quotation prep | 08:22:14 | 08:34:56 | 12.7m | Hareesh  Naik (BRANCH) |
| 4 · Quotation approval | 08:34:56 | 08:39:36 | 4.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:30:44 | 08:30:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:33:05 | 08:33:05 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:33:05 | 08:39:51 | 6.8m | Praveen J (BRANCH) |
| 7 · Order | 08:39:51 | 08:44:32 | 4.7m | — |
| 8 · Completion | 08:39:51 | 08:44:32 | 4.7m | system |

### 98. WGKA-55626 · Balraj Balraj · TS-KUKATPALLY · PHYSICAL
Opened **08:18:59** → Completed **10:25:53** · total **2.1h** · opened by Gaddala Paul  Dinakar (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:18:59 | 08:22:43 | 3.7m | Gaddala Paul  Dinakar (BRANCH) |
| 2 · Estimation + negotiation | 08:22:43 | 09:50:11 | 1.5h | J Manoj Kumar (OTHERS) |
| 3 · Quotation prep | 09:50:11 | 10:00:34 | 10.4m | Gaddala Paul  Dinakar (BRANCH) |
| 4 · Quotation approval | 10:00:34 | 10:18:30 | 17.9m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 09:08:10 | 09:08:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 09:20:38 | 09:20:38 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 09:56:07 | 09:56:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:59:05 | 09:59:05 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:00:20 | 10:00:20 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:00:20 | 10:19:04 | 18.7m | accounts / branch |
| 8 · Completion | 10:19:04 | 10:25:53 | 6.8m | system |

### 99. WGKA-55627 · Biswas Kumar · K R PURAM · PHYSICAL
Opened **08:19:32** → Completed **09:13:56** · total **54.4m** · opened by Sridhara MS (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:19:32 | 08:20:04 | 0.5m | Sridhara MS (BRANCH) |
| 2 · Estimation + negotiation | 08:20:04 | 08:30:01 | 9.9m | assayer / sales |
| 3 · Quotation prep | 08:30:01 | 09:05:18 | 35.3m | Sridhara MS (BRANCH) |
| 4 · Quotation approval | 09:05:18 | 09:12:06 | 6.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:46:44 | 08:46:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 08:51:51 | 08:51:51 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 09:03:07 | 09:03:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:04:35 | 09:04:35 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:04:50 | 09:04:50 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:04:50 | 09:12:26 | 7.6m | Sridhara MS (BRANCH) |
| 7 · Order | 09:12:26 | 09:13:56 | 1.5m | — |
| 8 · Completion | 09:12:26 | 09:13:56 | 1.5m | system |

### 100. WGKA-55631 · MIDHUN JACOB · KL-THOPPUMPADY · PHYSICAL
Opened **08:23:39** → Completed **09:13:32** · total **49.9m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:23:39 | 08:24:48 | 1.2m | Glen Joseph (BRANCH) |
| 2 · Estimation + negotiation | 08:24:48 | 09:01:01 | 36.2m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 09:01:01 | 09:08:04 | 7.0m | Glen Joseph (BRANCH) |
| 4 · Quotation approval | 09:08:04 | 09:10:54 | 2.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:07:43 | 09:07:43 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:07:52 | 09:07:52 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:07:56 | 09:07:56 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:07:56 | 09:11:15 | 3.3m | Glen Joseph (BRANCH) |
| 7 · Order | 09:11:15 | 09:13:32 | 2.3m | — |
| 8 · Completion | 09:11:15 | 09:13:32 | 2.3m | system |

### 101. WGKA-55632 · PRABHAKAR DVID KAUNDS · TUMKUR · PHYSICAL
Opened **08:24:30** → Completed **09:40:12** · total **1.3h** · opened by Mohammed Pasha (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:24:30 | 08:25:56 | 1.4m | Mohammed Pasha (BRANCH) |
| 2 · Estimation + negotiation | 08:25:56 | 08:33:38 | 7.7m | Praveen N (SALES) |
| 3 · Quotation prep | 08:33:38 | 09:14:51 | 41.2m | Mohammed Pasha (BRANCH) |
| 4 · Quotation approval | 09:14:51 | 09:35:45 | 20.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:12:33 | 09:12:33 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:13:12 | 09:13:12 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 09:13:14 | 09:13:14 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:13:14 | 09:37:07 | 23.9m | Mohammed Pasha (BRANCH) |
| 7 · Order | 09:37:07 | 09:40:12 | 3.1m | — |
| 8 · Completion | 09:37:07 | 09:40:12 | 3.1m | system |

### 102. WGKA-55634 · Arun  Krishna · THANISANDRA · PHYSICAL
Opened **08:25:22** → Completed **09:32:21** · total **1.1h** · opened by Sushmitha H T (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:25:22 | 08:26:00 | 0.6m | Sushmitha H T (BRANCH) |
| 2 · Estimation + negotiation | 08:26:00 | 08:36:46 | 10.8m | assayer / sales |
| 3 · Quotation prep | 08:36:46 | 09:25:22 | 48.6m | Sushmitha H T (BRANCH) |
| 4 · Quotation approval | 09:25:22 | 09:30:13 | 4.8m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 09:23:28 | 09:23:28 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:23:46 | 09:23:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:23:46 | 09:30:38 | 6.9m | Sushmitha H T (BRANCH) |
| 7 · Order | 09:30:38 | 09:32:21 | 1.7m | — |
| 8 · Completion | 09:30:38 | 09:32:21 | 1.7m | system |

### 103. WGKA-55635 · Mahantesh M S · DAVANAGERE · RELEASED
Opened **08:25:29** → Completed **10:36:23** · total **2.2h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:25:29 | 09:51:34 | 1.4h | Venkatesh Naik (BRANCH) |
| 2 · Estimation + negotiation | 09:51:34 | 09:58:42 | 7.1m | Banuprathap P (SALES) |
| 3 · Quotation prep | 09:58:42 | 10:09:00 | 10.3m | Venkatesh Naik (BRANCH) |
| 4 · Quotation approval | 10:09:00 | 10:23:18 | 14.3m | Vinay M (OPERATIONS) |
| R · Release sales approval | 08:26:35 | 09:22:46 | 56.2m | sales: APPROVED / head: — |
| R · Takeover agreement | 08:52:35 | 08:56:11 | 3.6m | signed |
| KYC · REQUESTED | 08:45:19 | 08:45:19 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:47:19 | 08:47:19 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:48:22 | 08:48:22 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:48:22 | 09:22:46 | 34.4m | Sudarshan  B L (ACCOUNTS) |
| 7 · Order | 09:22:46 | 10:36:23 | 1.2h | — |
| 8 · Completion | 09:22:46 | 10:36:23 | 1.2h | system |

### 104. WGKA-55636 · BHAVIKA RAJAN · KL-EDAPPALLY · PHYSICAL
Opened **08:32:27** → Completed **09:05:54** · total **33.4m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:32:27 | 08:36:10 | 3.7m | Anand M Menon (BRANCH) |
| 2 · Estimation + negotiation | 08:36:10 | 09:01:27 | 25.3m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 09:01:27 | 09:01:37 | 0.2m | Anand M Menon (BRANCH) |
| 4 · Quotation approval | 09:01:37 | 09:03:52 | 2.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:54:23 | 08:54:23 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:55:20 | 08:55:20 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 08:55:20 | 09:04:12 | 8.9m | Anand M Menon (BRANCH) |
| 7 · Order | 09:04:12 | 09:05:54 | 1.7m | — |
| 8 · Completion | 09:04:12 | 09:05:54 | 1.7m | system |

### 105. WGKA-55638 · Sevya  Naik · DAVANAGERE · PHYSICAL
Opened **08:40:24** → Completed **09:48:27** · total **1.1h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:40:24 | 08:42:01 | 1.6m | Venkatesh Naik (BRANCH) |
| 2 · Estimation + negotiation | 08:42:01 | 08:48:04 | 6.1m | Vasantha N (SALES) |
| 3 · Quotation prep | 08:48:04 | 09:40:27 | 52.4m | Venkatesh Naik (BRANCH) |
| 4 · Quotation approval | 09:40:27 | 09:44:03 | 3.6m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:16:38 | 09:16:38 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:39:37 | 09:39:37 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:40:17 | 09:40:17 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 09:40:39 | 09:40:39 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:40:39 | 09:46:59 | 6.3m | Venkatesh Naik (BRANCH) |
| 7 · Order | 09:46:59 | 09:48:27 | 1.5m | — |
| 8 · Completion | 09:46:59 | 09:48:27 | 1.5m | system |

### 106. WGKA-55639 · Koushik K · LINGARAJPURAM · PHYSICAL
Opened **08:41:23** → Completed **09:24:31** · total **43.1m** · opened by Umar Farooq (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:41:23 | 08:43:16 | 1.9m | Umar Farooq (BRANCH) |
| 2 · Estimation + negotiation | 08:43:16 | 08:49:41 | 6.4m | assayer / sales |
| 3 · Quotation prep | 08:49:41 | 09:15:35 | 25.9m | Umar Farooq (BRANCH) |
| 4 · Quotation approval | 09:15:35 | 09:20:25 | 4.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:05:48 | 09:05:48 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:14:42 | 09:14:42 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:15:00 | 09:15:00 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:15:00 | 09:21:15 | 6.3m | Umar Farooq (BRANCH) |
| 7 · Order | 09:21:15 | 09:24:31 | 3.3m | — |
| 8 · Completion | 09:21:15 | 09:24:31 | 3.3m | system |

### 107. WGKA-55644 · Uday  Naik · BELAGAVI · PHYSICAL
Opened **08:48:49** → Completed **09:56:27** · total **1.1h** · opened by Amit Gangadhar Harani (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:48:49 | 08:49:20 | 0.5m | Amit Gangadhar Harani (BRANCH) |
| 2 · Estimation + negotiation | 08:49:20 | 09:48:56 | 59.6m | Manoj B (BRANCH) |
| 3 · Quotation prep | 09:48:56 | 09:49:09 | 0.2m | Amit Gangadhar Harani (BRANCH) |
| 4 · Quotation approval | 09:49:09 | 09:53:03 | 3.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:39:24 | 09:39:24 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:43:25 | 09:43:25 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:47:40 | 09:47:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:47:40 | 09:54:08 | 6.5m | Amit Gangadhar Harani (BRANCH) |
| 7 · Order | 09:54:08 | 09:56:27 | 2.3m | — |
| 8 · Completion | 09:54:08 | 09:56:27 | 2.3m | system |

### 108. WGKA-55648 · MEENA S KUMAR · KL-KESHAVADASAPURAM · PHYSICAL
Opened **08:53:26** → Completed **09:09:44** · total **16.3m** · opened by Jinu Chandran  B S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 08:53:26 | 08:54:05 | 0.6m | Jinu Chandran  B S (BRANCH) |
| 2 · Estimation + negotiation | 08:54:05 | 08:57:32 | 3.4m | assayer / sales |
| 3 · Quotation prep | 08:57:32 | 09:05:51 | 8.3m | Jinu Chandran  B S (BRANCH) |
| 4 · Quotation approval | 09:05:51 | 09:07:46 | 1.9m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 09:02:53 | 09:02:53 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:05:31 | 09:05:31 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:05:31 | 09:08:09 | 2.6m | Jinu Chandran  B S (BRANCH) |
| 7 · Order | 09:08:09 | 09:09:44 | 1.6m | — |
| 8 · Completion | 09:08:09 | 09:09:44 | 1.6m | system |

### 109. WGKA-55654 · PRASANTH  KUMAR PP · KL-KANNUR · PHYSICAL
Opened **09:02:24** → Completed **09:18:21** · total **16.0m** · opened by Juwel  Davis (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:02:24 | 09:02:41 | 0.3m | Juwel  Davis (BRANCH) |
| 2 · Estimation + negotiation | 09:02:41 | 09:07:05 | 4.4m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 09:07:05 | 09:13:01 | 5.9m | Juwel  Davis (BRANCH) |
| 4 · Quotation approval | 09:13:01 | 09:14:38 | 1.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:12:09 | 09:12:09 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:12:54 | 09:12:54 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:12:54 | 09:16:06 | 3.2m | Juwel  Davis (BRANCH) |
| 7 · Order | 09:16:06 | 09:18:21 | 2.3m | — |
| 8 · Completion | 09:16:06 | 09:18:21 | 2.3m | system |

### 110. WGKA-55655 · Nagaraju Lakkavarapu · TS-KUKATPALLY · PHYSICAL
Opened **09:02:45** → Completed **09:50:42** · total **48.0m** · opened by Achannagari  Rakesh (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:02:45 | 09:11:01 | 8.3m | Achannagari  Rakesh (BRANCH) |
| 2 · Estimation + negotiation | 09:11:01 | 09:19:02 | 8.0m | assayer / sales |
| 3 · Quotation prep | 09:19:02 | 09:36:06 | 17.1m | Achannagari  Rakesh (BRANCH) |
| 4 · Quotation approval | 09:36:06 | 09:39:46 | 3.7m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:34:08 | 09:34:08 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:35:41 | 09:35:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:35:54 | 09:35:54 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:35:54 | 09:43:29 | 7.6m | Achannagari  Rakesh (BRANCH) |
| 7 · Order | 09:43:29 | 09:50:42 | 7.2m | — |
| 8 · Completion | 09:43:29 | 09:50:42 | 7.2m | system |

### 111. WGKA-55656 · Thippeswamy V k · DAVANAGERE · PHYSICAL
Opened **09:03:30** → Completed **10:21:30** · total **1.3h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:03:30 | 09:03:59 | 0.5m | Venkatesh Naik (BRANCH) |
| 2 · Estimation + negotiation | 09:03:59 | 09:06:56 | 2.9m | Manoj B (BRANCH) |
| 3 · Quotation prep | 09:06:56 | 09:16:52 | 9.9m | Venkatesh Naik (BRANCH) |
| 4 · Quotation approval | 09:16:52 | 09:32:23 | 15.5m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:16:22 | 09:16:22 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:16:39 | 09:16:39 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:16:39 | 10:17:03 | 1.0h | Venkatesh Naik (BRANCH) |
| 7 · Order | 10:17:03 | 10:21:30 | 4.5m | — |
| 8 · Completion | 10:17:03 | 10:21:30 | 4.5m | system |

### 112. WGKA-55663 · Sanjay Kumar · HASSAN · PHYSICAL
Opened **09:08:52** → Completed **10:02:45** · total **53.9m** · opened by Nuthan D S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:08:52 | 09:09:16 | 0.4m | Nuthan D S (BRANCH) |
| 2 · Estimation + negotiation | 09:09:16 | 09:28:49 | 19.6m | Banuprathap P (SALES) |
| 3 · Quotation prep | 09:28:49 | 09:54:43 | 25.9m | Nuthan D S (BRANCH) |
| 4 · Quotation approval | 09:54:43 | 09:59:36 | 4.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:48:11 | 09:48:11 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:51:49 | 09:51:49 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:53:05 | 09:53:05 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:53:05 | 10:00:53 | 7.8m | Nuthan D S (BRANCH) |
| 7 · Order | 10:00:53 | 10:02:45 | 1.9m | — |
| 8 · Completion | 10:00:53 | 10:02:45 | 1.9m | system |

### 113. WGKA-55668 · Appannanaika  Naik · HOSPETE · PHYSICAL
Opened **09:19:04** → Completed **11:07:37** · total **1.8h** · opened by Sangeetha J (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:19:04 | 09:21:12 | 2.1m | Sangeetha J (BRANCH) |
| 2 · Estimation + negotiation | 09:21:12 | 10:12:49 | 51.6m | Manoj B (BRANCH) |
| 3 · Quotation prep | 10:12:49 | 10:54:50 | 42.0m | Sangeetha J (BRANCH) |
| 4 · Quotation approval | 10:54:50 | 11:00:01 | 5.2m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 10:46:25 | 10:46:25 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:51:18 | 10:51:18 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:53:44 | 10:53:44 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:53:44 | 11:00:43 | 7.0m | Sangeetha J (BRANCH) |
| 7 · Order | 11:00:43 | 11:07:37 | 6.9m | — |
| 8 · Completion | 11:00:43 | 11:07:37 | 6.9m | system |

### 114. WGKA-55669 · Rajesh Kumar · KOLAR · PHYSICAL
Opened **09:19:24** → Completed **10:44:32** · total **1.4h** · opened by Harish K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:19:24 | 09:20:57 | 1.5m | Harish K (BRANCH) |
| 2 · Estimation + negotiation | 09:20:57 | 09:47:36 | 26.7m | Anand R (SALES) |
| 3 · Quotation prep | 09:47:36 | 10:22:24 | 34.8m | Harish K (BRANCH) |
| 4 · Quotation approval | 10:22:24 | 10:32:10 | 9.8m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 10:21:37 | 10:21:37 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:22:05 | 10:22:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:22:05 | 10:32:39 | 10.6m | accounts / branch |
| 8 · Completion | 10:32:39 | 10:44:32 | 11.9m | system |

### 115. WGKA-55670 · Saran  Kumar · TC PALYA · PHYSICAL
Opened **09:20:43** → Completed **09:45:22** · total **24.7m** · opened by Srinivas Kempanna (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:20:43 | 09:21:35 | 0.9m | Srinivas Kempanna (BRANCH) |
| 2 · Estimation + negotiation | 09:21:35 | 09:23:42 | 2.1m | assayer / sales |
| 3 · Quotation prep | 09:23:42 | 09:38:19 | 14.6m | Srinivas Kempanna (BRANCH) |
| 4 · Quotation approval | 09:38:19 | 09:43:34 | 5.2m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:37:22 | 09:37:22 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:37:40 | 09:37:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:37:40 | 09:43:41 | 6.0m | Srinivas Kempanna (BRANCH) |
| 7 · Order | 09:43:41 | 09:45:22 | 1.7m | — |
| 8 · Completion | 09:43:41 | 09:45:22 | 1.7m | system |

### 116. WGKA-55673 · Ajay Krishna · BASAWESHWARANAGAR · PHYSICAL
Opened **09:23:04** → Completed **10:02:51** · total **39.8m** · opened by Yashas Gowda H R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:23:04 | 09:24:45 | 1.7m | Yashas Gowda H R (BRANCH) |
| 2 · Estimation + negotiation | 09:24:45 | 09:26:47 | 2.0m | assayer / sales |
| 3 · Quotation prep | 09:26:47 | 09:57:26 | 30.7m | Yashas Gowda H R (BRANCH) |
| 4 · Quotation approval | 09:57:26 | 10:00:22 | 2.9m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 09:36:48 | 09:36:48 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:49:36 | 09:49:36 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 09:50:09 | 09:50:09 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 09:57:21 | 09:57:21 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:57:21 | 10:00:35 | 3.2m | Yashas Gowda H R (BRANCH) |
| 7 · Order | 10:00:35 | 10:02:51 | 2.3m | — |
| 8 · Completion | 10:00:35 | 10:02:51 | 2.3m | system |

### 117. WGKA-55676 · VIJAYABALAKRISHNAN S · KL-VARKALA · PHYSICAL
Opened **09:26:42** → Completed **10:15:27** · total **48.8m** · opened by Sona S Kumar (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:26:42 | 09:27:14 | 0.5m | Sona S Kumar (BRANCH) |
| 2 · Estimation + negotiation | 09:27:14 | 09:34:52 | 7.6m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 09:34:52 | 09:38:16 | 3.4m | Sona S Kumar (BRANCH) |
| 4 · Quotation approval | 09:38:16 | 10:04:43 | 26.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:38:02 | 09:38:02 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:38:04 | 09:38:04 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:38:08 | 09:38:08 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:38:08 | 10:08:09 | 30.0m | Sona S Kumar (BRANCH) |
| 7 · Order | 10:08:09 | 10:15:27 | 7.3m | — |
| 8 · Completion | 10:08:09 | 10:15:27 | 7.3m | system |

### 118. WGKA-55678 · AISHA PRAVEEN VF · KL-VENNALA-BY-PASS · PHYSICAL
Opened **09:32:07** → Completed **09:43:55** · total **11.8m** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:32:07 | 09:32:14 | 0.1m | Arun Kumar P K (BRANCH) |
| 2 · Estimation + negotiation | 09:32:14 | 09:34:02 | 1.8m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 09:34:02 | 09:39:43 | 5.7m | Arun Kumar P K (BRANCH) |
| 4 · Quotation approval | 09:39:43 | 09:42:07 | 2.4m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 09:37:17 | 09:37:17 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:37:32 | 09:37:32 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:37:32 | 09:42:29 | 4.9m | Arun Kumar P K (BRANCH) |
| 7 · Order | 09:42:29 | 09:43:55 | 1.4m | — |
| 8 · Completion | 09:42:29 | 09:43:55 | 1.4m | system |

### 119. WGKA-55679 · Heena Houser · CHIKMAGALURU · PHYSICAL
Opened **09:35:24** → Completed **10:49:04** · total **1.2h** · opened by Joyalin Seravo (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:35:24 | 09:36:21 | 1.0m | Joyalin Seravo (BRANCH) |
| 2 · Estimation + negotiation | 09:36:21 | 09:41:26 | 5.1m | assayer / sales |
| 3 · Quotation prep | 09:41:26 | 09:53:10 | 11.7m | Joyalin Seravo (BRANCH) |
| 4 · Quotation approval | 09:53:10 | 10:01:29 | 8.3m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 09:50:03 | 09:50:03 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:52:35 | 09:52:35 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:52:51 | 09:52:51 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 09:52:51 | 10:02:33 | 9.7m | accounts / branch |
| 8 · Completion | 10:02:33 | 10:49:04 | 46.5m | system |

### 120. WGKA-55680 · NAJEEB S · KL-EDAPPALLY · PHYSICAL
Opened **09:36:39** → Completed **10:31:40** · total **55.0m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:36:39 | 09:36:46 | 0.1m | Anand M Menon (BRANCH) |
| 2 · Estimation + negotiation | 09:36:46 | 10:22:57 | 46.2m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 10:22:57 | 10:28:06 | 5.2m | Anand M Menon (BRANCH) |
| 4 · Quotation approval | 10:28:06 | 10:29:20 | 1.2m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 10:25:21 | 10:25:21 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:27:57 | 10:27:57 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:27:57 | 10:30:10 | 2.2m | Anand M Menon (BRANCH) |
| 7 · Order | 10:30:10 | 10:31:40 | 1.5m | — |
| 8 · Completion | 10:30:10 | 10:31:40 | 1.5m | system |

### 121. WGKA-55682 · Divya  V · AP-GAJUWAKA · PHYSICAL
Opened **09:40:25** → Completed **11:12:24** · total **1.5h** · opened by Siripuram Srinivasa Rao (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:40:25 | 09:42:01 | 1.6m | Siripuram Srinivasa Rao (BRANCH) |
| 2 · Estimation + negotiation | 09:42:01 | 09:58:20 | 16.3m | Bharath R (BRANCH) |
| 3 · Quotation prep | 09:58:20 | 10:29:12 | 30.9m | Siripuram Srinivasa Rao (BRANCH) |
| 4 · Quotation approval | 10:29:12 | 11:02:19 | 33.1m | Nagendra Prasad D (OPERATIONS) |
| KYC · REQUESTED | 10:17:42 | 10:17:42 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:28:44 | 10:28:44 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:28:53 | 10:28:53 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:28:53 | 11:03:17 | 34.4m | Siripuram Srinivasa Rao (BRANCH) |
| 7 · Order | 11:03:17 | 11:12:24 | 9.1m | — |
| 8 · Completion | 11:03:17 | 11:12:24 | 9.1m | system |

### 122. WGKA-55685 · Zaiba Kousafar · ADUGODI · PHYSICAL
Opened **09:52:56** → Completed **10:19:43** · total **26.8m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:52:56 | 09:54:06 | 1.2m | Tejus A (BRANCH) |
| 2 · Estimation + negotiation | 09:54:06 | 09:56:06 | 2.0m | assayer / sales |
| 3 · Quotation prep | 09:56:06 | 10:09:37 | 13.5m | Tejus A (BRANCH) |
| 4 · Quotation approval | 10:09:37 | 10:16:25 | 6.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 10:07:05 | 10:07:05 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:08:30 | 10:08:30 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:09:27 | 10:09:27 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:09:27 | 10:16:52 | 7.4m | Tejus A (BRANCH) |
| 7 · Order | 10:16:52 | 10:19:43 | 2.8m | — |
| 8 · Completion | 10:16:52 | 10:19:43 | 2.8m | system |

### 123. WGKA-55687 · Roshan  S · JAYANAGAR · PHYSICAL
Opened **09:53:29** → Completed **10:21:39** · total **28.2m** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:53:29 | 09:54:21 | 0.9m | Preethi s (BRANCH) |
| 2 · Estimation + negotiation | 09:54:21 | 10:00:54 | 6.6m | assayer / sales |
| 3 · Quotation prep | 10:00:54 | 10:14:11 | 13.3m | Preethi s (BRANCH) |
| 4 · Quotation approval | 10:14:11 | 10:19:41 | 5.5m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 10:13:14 | 10:13:14 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:13:23 | 10:13:23 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:13:23 | 10:20:02 | 6.7m | Preethi s (BRANCH) |
| 7 · Order | 10:20:02 | 10:21:39 | 1.6m | — |
| 8 · Completion | 10:20:02 | 10:21:39 | 1.6m | system |

### 124. WGKA-55688 · NISHAND N B · KL-EDAPPALLY · PHYSICAL
Opened **09:54:55** → Completed **10:08:50** · total **13.9m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 09:54:55 | 09:55:19 | 0.4m | Anand M Menon (BRANCH) |
| 2 · Estimation + negotiation | 09:55:19 | 10:03:38 | 8.3m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 10:03:38 | 10:03:53 | 0.2m | Anand M Menon (BRANCH) |
| 4 · Quotation approval | 10:03:53 | 10:06:31 | 2.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 10:02:44 | 10:02:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:02:52 | 10:02:52 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 10:03:03 | 10:03:03 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:03:03 | 10:07:12 | 4.1m | Anand M Menon (BRANCH) |
| 7 · Order | 10:07:12 | 10:08:50 | 1.6m | — |
| 8 · Completion | 10:07:12 | 10:08:50 | 1.6m | system |

### 125. WGKA-55691 · Madhubani krishnappa K · MARATHAHALLI · PHYSICAL
Opened **10:03:40** → Completed **11:15:19** · total **1.2h** · opened by Sunil Javali (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:03:40 | 10:04:52 | 1.2m | Sunil Javali (BRANCH) |
| 2 · Estimation + negotiation | 10:04:52 | 10:12:32 | 7.7m | Manoj B (BRANCH) |
| 3 · Quotation prep | 10:12:32 | 11:02:41 | 50.2m | Sunil Javali (BRANCH) |
| 4 · Quotation approval | 11:02:41 | 11:12:28 | 9.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 10:38:32 | 10:38:32 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 11:01:45 | 11:01:45 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 11:02:34 | 11:02:34 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 11:02:34 | 11:13:01 | 10.5m | Sunil Javali (BRANCH) |
| 7 · Order | 11:13:01 | 11:15:19 | 2.3m | — |
| 8 · Completion | 11:13:01 | 11:15:19 | 2.3m | system |

### 126. WGKA-55693 · Aswin R · BOMMANAHALLI · PHYSICAL
Opened **10:06:12** → Completed **10:47:34** · total **41.4m** · opened by Geetha S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:06:12 | 10:07:02 | 0.8m | Geetha S (BRANCH) |
| 2 · Estimation + negotiation | 10:07:02 | 10:10:53 | 3.9m | Praveen N (SALES) |
| 3 · Quotation prep | 10:10:53 | 10:31:25 | 20.5m | Geetha S (BRANCH) |
| 4 · Quotation approval | 10:31:25 | 10:35:36 | 4.2m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 10:27:41 | 10:27:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:27:51 | 10:27:51 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:27:51 | 10:39:29 | 11.6m | Mallikarjun Dalavi (BRANCH) |
| 7 · Order | 10:39:29 | 10:47:34 | 8.1m | — |
| 8 · Completion | 10:39:29 | 10:47:34 | 8.1m | system |

### 127. WGKA-55698 · GREESHMA  PB · KL-CALICUT · PHYSICAL
Opened **10:23:10** → Completed **10:41:28** · total **18.3m** · opened by Urmila P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:23:10 | 10:23:54 | 0.7m | Urmila P (BRANCH) |
| 2 · Estimation + negotiation | 10:23:54 | 10:31:06 | 7.2m | assayer / sales |
| 3 · Quotation prep | 10:31:06 | 10:37:21 | 6.2m | Urmila P (BRANCH) |
| 4 · Quotation approval | 10:37:21 | 10:39:33 | 2.2m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 10:36:54 | 10:36:54 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:36:57 | 10:36:57 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:36:59 | 10:36:59 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:36:59 | 10:39:40 | 2.7m | Urmila P (BRANCH) |
| 7 · Order | 10:39:40 | 10:41:28 | 1.8m | — |
| 8 · Completion | 10:39:40 | 10:41:28 | 1.8m | system |

### 128. WGKA-55701 · Satish kumar  Ontikommu · SARJAPURA · PHYSICAL
Opened **10:26:15** → Completed **11:17:25** · total **51.2m** · opened by Ananda R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:26:15 | 10:28:08 | 1.9m | Ananda R (BRANCH) |
| 2 · Estimation + negotiation | 10:28:08 | 10:47:31 | 19.4m | Praveen N (SALES) |
| 3 · Quotation prep | 10:47:31 | 10:59:31 | 12.0m | Ananda R (BRANCH) |
| 4 · Quotation approval | 10:59:31 | 11:14:09 | 14.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 10:58:10 | 10:58:10 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:59:07 | 10:59:07 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:59:07 | 11:14:55 | 15.8m | Ananda R (BRANCH) |
| 7 · Order | 11:14:55 | 11:17:25 | 2.5m | — |
| 8 · Completion | 11:14:55 | 11:17:25 | 2.5m | system |

### 129. WGKA-55702 · Suma S · MALLESHWARAM · PHYSICAL
Opened **10:30:51** → Completed **11:25:19** · total **54.5m** · opened by Drakshayani K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:30:51 | 10:31:41 | 0.8m | Drakshayani K (BRANCH) |
| 2 · Estimation + negotiation | 10:31:41 | 10:48:55 | 17.2m | Praveen N (SALES) |
| 3 · Quotation prep | 10:48:55 | 10:56:57 | 8.0m | Drakshayani K (BRANCH) |
| 4 · Quotation approval | 10:56:57 | 11:21:56 | 25.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 10:56:15 | 10:56:15 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:56:20 | 10:56:20 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:56:20 | 11:22:37 | 26.3m | Drakshayani K (BRANCH) |
| 7 · Order | 11:22:37 | 11:25:19 | 2.7m | — |
| 8 · Completion | 11:22:37 | 11:25:19 | 2.7m | system |

### 130. WGKA-55705 · NIVI  KURIAKOSE · KL-VENNALA-BY-PASS · PHYSICAL
Opened **10:32:36** → Completed **11:12:21** · total **39.8m** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:32:36 | 10:33:11 | 0.6m | Arun Kumar P K (BRANCH) |
| 2 · Estimation + negotiation | 10:33:11 | 11:07:56 | 34.8m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 11:07:56 | 11:08:09 | 0.2m | Arun Kumar P K (BRANCH) |
| 4 · Quotation approval | 11:08:09 | 11:10:08 | 2.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 10:40:41 | 10:40:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:40:44 | 10:40:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:40:45 | 10:40:45 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 10:40:45 | 11:10:32 | 29.8m | Arun Kumar P K (BRANCH) |
| 7 · Order | 11:10:32 | 11:12:21 | 1.8m | — |
| 8 · Completion | 11:10:32 | 11:12:21 | 1.8m | system |

### 131. WGKA-55708 · Bhubaneswari B M · UTTARAHALLI · PHYSICAL
Opened **10:42:27** → Completed **11:37:41** · total **55.2m** · opened by Harinakshi T M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 10:42:27 | 10:43:37 | 1.2m | Harinakshi T M (BRANCH) |
| 2 · Estimation + negotiation | 10:43:37 | 10:47:47 | 4.2m | assayer / sales |
| 3 · Quotation prep | 10:47:47 | 11:07:37 | 19.8m | Harinakshi T M (BRANCH) |
| 4 · Quotation approval | 11:07:37 | 11:15:11 | 7.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 11:03:24 | 11:03:24 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 11:04:09 | 11:04:09 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 11:04:09 | 11:35:06 | 31.0m | Harinakshi T M (BRANCH) |
| 7 · Order | 11:35:06 | 11:37:41 | 2.6m | — |
| 8 · Completion | 11:35:06 | 11:37:41 | 2.6m | system |

### 132. WGKA-55717 · SREELEKHA RAJAN · KL-KALPETTA · PHYSICAL
Opened **11:04:16** → Completed **11:22:31** · total **18.3m** · opened by ANEESH  A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| 1 · Valuation | 11:04:16 | 11:06:17 | 2.0m | ANEESH  A (BRANCH) |
| 2 · Estimation + negotiation | 11:06:17 | 11:13:14 | 6.9m | Aiswarya Varghese (BRANCH) |
| 3 · Quotation prep | 11:13:14 | 11:19:18 | 6.1m | ANEESH  A (BRANCH) |
| 4 · Quotation approval | 11:19:18 | 11:20:17 | 1.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 11:18:24 | 11:18:24 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 11:18:44 | 11:18:44 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| 6 · Payment | 11:18:44 | 11:20:41 | 2.0m | ANEESH  A (BRANCH) |
| 7 · Order | 11:20:41 | 11:22:31 | 1.8m | — |
| 8 · Completion | 11:20:41 | 11:22:31 | 1.8m | system |

