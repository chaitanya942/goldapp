# New CRM — Case-wise Stage Timeline (Completed cases, 2026-06-15 IST)

Reconstructed from stage-artifact timestamps (Transaction / Estimation / Quotation / Kyc+KycLog / Payment / Order). All times **IST**. The native `Timer` table is not populated for current cases, so this is rebuilt from each artifact's `created_at` and actor fields. "(reorder)" means that stage's artifact was timestamped before the previous milestone (stages can overlap/run out of strict order in the CRM).

**Cohort:** 131 transactions with status FINAL_PAYMENT_COMPLETED created today.

## Overall medians (today)

| Stage | n | median |
|---|---|---|
| Open → Estimation | 131 | 1.0m |
| Estimation → Quotation | 131 | 27.3m |
| Quotation → KYC maker | 0 | — |
| KYC maker → checker | 131 | 1.2m |
| KYC checker → Payment | 131 | 9.6m |
| Payment → Completed | 131 | 4.0m |
| **TOTAL Open → Completed** | 131 | **53.4m** |

---

## Case-by-case detail

### 1. WGKA-55442 · Paritosh Khare · HOSA ROAD · PHYSICAL_GOLD
Opened **04:45:59** → Completed **05:14:04** · total **28.1m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 04:45:59 | 04:46:46 | 0.8m | Hareesh  Naik (BRANCH) |
| Quotation approval | 04:46:46 | 05:00:18 | 13.5m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 04:57:33 | 04:57:33 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 04:59:02 | 04:59:02 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:00:02 | 05:00:02 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:00:02 | 05:05:56 | 5.9m | Praveen J (BRANCH) |
| Order | 05:05:56 | 05:14:04 | 8.1m | — |
| Completion | 05:05:56 | 05:14:04 | 8.1m | system |

### 2. WGKA-55444 · ABHISH P RAJ · KL-PALA · PHYSICAL_GOLD
Opened **04:51:25** → Completed **05:37:10** · total **45.8m** · opened by Shebin  Shaji (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 04:51:25 | 04:51:57 | 0.5m | Shebin  Shaji (BRANCH) |
| Quotation approval | 04:51:57 | 05:26:20 | 34.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:18:48 | 05:18:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:24:36 | 05:24:36 | — | Jinu Prakash (OPERATIONS) · KYC_CHECKER |
| Payment | 05:24:36 | 05:30:15 | 5.6m | Shebin  Shaji (BRANCH) |
| Order | 05:30:15 | 05:37:10 | 6.9m | — |
| Completion | 05:30:15 | 05:37:10 | 6.9m | system |

### 3. WGKA-55445 · Sreeja T K · BANNERGHATTA · PHYSICAL_GOLD
Opened **04:51:31** → Completed **05:53:25** · total **1.0h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 04:51:31 | 04:53:28 | 1.9m | Harshith V (BRANCH) |
| Quotation approval | 04:53:28 | 05:33:07 | 39.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:25:05 | 05:25:05 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:26:44 | 05:26:44 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:26:44 | 05:51:02 | 24.3m | Harshith V (BRANCH) |
| Order | 05:51:02 | 05:53:26 | 2.4m | — |
| Completion | 05:51:02 | 05:53:25 | 2.4m | system |

### 4. WGKA-55448 · Krishna Murthy  M · JAYANAGAR · RELEASED_GOLD
Opened **05:02:10** → Completed **08:07:08** · total **3.1h** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:02:10 | 07:27:17 | 2.4h | Preethi s (BRANCH) |
| Quotation approval | 07:27:17 | 07:50:40 | 23.4m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 05:25:49 | 05:25:49 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 05:26:59 | 05:26:59 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:26:59 | 06:25:40 | 58.7m | Sudarshan  B L (ACCOUNTS) |
| Order | 06:25:40 | 08:07:08 | 1.7h | — |
| Completion | 06:25:40 | 08:07:08 | 1.7h | system |

### 5. WGKA-55453 · Chaitra G · UTTARAHALLI · RELEASED_GOLD
Opened **05:05:45** → Completed **09:06:47** · total **4.0h** · opened by Harinakshi T M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:05:45 | 07:52:52 | 2.8h | Harinakshi T M (BRANCH) |
| Quotation approval | 07:52:52 | 08:13:25 | 20.5m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:30:04 | 05:30:04 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 05:42:34 | 05:42:34 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:53:41 | 05:53:41 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:57:39 | 05:57:39 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:57:39 | 06:46:41 | 49.0m | Sudarshan  B L (ACCOUNTS) |
| Order | 06:46:41 | 09:06:47 | 2.3h | — |
| Completion | 06:46:41 | 09:06:47 | 2.3h | system |

### 6. WGKA-55454 · Akshatha M p · SHIVAMOGGA · PHYSICAL_GOLD
Opened **05:08:17** → Completed **05:41:58** · total **33.7m** · opened by Rakshath M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:08:17 | 05:08:50 | 0.5m | Rakshath M (BRANCH) |
| Quotation approval | 05:08:50 | 05:32:36 | 23.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:30:32 | 05:30:32 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:31:02 | 05:31:02 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:31:02 | 05:39:34 | 8.5m | Rakshath M (BRANCH) |
| Order | 05:39:34 | 05:41:58 | 2.4m | — |
| Completion | 05:39:34 | 05:41:58 | 2.4m | system |

### 7. WGKA-55457 · SHABEER K · KL-MALAPPURAM · PHYSICAL_GOLD
Opened **05:16:52** → Completed **06:36:24** · total **1.3h** · opened by Pranav K P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:16:52 | 05:18:23 | 1.5m | Pranav K P (BRANCH) |
| Quotation approval | 05:18:23 | 06:27:46 | 1.2h | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:23:10 | 06:23:10 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:23:17 | 06:23:17 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:23:17 | 06:31:08 | 7.8m | Pranav K P (BRANCH) |
| Order | 06:31:08 | 06:36:24 | 5.3m | — |
| Completion | 06:31:08 | 06:36:24 | 5.3m | system |

### 8. WGKA-55458 · Linto GEORGE · KL-VENNALA-BY-PASS · RELEASED_GOLD
Opened **05:18:47** → Completed **10:19:00** · total **5.0h** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:18:47 | 08:48:23 | 3.5h | Arun Kumar P K (BRANCH) |
| Quotation approval | 08:48:23 | 08:51:54 | 3.5m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 05:26:07 | 05:26:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:27:12 | 05:27:12 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:27:12 | 07:48:16 | 2.4h | Harish  K (ACCOUNTS) |
| Order | 07:48:16 | 10:19:00 | 2.5h | — |
| Completion | 07:48:16 | 10:19:00 | 2.5h | system |

### 9. WGKA-55462 · Pramod  C · KODIGEHALLI · PHYSICAL_GOLD
Opened **05:19:24** → Completed **05:50:36** · total **31.2m** · opened by Sridhara L (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:19:24 | 05:19:58 | 0.6m | Sridhara L (BRANCH) |
| Quotation approval | 05:19:58 | 05:39:44 | 19.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:36:53 | 05:36:53 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:39:31 | 05:39:31 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:39:31 | 05:48:13 | 8.7m | Sridhara L (BRANCH) |
| Order | 05:48:13 | 05:50:36 | 2.4m | — |
| Completion | 05:48:13 | 05:50:36 | 2.4m | system |

### 10. WGKA-55463 · Siranjeev A · MYSURU · PHYSICAL_GOLD
Opened **05:19:24** → Completed **07:01:09** · total **1.7h** · opened by Dhananjaya  P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:19:24 | 05:20:26 | 1.0m | Dhananjaya  P (BRANCH) |
| Quotation approval | 05:20:26 | 06:43:40 | 1.4h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:56:48 | 05:56:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 06:05:53 | 06:05:53 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 06:08:16 | 06:08:16 | — | Gunjan Gupta (ADMIN) · KYC_MAKER |
| KYC · APPROVED | 06:37:49 | 06:37:49 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 06:38:38 | 06:38:38 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:43:24 | 06:43:24 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:43:24 | 06:53:10 | 9.8m | Dhananjaya  P (BRANCH) |
| Order | 06:53:10 | 07:01:09 | 8.0m | — |
| Completion | 06:53:10 | 07:01:09 | 8.0m | system |

### 11. WGKA-55465 · Raghu R · Flagship Store · PHYSICAL_GOLD
Opened **05:22:08** → Completed **06:43:23** · total **1.4h** · opened by Niroop K N (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:22:08 | 05:22:52 | 0.7m | Niroop K N (BRANCH) |
| Quotation approval | 05:22:52 | 06:12:16 | 49.4m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:49:47 | 05:49:47 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 05:54:54 | 05:54:54 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:56:03 | 05:56:03 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:58:48 | 05:58:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:58:48 | 06:23:58 | 25.2m | accounts / branch |
| Completion | 06:23:58 | 06:43:23 | 19.4m | system |

### 12. WGKA-55466 · MAYAMADHU  SM · KL-THIRUVANANTHAPURAM MGROAD · PHYSICAL_GOLD
Opened **05:25:03** → Completed **05:52:20** · total **27.3m** · opened by Sajith M V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:25:03 | 05:25:42 | 0.7m | Sajith M V (BRANCH) |
| Quotation approval | 05:25:42 | 05:40:29 | 14.8m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 05:32:30 | 05:32:30 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:33:19 | 05:33:19 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:33:19 | 05:43:56 | 10.6m | Sajith M V (BRANCH) |
| Order | 05:43:56 | 05:52:20 | 8.4m | — |
| Completion | 05:43:56 | 05:52:20 | 8.4m | system |

### 13. WGKA-55467 · Sayed  Habeebur · BANNERGHATTA · PHYSICAL_GOLD
Opened **05:25:15** → Completed **07:06:26** · total **1.7h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:25:15 | 05:26:19 | 1.1m | Harshith V (BRANCH) |
| Quotation approval | 05:26:19 | 06:43:15 | 1.3h | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:29:42 | 06:29:42 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:40:17 | 06:40:17 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:01 | 06:42:01 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:42:01 | 06:59:55 | 17.9m | Harshith V (BRANCH) |
| Completion | 06:59:55 | 07:06:26 | 6.5m | system |

### 14. WGKA-55469 · Shakunthala N · DAVANAGERE · PHYSICAL_GOLD
Opened **05:27:20** → Completed **06:47:31** · total **1.3h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:27:20 | 05:30:10 | 2.8m | Venkatesh Naik (BRANCH) |
| Quotation approval | 05:30:10 | 06:17:34 | 47.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:14:52 | 06:14:52 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:17:03 | 06:17:03 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:17:03 | 06:32:14 | 15.2m | Venkatesh Naik (BRANCH) |
| Order | 06:32:14 | 06:47:31 | 15.3m | — |
| Completion | 06:32:14 | 06:47:31 | 15.3m | system |

### 15. WGKA-55471 · Sumangala Bhuti · HUBLI · PHYSICAL_GOLD
Opened **05:27:55** → Completed **06:00:22** · total **32.4m** · opened by Shivanand Kabbalageri (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:27:55 | 05:29:18 | 1.4m | Shivanand Kabbalageri (BRANCH) |
| Quotation approval | 05:29:18 | 05:48:44 | 19.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:48:05 | 05:48:05 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 05:48:16 | 05:48:16 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:48:16 | 05:55:51 | 7.6m | Seema Savanur (BRANCH) |
| Order | 05:55:51 | 06:00:22 | 4.5m | — |
| Completion | 05:55:51 | 06:00:22 | 4.5m | system |

### 16. WGKA-55474 · Veerabhadrappa  Hb · BASAWESHWARANAGAR · RELEASED_GOLD
Opened **05:29:24** → Completed **08:42:55** · total **3.2h** · opened by Yashas Gowda H R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:29:24 | 08:26:06 | 2.9h | Yashas Gowda H R (BRANCH) |
| Quotation approval | 08:26:06 | 08:33:06 | 7.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:49:05 | 05:49:05 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 05:50:20 | 05:50:20 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:50:20 | 06:28:03 | 37.7m | Augustine T (ACCOUNTS) |
| Order | 06:28:03 | 08:42:55 | 2.2h | — |
| Completion | 06:28:03 | 08:42:55 | 2.2h | system |

### 17. WGKA-55475 · Srinivas Murthy · KATRIGUPPE · PHYSICAL_GOLD
Opened **05:31:59** → Completed **06:26:17** · total **54.3m** · opened by Manoj K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:31:59 | 05:34:44 | 2.8m | Manoj K (BRANCH) |
| Quotation approval | 05:34:44 | 06:13:50 | 39.1m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:59:26 | 05:59:26 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:11:52 | 06:11:52 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:12:13 | 06:12:13 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:12:13 | 06:21:06 | 8.9m | Manoj K (BRANCH) |
| Order | 06:21:06 | 06:26:04 | 5.0m | — |
| Completion | 06:21:06 | 06:26:17 | 5.2m | system |

### 18. WGKA-55476 · Damini  V · HOSA ROAD · PHYSICAL_GOLD
Opened **05:32:42** → Completed **06:02:05** · total **29.4m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:32:42 | 05:33:39 | 1.0m | Hareesh  Naik (BRANCH) |
| Quotation approval | 05:33:39 | 05:52:55 | 19.3m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 05:48:25 | 05:48:25 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:50:31 | 05:50:31 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:52:48 | 05:52:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:52:48 | 06:00:33 | 7.8m | Praveen J (BRANCH) |
| Order | 06:00:33 | 06:02:05 | 1.5m | — |
| Completion | 06:00:33 | 06:02:05 | 1.5m | system |

### 19. WGKA-55477 · TITUS ISSAC · KL-ADOOR · PHYSICAL_GOLD
Opened **05:34:42** → Completed **06:01:12** · total **26.5m** · opened by Jayan  C (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:34:42 | 05:35:12 | 0.5m | Jayan  C (BRANCH) |
| Quotation approval | 05:35:12 | 05:50:01 | 14.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:44:09 | 05:44:09 | — | Jinu Prakash (OPERATIONS) · KYC_MAKER |
| KYC · APPROVED | 05:44:21 | 05:44:21 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:44:31 | 05:44:31 | — | Jinu Prakash (OPERATIONS) · KYC_CHECKER |
| KYC · APPROVED | 05:44:49 | 05:44:49 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:44:49 | 05:59:40 | 14.8m | Jayan  C (BRANCH) |
| Order | 05:59:40 | 06:01:12 | 1.5m | — |
| Completion | 05:59:40 | 06:01:12 | 1.5m | system |

### 20. WGKA-55479 · Pradeep K · CHITRADURGA · PHYSICAL_GOLD
Opened **05:37:36** → Completed **07:36:25** · total **2.0h** · opened by Honnuramma E (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:37:36 | 05:38:47 | 1.2m | Honnuramma E (BRANCH) |
| Quotation approval | 05:38:47 | 07:16:01 | 1.6h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:55:47 | 06:55:47 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:58:43 | 06:58:43 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:11:29 | 07:11:29 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:11:29 | 07:28:50 | 17.4m | Honnuramma E (BRANCH) |
| Order | 07:28:50 | 07:36:25 | 7.6m | — |
| Completion | 07:28:50 | 07:36:25 | 7.6m | system |

### 21. WGKA-55480 · DIVYA KG KG · KL-MUVATTUPUZHA · PHYSICAL_GOLD
Opened **05:39:22** → Completed **06:08:48** · total **29.4m** · opened by Ajnas K A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:39:22 | 05:40:18 | 0.9m | Ajnas K A (BRANCH) |
| Quotation approval | 05:40:18 | 05:59:16 | 19.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 05:53:24 | 05:53:24 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 05:54:49 | 05:54:49 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 05:54:49 | 06:02:54 | 8.1m | Ajnas K A (BRANCH) |
| Order | 06:02:54 | 06:08:48 | 5.9m | — |
| Completion | 06:02:54 | 06:08:48 | 5.9m | system |

### 22. WGKA-55483 · Jayalaxmi Acharya · UDUPI · PHYSICAL_GOLD
Opened **05:40:53** → Completed **06:50:49** · total **1.2h** · opened by Shailesh M Palan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:40:53 | 05:41:59 | 1.1m | Shailesh M Palan (BRANCH) |
| Quotation approval | 05:41:59 | 06:37:35 | 55.6m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:36:50 | 06:36:50 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:37:13 | 06:37:13 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:37:13 | 06:47:28 | 10.2m | Shailesh M Palan (BRANCH) |
| Order | 06:47:28 | 06:50:49 | 3.4m | — |
| Completion | 06:47:28 | 06:50:49 | 3.4m | system |

### 23. WGKA-55484 · Harish T Y · KENGERI · PHYSICAL_GOLD
Opened **05:41:45** → Completed **06:29:23** · total **47.6m** · opened by Punith R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:41:45 | 05:42:09 | 0.4m | Punith R (BRANCH) |
| Quotation approval | 05:42:09 | 06:20:17 | 38.1m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:19:08 | 06:19:08 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:19:14 | 06:19:14 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:19:14 | 06:26:55 | 7.7m | Punith R (BRANCH) |
| Order | 06:26:55 | 06:29:23 | 2.5m | — |
| Completion | 06:26:55 | 06:29:23 | 2.5m | system |

### 24. WGKA-55485 · SHRUTHI KARANTH · VAJRAHALLI · PHYSICAL_GOLD
Opened **05:42:12** → Completed **06:13:31** · total **31.3m** · opened by Priya Prakash (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:42:12 | 05:42:30 | 0.3m | Priya Prakash (BRANCH) |
| Quotation approval | 05:42:30 | 06:07:18 | 24.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:05:08 | 06:05:08 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:06:33 | 06:06:33 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:06:33 | 06:11:10 | 4.6m | Priya Prakash (BRANCH) |
| Order | 06:11:10 | 06:13:31 | 2.4m | — |
| Completion | 06:11:10 | 06:13:31 | 2.4m | system |

### 25. WGKA-55486 · SAVITHRI SREEKUMAR S · KL-NEYATINKARA · PHYSICAL_GOLD
Opened **05:42:49** → Completed **06:12:03** · total **29.2m** · opened by Sam P Roy (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:42:49 | 05:44:09 | 1.3m | Sam P Roy (BRANCH) |
| Quotation approval | 05:44:09 | 06:03:28 | 19.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:01:12 | 06:01:12 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:01:42 | 06:01:42 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:01:42 | 06:07:31 | 5.8m | Sam P Roy (BRANCH) |
| Order | 06:07:31 | 06:12:03 | 4.5m | — |
| Completion | 06:07:31 | 06:12:03 | 4.5m | system |

### 26. WGKA-55487 · VINEETH KUMAR KK · KL-OTTAPALAM · PHYSICAL_GOLD
Opened **05:43:15** → Completed **06:38:40** · total **55.4m** · opened by Roopesh  K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:43:15 | 05:44:26 | 1.2m | Roopesh  K (BRANCH) |
| Quotation approval | 05:44:26 | 06:12:39 | 28.2m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:05:41 | 06:05:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:06:08 | 06:06:08 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:06:08 | 06:16:19 | 10.2m | Roopesh  K (BRANCH) |
| Order | 06:16:19 | 06:38:40 | 22.4m | — |
| Completion | 06:16:19 | 06:38:40 | 22.4m | system |

### 27. WGKA-55492 · Sivakumar  K · AP-NAD · PHYSICAL_GOLD
Opened **05:48:25** → Completed **07:05:10** · total **1.3h** · opened by Polamarasetti  Govardan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:48:25 | 05:49:08 | 0.7m | Polamarasetti  Govardan (BRANCH) |
| Quotation approval | 05:49:08 | 06:48:26 | 59.3m | Nagendra Prasad D (OPERATIONS) |
| KYC · REQUESTED | 06:39:29 | 06:39:29 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:44:38 | 06:44:38 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · REQUESTED | 06:45:54 | 06:45:54 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:48:17 | 06:48:17 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:48:17 | 07:02:11 | 13.9m | accounts / branch |
| Order | 07:02:11 | 07:05:11 | 3.0m | — |
| Completion | 07:02:11 | 07:05:10 | 3.0m | system |

### 28. WGKA-55493 · ANIL  KUMAR · KL-EDAPPALLY · PHYSICAL_GOLD
Opened **05:49:33** → Completed **06:21:49** · total **32.3m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:49:33 | 05:50:14 | 0.7m | Anand M Menon (BRANCH) |
| Quotation approval | 05:50:14 | 06:12:10 | 21.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:10:57 | 06:10:57 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:12:05 | 06:12:05 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:12:05 | 06:15:19 | 3.2m | Anand M Menon (BRANCH) |
| Order | 06:15:19 | 06:21:49 | 6.5m | — |
| Completion | 06:15:19 | 06:21:49 | 6.5m | system |

### 29. WGKA-55494 · Chandrashekhar  M S · JAYANAGAR · PHYSICAL_GOLD
Opened **05:49:41** → Completed **07:44:55** · total **1.9h** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:49:41 | 05:50:26 | 0.8m | Preethi s (BRANCH) |
| Quotation approval | 05:50:26 | 07:34:22 | 1.7h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:22:01 | 06:22:01 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:33:10 | 07:33:10 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:33:24 | 07:33:24 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:33:24 | 07:43:21 | 9.9m | Preethi s (BRANCH) |
| Order | 07:43:21 | 07:44:55 | 1.6m | — |
| Completion | 07:43:21 | 07:44:55 | 1.6m | system |

### 30. WGKA-55497 · Uddapdebnath B · ADUGODI · PHYSICAL_GOLD
Opened **05:52:41** → Completed **06:24:30** · total **31.8m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:52:41 | 05:54:12 | 1.5m | Tejus A (BRANCH) |
| Quotation approval | 05:54:12 | 06:17:05 | 22.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:10:25 | 06:10:25 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:12:41 | 06:12:41 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:16:56 | 06:16:56 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:16:56 | 06:22:26 | 5.5m | Tejus A (BRANCH) |
| Order | 06:22:26 | 06:24:30 | 2.1m | — |
| Completion | 06:22:26 | 06:24:30 | 2.1m | system |

### 31. WGKA-55498 · mahesh M · KL-KADAPPAKKADA · PHYSICAL_GOLD
Opened **05:52:50** → Completed **06:20:40** · total **27.8m** · opened by Renjith  V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:52:50 | 05:57:29 | 4.7m | Renjith  V (BRANCH) |
| Quotation approval | 05:57:29 | 06:12:08 | 14.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:11:30 | 06:11:30 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:12:00 | 06:12:00 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:12:00 | 06:14:56 | 2.9m | Renjith  V (BRANCH) |
| Order | 06:14:56 | 06:20:40 | 5.7m | — |
| Completion | 06:14:56 | 06:20:40 | 5.7m | system |

### 32. WGKA-55500 · Karthik  M · K R PURAM · PHYSICAL_GOLD
Opened **05:54:10** → Completed **07:13:12** · total **1.3h** · opened by Sridhara MS (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:54:10 | 05:55:06 | 0.9m | Sridhara MS (BRANCH) |
| Quotation approval | 05:55:06 | 06:19:50 | 24.7m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:17:08 | 06:17:08 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:19:22 | 06:19:22 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:19:22 | 07:09:47 | 50.4m | Sridhara MS (BRANCH) |
| Order | 07:09:47 | 07:13:12 | 3.4m | — |
| Completion | 07:09:47 | 07:13:12 | 3.4m | system |

### 33. WGKA-55501 · SREEDEVI PR · KL-THRIPPUNITHURA · PHYSICAL_GOLD
Opened **05:54:58** → Completed **06:26:43** · total **31.7m** · opened by Roni Raymond (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:54:58 | 05:55:33 | 0.6m | Roni Raymond (BRANCH) |
| Quotation approval | 05:55:33 | 06:20:10 | 24.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:19:40 | 06:19:40 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:19:59 | 06:19:59 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:19:59 | 06:24:41 | 4.7m | Roni Raymond (BRANCH) |
| Order | 06:24:41 | 06:26:43 | 2.0m | — |
| Completion | 06:24:41 | 06:26:43 | 2.0m | system |

### 34. WGKA-55504 · Prema H · SHIVAMOGGA · PHYSICAL_GOLD
Opened **05:56:56** → Completed **06:45:41** · total **48.8m** · opened by Pooja K G (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:56:56 | 05:57:41 | 0.8m | Pooja K G (BRANCH) |
| Quotation approval | 05:57:41 | 06:31:53 | 34.2m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:30:18 | 06:30:18 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:30:33 | 06:30:33 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:30:33 | 06:40:23 | 9.8m | Pooja K G (BRANCH) |
| Order | 06:40:23 | 06:45:41 | 5.3m | — |
| Completion | 06:40:23 | 06:45:41 | 5.3m | system |

### 35. WGKA-55505 · Vijay M · BANNERGHATTA · RELEASED_GOLD
Opened **05:57:46** → Completed **10:07:38** · total **4.2h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 05:57:46 | 08:28:43 | 2.5h | Harshith V (BRANCH) |
| Quotation approval | 08:28:43 | 08:38:16 | 9.5m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 06:19:19 | 06:19:19 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:19:33 | 06:19:33 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:19:44 | 06:19:44 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:19:44 | 06:57:22 | 37.6m | Kajji Sathish (ACCOUNTS) |
| Order | 06:57:22 | 10:07:38 | 3.2h | — |
| Completion | 06:57:22 | 10:07:38 | 3.2h | system |

### 36. WGKA-55507 · SWAPNA  NANDAKUMAR · KL-KANHANGAD · PHYSICAL_GOLD
Opened **06:01:17** → Completed **06:24:03** · total **22.8m** · opened by Sheik Muhammed Afthab (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:01:17 | 06:02:22 | 1.1m | Sheik Muhammed Afthab (BRANCH) |
| Quotation approval | 06:02:22 | 06:16:23 | 14.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:15:55 | 06:15:55 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:16:13 | 06:16:13 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:16:13 | 06:21:17 | 5.1m | Sheik Muhammed Afthab (BRANCH) |
| Order | 06:21:17 | 06:24:03 | 2.8m | — |
| Completion | 06:21:17 | 06:24:03 | 2.8m | system |

### 37. WGKA-55508 · Rachana  Shetty · MANGALURU · PHYSICAL_GOLD
Opened **06:02:06** → Completed **08:10:15** · total **2.1h** · opened by Sowmya Devadiga (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:02:06 | 06:04:33 | 2.5m | Sowmya Devadiga (BRANCH) |
| Quotation approval | 06:04:33 | 07:36:18 | 1.5h | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:35:41 | 07:35:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:35:59 | 07:35:59 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:35:59 | 08:01:01 | 25.0m | Sowmya Devadiga (BRANCH) |
| Completion | 08:01:01 | 08:10:15 | 9.2m | system |

### 38. WGKA-55510 · Saritha S · LINGARAJPURAM · PHYSICAL_GOLD
Opened **06:07:41** → Completed **06:58:34** · total **50.9m** · opened by Umar Farooq (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:07:41 | 06:08:57 | 1.3m | Umar Farooq (BRANCH) |
| Quotation approval | 06:08:57 | 06:39:00 | 30.0m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:29:56 | 06:29:56 | — | Inchara R (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:35:52 | 06:35:52 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:36:16 | 06:36:16 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:36:16 | 06:52:34 | 16.3m | Umar Farooq (BRANCH) |
| Order | 06:52:34 | 06:58:34 | 6.0m | — |
| Completion | 06:52:34 | 06:58:34 | 6.0m | system |

### 39. WGKA-55511 · SURESH  PK · KL-KOTTAKKAL · RELEASED_GOLD
Opened **06:07:44** → Completed **10:25:56** · total **4.3h** · opened by Mohsin  Edakkandan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:07:44 | 08:51:11 | 2.7h | Mohsin  Edakkandan (BRANCH) |
| Quotation approval | 08:51:11 | 09:15:19 | 24.1m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:23:38 | 06:23:38 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:23:43 | 06:23:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:23:43 | 07:12:19 | 48.6m | Neslin A (ACCOUNTS) |
| Order | 07:12:19 | 10:25:57 | 3.2h | — |
| Completion | 07:12:19 | 10:25:56 | 3.2h | system |

### 40. WGKA-55515 · Bhama  D c · TC PALYA · PHYSICAL_GOLD
Opened **06:14:47** → Completed **07:39:46** · total **1.4h** · opened by Srinivas Kempanna (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:14:47 | 06:16:13 | 1.4m | Srinivas Kempanna (BRANCH) |
| Quotation approval | 06:16:13 | 07:30:35 | 1.2h | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:50:30 | 06:50:30 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 07:17:01 | 07:17:01 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:25:08 | 07:25:08 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:25:31 | 07:25:31 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:25:31 | 07:36:45 | 11.2m | Srinivas Kempanna (BRANCH) |
| Order | 07:36:45 | 07:39:46 | 3.0m | — |
| Completion | 07:36:45 | 07:39:46 | 3.0m | system |

### 41. WGKA-55517 · sebastian  ac · KL-THOPPUMPADY · PHYSICAL_GOLD
Opened **06:16:31** → Completed **06:51:23** · total **34.9m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:16:31 | 06:17:45 | 1.2m | Glen Joseph (BRANCH) |
| Quotation approval | 06:17:45 | 06:41:40 | 23.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:41:14 | 06:41:14 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:41:26 | 06:41:26 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:41:26 | 06:46:09 | 4.7m | Glen Joseph (BRANCH) |
| Order | 06:46:09 | 06:51:23 | 5.2m | — |
| Completion | 06:46:09 | 06:51:23 | 5.2m | system |

### 42. WGKA-55520 · Jayanthi  M · BANNERGHATTA · PHYSICAL_GOLD
Opened **06:19:09** → Completed **07:41:50** · total **1.4h** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:19:09 | 06:19:48 | 0.6m | Harshith V (BRANCH) |
| Quotation approval | 06:19:48 | 07:29:33 | 1.2h | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:28:50 | 07:28:50 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:29:15 | 07:29:15 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:29:15 | 07:37:47 | 8.5m | Harshith V (BRANCH) |
| Order | 07:37:47 | 07:41:50 | 4.0m | — |
| Completion | 07:37:47 | 07:41:50 | 4.0m | system |

### 43. WGKA-55521 · Sheela  Krishna · JAYANAGAR · PHYSICAL_GOLD
Opened **06:20:36** → Completed **07:23:05** · total **1.0h** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:20:36 | 06:21:21 | 0.7m | Preethi s (BRANCH) |
| Quotation approval | 06:21:21 | 06:43:03 | 21.7m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:40:50 | 06:40:50 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:12 | 06:42:12 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:24 | 06:42:24 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:42:24 | 07:10:56 | 28.5m | Preethi s (BRANCH) |
| Completion | 07:10:56 | 07:23:05 | 12.1m | system |

### 44. WGKA-55523 · Rajeev R · HASSAN · PHYSICAL_GOLD
Opened **06:22:59** → Completed **07:21:33** · total **58.6m** · opened by Pavan Kumar H C (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:22:59 | 06:23:31 | 0.5m | Pavan Kumar H C (BRANCH) |
| Quotation approval | 06:23:31 | 06:59:17 | 35.8m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:58:13 | 06:58:13 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:58:46 | 06:58:46 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:58:46 | 07:20:11 | 21.4m | Santhosha  Kumar B S (BRANCH) |
| Order | 07:20:11 | 07:21:33 | 1.4m | — |
| Completion | 07:20:11 | 07:21:33 | 1.4m | system |

### 45. WGKA-55524 · FRANCIS N L · KL-CHAVAKKAD · PHYSICAL_GOLD
Opened **06:23:33** → Completed **07:05:20** · total **41.8m** · opened by Shaji Varghese (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:23:33 | 06:24:48 | 1.2m | Shaji Varghese (BRANCH) |
| Quotation approval | 06:24:48 | 06:42:27 | 17.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:42:00 | 06:42:00 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:42:19 | 06:42:19 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:42:19 | 06:47:11 | 4.9m | Shaji Varghese (BRANCH) |
| Order | 06:47:11 | 07:05:20 | 18.2m | — |
| Completion | 06:47:11 | 07:05:20 | 18.2m | system |

### 46. WGKA-55527 · Aishwarya  K · HOSA ROAD · PHYSICAL_GOLD
Opened **06:25:56** → Completed **06:54:27** · total **28.5m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:25:56 | 06:26:11 | 0.2m | Hareesh  Naik (BRANCH) |
| Quotation approval | 06:26:11 | 06:46:59 | 20.8m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 06:41:32 | 06:41:32 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:44:54 | 06:44:54 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:45:06 | 06:45:06 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:45:06 | 06:51:00 | 5.9m | Praveen J (BRANCH) |
| Order | 06:51:00 | 06:54:27 | 3.5m | — |
| Completion | 06:51:00 | 06:54:27 | 3.5m | system |

### 47. WGKA-55528 · Anna JOHN · KL-EDAPPALLY · PHYSICAL_GOLD
Opened **06:26:20** → Completed **06:48:00** · total **21.7m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:26:20 | 06:26:52 | 0.5m | Anand M Menon (BRANCH) |
| Quotation approval | 06:26:52 | 06:41:29 | 14.6m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:39:42 | 06:39:42 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:41:20 | 06:41:20 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:41:25 | 06:41:25 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:41:25 | 06:43:11 | 1.8m | Anand M Menon (BRANCH) |
| Order | 06:43:11 | 06:48:00 | 4.8m | — |
| Completion | 06:43:11 | 06:48:00 | 4.8m | system |

### 48. WGKA-55529 · Arjun NA · SHIVAMOGGA · PHYSICAL_GOLD
Opened **06:27:12** → Completed **08:01:55** · total **1.6h** · opened by Varun S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:27:12 | 06:28:16 | 1.1m | Varun S (BRANCH) |
| Quotation approval | 06:28:16 | 07:46:18 | 1.3h | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:45:02 | 07:45:02 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:45:43 | 07:45:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:45:43 | 08:00:00 | 14.3m | Pooja K G (BRANCH) |
| Order | 08:00:00 | 08:01:55 | 1.9m | — |
| Completion | 08:00:00 | 08:01:55 | 1.9m | system |

### 49. WGKA-55532 · Rohini  K · KENGERI · PHYSICAL_GOLD
Opened **06:29:11** → Completed **07:05:31** · total **36.3m** · opened by Punith R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:29:11 | 06:29:37 | 0.4m | Punith R (BRANCH) |
| Quotation approval | 06:29:37 | 06:55:36 | 26.0m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 06:51:10 | 06:51:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:54:17 | 06:54:17 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:55:05 | 06:55:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:55:05 | 07:01:51 | 6.8m | Punith R (BRANCH) |
| Order | 07:01:51 | 07:05:31 | 3.7m | — |
| Completion | 07:01:51 | 07:05:31 | 3.7m | system |

### 50. WGKA-55533 · UNMESH RAJENDRAN · KL-KADAPPAKKADA · PHYSICAL_GOLD
Opened **06:30:02** → Completed **06:52:41** · total **22.6m** · opened by Renjith  V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:30:02 | 06:31:16 | 1.2m | Renjith  V (BRANCH) |
| Quotation approval | 06:31:16 | 06:47:54 | 16.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:46:42 | 06:46:42 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:46:48 | 06:46:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 06:46:49 | 06:46:49 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:47:44 | 06:47:44 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:47:44 | 06:51:04 | 3.3m | Renjith  V (BRANCH) |
| Order | 06:51:04 | 06:52:41 | 1.6m | — |
| Completion | 06:51:04 | 06:52:41 | 1.6m | system |

### 51. WGKA-55537 · Usha sanjeevi P · MATHIKERE · PHYSICAL_GOLD
Opened **06:33:05** → Completed **07:18:49** · total **45.7m** · opened by Harish M A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:33:05 | 06:35:07 | 2.0m | Harish M A (BRANCH) |
| Quotation approval | 06:35:07 | 07:08:44 | 33.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:07:58 | 07:07:58 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:08:08 | 07:08:08 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:08:08 | 07:16:09 | 8.0m | Harish M A (BRANCH) |
| Order | 07:16:09 | 07:18:49 | 2.7m | — |
| Completion | 07:16:09 | 07:18:49 | 2.7m | system |

### 52. WGKA-55540 · dileep kumar · KL-ADOOR · PHYSICAL_GOLD
Opened **06:34:34** → Completed **07:10:10** · total **35.6m** · opened by Jayan  C (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:34:34 | 06:35:20 | 0.8m | Jayan  C (BRANCH) |
| Quotation approval | 06:35:20 | 07:03:38 | 28.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:02:59 | 07:02:59 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:03:17 | 07:03:17 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:03:17 | 07:06:07 | 2.8m | Jayan  C (BRANCH) |
| Order | 07:06:07 | 07:10:10 | 4.1m | — |
| Completion | 07:06:07 | 07:10:10 | 4.1m | system |

### 53. WGKA-55543 · Sachin Kumar  Kumar · ADUGODI · PHYSICAL_GOLD
Opened **06:38:00** → Completed **07:09:32** · total **31.5m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:38:00 | 06:38:46 | 0.8m | Tejus A (BRANCH) |
| Quotation approval | 06:38:46 | 06:58:51 | 20.1m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:57:43 | 06:57:43 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 06:58:43 | 06:58:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:58:43 | 07:06:21 | 7.6m | Tejus A (BRANCH) |
| Order | 07:06:21 | 07:09:32 | 3.2m | — |
| Completion | 07:06:21 | 07:09:32 | 3.2m | system |

### 54. WGKA-55547 · Mohith S · K R PURAM · PHYSICAL_GOLD
Opened **06:38:45** → Completed **07:47:34** · total **1.1h** · opened by Sridhara MS (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:38:45 | 06:39:25 | 0.7m | Sridhara MS (BRANCH) |
| Quotation approval | 06:39:25 | 07:38:40 | 59.3m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 07:30:07 | 07:30:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:32:48 | 07:32:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:33:26 | 07:33:26 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:33:26 | 07:44:46 | 11.3m | Sridhara MS (BRANCH) |
| Order | 07:44:46 | 07:47:34 | 2.8m | — |
| Completion | 07:44:46 | 07:47:34 | 2.8m | system |

### 55. WGKA-55548 · Kalyan  Sri · TS-KUKATPALLY · PHYSICAL_GOLD
Opened **06:40:51** → Completed **07:19:41** · total **38.8m** · opened by Gaddala Paul  Dinakar (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:40:51 | 06:42:05 | 1.2m | Gaddala Paul  Dinakar (BRANCH) |
| Quotation approval | 06:42:05 | 07:09:51 | 27.8m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 07:00:18 | 07:00:18 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 07:03:58 | 07:03:58 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:08:41 | 07:08:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:09:27 | 07:09:27 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:09:27 | 07:16:35 | 7.1m | Gaddala Paul  Dinakar (BRANCH) |
| Order | 07:16:35 | 07:19:29 | 2.9m | — |
| Completion | 07:16:35 | 07:19:41 | 3.1m | system |

### 56. WGKA-55549 · Satya brata Behuria · HOSA ROAD · PHYSICAL_GOLD
Opened **06:41:48** → Completed **07:06:29** · total **24.7m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:41:48 | 06:42:52 | 1.1m | Hareesh  Naik (BRANCH) |
| Quotation approval | 06:42:52 | 06:58:26 | 15.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 06:56:17 | 06:56:17 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:56:44 | 06:56:44 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:56:44 | 07:02:44 | 6.0m | Praveen J (BRANCH) |
| Order | 07:02:44 | 07:06:29 | 3.8m | — |
| Completion | 07:02:44 | 07:06:29 | 3.8m | system |

### 57. WGKA-55551 · SIDHARTH SETHU · KL-CALICUT · PHYSICAL_GOLD
Opened **06:45:32** → Completed **07:00:21** · total **14.8m** · opened by Urmila P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:45:32 | 06:46:01 | 0.5m | Urmila P (BRANCH) |
| Quotation approval | 06:46:01 | 06:55:07 | 9.1m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:54:38 | 06:54:38 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 06:54:54 | 06:54:54 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:54:54 | 06:58:40 | 3.8m | Urmila P (BRANCH) |
| Order | 06:58:40 | 07:00:21 | 1.7m | — |
| Completion | 06:58:40 | 07:00:21 | 1.7m | system |

### 58. WGKA-55553 · Gangadhar  G · YELAHANKA · PHYSICAL_GOLD
Opened **06:47:33** → Completed **07:43:24** · total **55.9m** · opened by Bhavanising  Ramachandra Rajaput (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:47:33 | 06:47:53 | 0.3m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| Quotation approval | 06:47:53 | 07:25:32 | 37.6m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:01:04 | 07:01:04 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:02:23 | 07:02:23 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:02:23 | 07:41:19 | 38.9m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| Order | 07:41:19 | 07:43:24 | 2.1m | — |
| Completion | 07:41:19 | 07:43:24 | 2.1m | system |

### 59. WGKA-55554 · Linto GEORGE · KL-VENNALA-BY-PASS · PHYSICAL_GOLD
Opened **06:49:04** → Completed **07:04:24** · total **15.3m** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:49:04 | 06:49:14 | 0.2m | Arun Kumar P K (BRANCH) |
| Quotation approval | 06:49:14 | 07:00:19 | 11.1m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 06:52:47 | 06:52:47 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 06:54:43 | 06:54:43 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 06:54:43 | 07:02:38 | 7.9m | Arun Kumar P K (BRANCH) |
| Order | 07:02:38 | 07:04:24 | 1.8m | — |
| Completion | 07:02:38 | 07:04:24 | 1.8m | system |

### 60. WGKA-55557 · Rituparna Chakraborty · WHITE FIELD · PHYSICAL_GOLD
Opened **06:50:58** → Completed **07:25:53** · total **34.9m** · opened by Devaraju M (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:50:58 | 06:52:53 | 1.9m | Devaraju M (BRANCH) |
| Quotation approval | 06:52:53 | 07:10:22 | 17.5m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:06:40 | 07:06:40 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:08:48 | 07:08:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:08:48 | 07:22:16 | 13.5m | Devaraju M (BRANCH) |
| Order | 07:22:16 | 07:25:53 | 3.6m | — |
| Completion | 07:22:16 | 07:25:53 | 3.6m | system |

### 61. WGKA-55558 · Madhusudhan H · JALAHALLI · PHYSICAL_GOLD
Opened **06:55:12** → Completed **08:10:20** · total **1.3h** · opened by Madhusudhan P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:55:12 | 06:56:25 | 1.2m | Madhusudhan P (BRANCH) |
| Quotation approval | 06:56:25 | 07:52:57 | 56.5m | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 07:16:50 | 07:16:50 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 07:20:10 | 07:20:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:30:35 | 07:30:35 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:30:49 | 07:30:49 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:30:49 | 08:03:20 | 32.5m | Madhusudhan P (BRANCH) |
| Order | 08:03:20 | 08:10:20 | 7.0m | — |
| Completion | 08:03:20 | 08:10:20 | 7.0m | system |

### 62. WGKA-55559 · Nagaveni r rao Rao · HUBLI · RELEASED_GOLD
Opened **06:55:30** → Completed **09:48:33** · total **2.9h** · opened by Seema Savanur (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:55:30 | 08:58:54 | 2.1h | Seema Savanur (BRANCH) |
| Quotation approval | 08:58:54 | 09:11:08 | 12.2m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:24:13 | 07:24:13 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:24:26 | 07:24:26 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:24:26 | 08:12:47 | 48.3m | Augustine T (ACCOUNTS) |
| Order | 08:12:47 | 09:48:33 | 1.6h | — |
| Completion | 08:12:47 | 09:48:33 | 1.6h | system |

### 63. WGKA-55560 · Irfan jes Abishek a · TC PALYA · PHYSICAL_GOLD
Opened **06:56:08** → Completed **08:19:26** · total **1.4h** · opened by Srinivas Kempanna (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:56:08 | 06:57:09 | 1.0m | Srinivas Kempanna (BRANCH) |
| Quotation approval | 06:57:09 | 08:08:59 | 1.2h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 07:26:39 | 07:26:39 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:04:12 | 08:04:12 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:08:35 | 08:08:35 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:08:35 | 08:13:42 | 5.1m | Srinivas Kempanna (BRANCH) |
| Order | 08:13:42 | 08:19:26 | 5.7m | — |
| Completion | 08:13:42 | 08:19:26 | 5.7m | system |

### 64. WGKA-55561 · binu DELENA · KL-THOPPUMPADY · PHYSICAL_GOLD
Opened **06:56:34** → Completed **07:52:37** · total **56.1m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:56:34 | 06:57:07 | 0.5m | Glen Joseph (BRANCH) |
| Quotation approval | 06:57:07 | 07:40:09 | 43.0m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:38:41 | 07:38:41 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:39:46 | 07:39:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:39:46 | 07:45:39 | 5.9m | Glen Joseph (BRANCH) |
| Order | 07:45:39 | 07:52:37 | 7.0m | — |
| Completion | 07:45:39 | 07:52:37 | 7.0m | system |

### 65. WGKA-55563 · Mahanthesh N · CHITRADURGA · PHYSICAL_GOLD
Opened **06:57:25** → Completed **08:32:15** · total **1.6h** · opened by Honnuramma E (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:57:25 | 06:58:32 | 1.1m | Honnuramma E (BRANCH) |
| Quotation approval | 06:58:32 | 08:19:42 | 1.4h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:09:47 | 08:09:47 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:15:39 | 08:15:39 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:18:52 | 08:18:52 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:18:52 | 08:24:01 | 5.2m | Honnuramma E (BRANCH) |
| Order | 08:24:01 | 08:32:15 | 8.2m | — |
| Completion | 08:24:01 | 08:32:15 | 8.2m | system |

### 66. WGKA-55565 · Manjunath g  P · BOMMANAHALLI · PHYSICAL_GOLD
Opened **06:58:09** → Completed **08:03:47** · total **1.1h** · opened by Mallikarjun Dalavi (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:58:09 | 06:59:17 | 1.1m | Mallikarjun Dalavi (BRANCH) |
| Quotation approval | 06:59:17 | 07:23:48 | 24.5m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:22:44 | 07:22:44 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:23:00 | 07:23:00 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:23:00 | 07:59:46 | 36.8m | Mallikarjun Dalavi (BRANCH) |
| Order | 07:59:46 | 08:03:47 | 4.0m | — |
| Completion | 07:59:46 | 08:03:47 | 4.0m | system |

### 67. WGKA-55566 · Krishna  Murthy · KAIKONDRAHALLI · PHYSICAL_GOLD
Opened **06:59:31** → Completed **07:49:06** · total **49.6m** · opened by Saibanna . (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 06:59:31 | 07:00:30 | 1.0m | Saibanna . (BRANCH) |
| Quotation approval | 07:00:30 | 07:31:28 | 31.0m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:29:41 | 07:29:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:31:21 | 07:31:21 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:31:21 | 07:41:04 | 9.7m | M Anthony Frank  Chinnappa (BRANCH) |
| Order | 07:41:04 | 07:49:06 | 8.0m | — |
| Completion | 07:41:04 | 07:49:06 | 8.0m | system |

### 68. WGKA-55569 · shamjith AK · KL-THIRUVANANTHAPURAM MGROAD · RELEASED_GOLD
Opened **07:02:23** → Completed **10:49:04** · total **3.8h** · opened by Sajith M V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:02:23 | 09:30:56 | 2.5h | Sajith M V (BRANCH) |
| Quotation approval | 09:30:56 | 09:36:08 | 5.2m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:24:45 | 07:24:45 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:24:57 | 07:24:57 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:24:57 | 08:32:49 | 1.1h | Sudarshan  B L (ACCOUNTS) |
| Order | 08:32:49 | 10:49:04 | 2.3h | — |
| Completion | 08:32:49 | 10:49:04 | 2.3h | system |

### 69. WGKA-55570 · Rahul K · TS-PANJAGUTTA · PHYSICAL_GOLD
Opened **07:03:26** → Completed **08:47:32** · total **1.7h** · opened by Ramidi Srikanth  Reddy (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:03:26 | 07:04:18 | 0.9m | Ramidi Srikanth  Reddy (BRANCH) |
| Quotation approval | 07:04:18 | 08:21:25 | 1.3h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:16:00 | 08:16:00 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:20:49 | 08:20:49 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:21:05 | 08:21:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:21:05 | 08:40:46 | 19.7m | accounts / branch |
| Completion | 08:40:46 | 08:47:32 | 6.8m | system |

### 70. WGKA-55573 · Linda EDNA ABY GEORGE · KL-KESHAVADASAPURAM · PHYSICAL_GOLD
Opened **07:05:11** → Completed **07:40:33** · total **35.4m** · opened by Jinu Chandran  B S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:05:11 | 07:06:50 | 1.6m | Jinu Chandran  B S (BRANCH) |
| Quotation approval | 07:06:50 | 07:36:24 | 29.6m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 07:15:18 | 07:15:18 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:19:21 | 07:19:21 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:19:21 | 07:38:16 | 18.9m | Jinu Chandran  B S (BRANCH) |
| Order | 07:38:16 | 07:40:33 | 2.3m | — |
| Completion | 07:38:16 | 07:40:33 | 2.3m | system |

### 71. WGKA-55574 · Ropali Nayak · BOMMANAHALLI · PHYSICAL_GOLD
Opened **07:05:57** → Completed **08:33:30** · total **1.5h** · opened by Mallikarjun Dalavi (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:05:57 | 07:06:22 | 0.4m | Mallikarjun Dalavi (BRANCH) |
| Quotation approval | 07:06:22 | 08:12:04 | 1.1h | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:11:33 | 08:11:33 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:11:57 | 08:11:57 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:11:57 | 08:31:36 | 19.6m | Mallikarjun Dalavi (BRANCH) |
| Order | 08:31:36 | 08:33:30 | 1.9m | — |
| Completion | 08:31:36 | 08:33:30 | 1.9m | system |

### 72. WGKA-55575 · Ganesh T A · DAVANAGERE · RELEASED_GOLD
Opened **07:06:16** → Completed **11:23:21** · total **4.3h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:06:16 | 11:02:46 | 3.9h | Venkatesh Naik (BRANCH) |
| Quotation approval | 11:02:46 | 11:14:18 | 11.5m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 07:26:41 | 07:26:41 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:57:44 | 07:57:44 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:58:48 | 07:58:48 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:58:48 | 08:55:44 | 56.9m | Harish  K (ACCOUNTS) |
| Order | 08:55:44 | 11:23:21 | 2.5h | — |
| Completion | 08:55:44 | 11:23:21 | 2.5h | system |

### 73. WGKA-55578 · SYAMALA N · KL-CHAVAKKAD · RELEASED_GOLD
Opened **07:09:17** → Completed **10:45:00** · total **3.6h** · opened by Shaji Varghese (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:09:17 | 08:41:57 | 1.5h | Shaji Varghese (BRANCH) |
| Quotation approval | 08:41:57 | 09:07:07 | 25.2m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:33:59 | 07:33:59 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:35:50 | 07:35:50 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:35:50 | 08:12:29 | 36.7m | Abin Antony (BRANCH) |
| Order | 08:12:29 | 10:45:00 | 2.5h | — |
| Completion | 08:12:29 | 10:45:00 | 2.5h | system |

### 74. WGKA-55580 · Yogesh C · UDUPI · PHYSICAL_GOLD
Opened **07:12:23** → Completed **08:05:46** · total **53.4m** · opened by Shailesh M Palan (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:12:23 | 07:13:27 | 1.1m | Shailesh M Palan (BRANCH) |
| Quotation approval | 07:13:27 | 07:56:24 | 43.0m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 07:48:43 | 07:48:43 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:55:05 | 07:55:05 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:56:13 | 07:56:13 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:56:13 | 08:03:28 | 7.3m | Shailesh M Palan (BRANCH) |
| Order | 08:03:28 | 08:05:35 | 2.1m | — |
| Completion | 08:03:28 | 08:05:46 | 2.3m | system |

### 75. WGKA-55585 · Nagaraja N · LINGARAJPURAM · PHYSICAL_GOLD
Opened **07:15:31** → Completed **08:41:32** · total **1.4h** · opened by Umar Farooq (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:15:31 | 07:16:18 | 0.8m | Umar Farooq (BRANCH) |
| Quotation approval | 07:16:18 | 08:12:44 | 56.4m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:01:37 | 08:01:37 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:12:29 | 08:12:29 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 08:12:36 | 08:12:36 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:12:36 | 08:19:50 | 7.2m | Umar Farooq (BRANCH) |
| Order | 08:19:50 | 08:41:32 | 21.7m | — |
| Completion | 08:19:50 | 08:41:32 | 21.7m | system |

### 76. WGKA-55586 · Raghuneer N · SUNKADAKATTE · PHYSICAL_GOLD
Opened **07:19:05** → Completed **08:36:41** · total **1.3h** · opened by Yathish N (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:19:05 | 07:19:22 | 0.3m | Yathish N (BRANCH) |
| Quotation approval | 07:19:22 | 08:09:54 | 50.5m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:09:00 | 08:09:00 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:09:41 | 08:09:41 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:09:41 | 08:34:56 | 25.3m | Yathish N (BRANCH) |
| Order | 08:34:56 | 08:36:41 | 1.7m | — |
| Completion | 08:34:56 | 08:36:41 | 1.7m | system |

### 77. WGKA-55587 · VIVEK VINCENT · KL-KALPETTA · PHYSICAL_GOLD
Opened **07:19:18** → Completed **07:48:15** · total **28.9m** · opened by ANEESH  A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:19:18 | 07:19:57 | 0.6m | ANEESH  A (BRANCH) |
| Quotation approval | 07:19:57 | 07:39:41 | 19.7m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:32:42 | 07:32:42 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:33:04 | 07:33:04 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:33:04 | 07:42:45 | 9.7m | ANEESH  A (BRANCH) |
| Order | 07:42:45 | 07:48:15 | 5.5m | — |
| Completion | 07:42:45 | 07:48:15 | 5.5m | system |

### 78. WGKA-55588 · Srinivas K · MALLESHWARAM · PHYSICAL_GOLD
Opened **07:19:51** → Completed **08:26:21** · total **1.1h** · opened by Madhan Kumar G G (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:19:51 | 07:20:40 | 0.8m | Madhan Kumar G G (BRANCH) |
| Quotation approval | 07:20:40 | 08:08:59 | 48.3m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 07:41:33 | 07:41:33 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:06:34 | 08:06:34 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:08:27 | 08:08:27 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:08:27 | 08:21:52 | 13.4m | Madhan Kumar G G (BRANCH) |
| Order | 08:21:52 | 08:26:21 | 4.5m | — |
| Completion | 08:21:52 | 08:26:21 | 4.5m | system |

### 79. WGKA-55590 · Prabhakara S · ADUGODI · PHYSICAL_GOLD
Opened **07:21:40** → Completed **08:04:13** · total **42.6m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:21:40 | 07:22:13 | 0.6m | Tejus A (BRANCH) |
| Quotation approval | 07:22:13 | 07:56:13 | 34.0m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:55:39 | 07:55:39 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:56:05 | 07:56:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:56:05 | 07:59:35 | 3.5m | Tejus A (BRANCH) |
| Completion | 07:59:35 | 08:04:13 | 4.6m | system |

### 80. WGKA-55591 · Asif A · THANISANDRA · PHYSICAL_GOLD
Opened **07:22:12** → Completed **09:06:52** · total **1.7h** · opened by Sushmitha H T (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:22:12 | 07:22:48 | 0.6m | Sushmitha H T (BRANCH) |
| Quotation approval | 07:22:48 | 08:39:02 | 1.3h | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 08:33:23 | 08:33:23 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:35:55 | 08:35:55 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:38:08 | 08:38:08 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:38:08 | 09:03:52 | 25.7m | Sushmitha H T (BRANCH) |
| Order | 09:03:52 | 09:06:52 | 3.0m | — |
| Completion | 09:03:52 | 09:06:52 | 3.0m | system |

### 81. WGKA-55592 · Ganesh SV · KENGERI · PHYSICAL_GOLD
Opened **07:22:14** → Completed **08:09:23** · total **47.2m** · opened by Punith R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:22:14 | 07:22:40 | 0.4m | Punith R (BRANCH) |
| Quotation approval | 07:22:40 | 07:56:05 | 33.4m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 07:50:11 | 07:50:11 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 07:55:55 | 07:55:55 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:55:55 | 08:05:12 | 9.3m | Punith R (BRANCH) |
| Order | 08:05:12 | 08:09:23 | 4.2m | — |
| Completion | 08:05:12 | 08:09:23 | 4.2m | system |

### 82. WGKA-55593 · Lakshmana K · YELAHANKA · PHYSICAL_GOLD
Opened **07:22:33** → Completed **10:26:30** · total **3.1h** · opened by Bhavanising  Ramachandra Rajaput (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:22:33 | 07:24:59 | 2.4m | Bhavanising  Ramachandra Rajaput (BRANCH) |
| Quotation approval | 07:24:59 | 09:08:47 | 1.7h | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:07:05 | 09:07:05 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:07:09 | 09:07:09 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:07:09 | 10:19:09 | 1.2h | accounts / branch |
| Completion | 10:19:09 | 10:26:30 | 7.4m | system |

### 83. WGKA-55596 · Mounesh B · HOSPETE · PHYSICAL_GOLD
Opened **07:27:54** → Completed **08:30:08** · total **1.0h** · opened by Sangeetha J (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:27:54 | 07:29:22 | 1.5m | Sangeetha J (BRANCH) |
| Quotation approval | 07:29:22 | 08:15:15 | 45.9m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:04:32 | 08:04:32 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 08:08:32 | 08:08:32 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:12:37 | 08:12:37 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:14:51 | 08:14:51 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:14:51 | 08:22:51 | 8.0m | Sangeetha J (BRANCH) |
| Order | 08:22:51 | 08:30:08 | 7.3m | — |
| Completion | 08:22:51 | 08:30:08 | 7.3m | system |

### 84. WGKA-55597 · Jayanth S · KATRIGUPPE · RELEASED_GOLD
Opened **07:29:50** → Completed **10:49:49** · total **3.3h** · opened by Manoj K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:29:50 | 09:31:46 | 2.0h | Manoj K (BRANCH) |
| Quotation approval | 09:31:46 | 10:11:46 | 40.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:42:42 | 07:42:42 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:42:50 | 07:42:50 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:42:50 | 08:23:19 | 40.5m | Sudarshan  B L (ACCOUNTS) |
| Order | 08:23:19 | 10:49:49 | 2.4h | — |
| Completion | 08:23:19 | 10:49:49 | 2.4h | system |

### 85. WGKA-55598 · RADHIKA RAMDAS KT · KL-CALICUT · PHYSICAL_GOLD
Opened **07:30:18** → Completed **07:46:06** · total **15.8m** · opened by Urmila P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:30:18 | 07:30:56 | 0.6m | Urmila P (BRANCH) |
| Quotation approval | 07:30:56 | 07:40:06 | 9.2m | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 07:39:42 | 07:39:42 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:39:50 | 07:39:50 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:39:50 | 07:42:32 | 2.7m | Urmila P (BRANCH) |
| Order | 07:42:32 | 07:46:06 | 3.6m | — |
| Completion | 07:42:32 | 07:46:06 | 3.6m | system |

### 86. WGKA-55601 · Ravi S · MYSURU · PHYSICAL_GOLD
Opened **07:38:46** → Completed **10:03:46** · total **2.4h** · opened by Leena K L (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:38:46 | 07:39:39 | 0.9m | Leena K L (BRANCH) |
| Quotation approval | 07:39:39 | 09:25:24 | 1.8h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:13:43 | 09:13:43 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:17:37 | 09:17:37 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:17:40 | 09:17:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:17:40 | 09:59:09 | 41.5m | accounts / branch |
| Completion | 09:59:09 | 10:03:46 | 4.6m | system |

### 87. WGKA-55603 · DEEPA  B · KL-OTTAPALAM · PHYSICAL_GOLD
Opened **07:40:15** → Completed **08:04:55** · total **24.7m** · opened by Roopesh  K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:40:15 | 07:41:16 | 1.0m | Roopesh  K (BRANCH) |
| Quotation approval | 07:41:16 | 07:56:33 | 15.3m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 07:55:10 | 07:55:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 07:55:46 | 07:55:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:55:46 | 08:00:07 | 4.3m | Roopesh  K (BRANCH) |
| Order | 08:00:07 | 08:04:55 | 4.8m | — |
| Completion | 08:00:07 | 08:04:55 | 4.8m | system |

### 88. WGKA-55607 · Dinesh A · BANNERGHATTA · PHYSICAL_GOLD
Opened **07:47:23** → Completed **08:29:52** · total **42.5m** · opened by Harshith V (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:47:23 | 07:48:06 | 0.7m | Harshith V (BRANCH) |
| Quotation approval | 07:48:06 | 08:15:21 | 27.3m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 08:14:31 | 08:14:31 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:14:42 | 08:14:42 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:14:42 | 08:25:03 | 10.4m | Neslin A (ACCOUNTS) |
| Order | 08:25:03 | 08:29:52 | 4.8m | — |
| Completion | 08:25:03 | 08:29:52 | 4.8m | system |

### 89. WGKA-55611 · ATHIRA A U A U · KL-KESHAVADASAPURAM · PHYSICAL_GOLD
Opened **07:51:03** → Completed **08:20:36** · total **29.5m** · opened by Jinu Chandran  B S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:51:03 | 07:51:40 | 0.6m | Jinu Chandran  B S (BRANCH) |
| Quotation approval | 07:51:40 | 08:08:53 | 17.2m | Sanathana K (OTHERS) |
| KYC · APPROVED | 07:57:06 | 07:57:06 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 07:57:10 | 07:57:10 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 07:57:10 | 08:13:15 | 16.1m | Jinu Chandran  B S (BRANCH) |
| Order | 08:13:15 | 08:20:36 | 7.3m | — |
| Completion | 08:13:15 | 08:20:36 | 7.3m | system |

### 90. WGKA-55612 · Nikhil  N · TUMKUR · PHYSICAL_GOLD
Opened **07:53:23** → Completed **09:26:20** · total **1.5h** · opened by Mohammed Pasha (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:53:23 | 07:53:35 | 0.2m | Mohammed Pasha (BRANCH) |
| Quotation approval | 07:53:35 | 08:55:12 | 1.0h | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:41:38 | 08:41:38 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:54:48 | 08:54:48 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:55:04 | 08:55:04 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:55:04 | 09:19:48 | 24.7m | Mohammed Pasha (BRANCH) |
| Completion | 09:19:48 | 09:26:20 | 6.5m | system |

### 91. WGKA-55613 · Chethan Kumar Rai · MANGALURU · PHYSICAL_GOLD
Opened **07:54:21** → Completed **11:04:54** · total **3.2h** · opened by Sowmya Devadiga (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:54:21 | 07:54:47 | 0.4m | Sowmya Devadiga (BRANCH) |
| Quotation approval | 07:54:47 | 10:24:12 | 2.5h | Chethan A N (OPERATIONS) |
| KYC · APPROVED | 10:23:51 | 10:23:51 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:24:02 | 10:24:02 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:24:02 | 10:59:21 | 35.3m | accounts / branch |
| Completion | 10:59:21 | 11:04:54 | 5.6m | system |

### 92. WGKA-55615 · JOHN KM · KL-THIRUVALLA · PHYSICAL_GOLD
Opened **07:55:42** → Completed **08:29:03** · total **33.3m** · opened by Arun  Kumar M S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:55:42 | 07:56:52 | 1.2m | Arun  Kumar M S (BRANCH) |
| Quotation approval | 07:56:52 | 08:21:22 | 24.5m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:19:46 | 08:19:46 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:20:56 | 08:20:56 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:20:56 | 08:26:01 | 5.1m | Arun  Kumar M S (BRANCH) |
| Order | 08:26:01 | 08:29:03 | 3.0m | — |
| Completion | 08:26:01 | 08:29:03 | 3.0m | system |

### 93. WGKA-55616 · HEMA  SUNU · KL-THOPPUMPADY · PHYSICAL_GOLD
Opened **07:56:32** → Completed **08:24:04** · total **27.5m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:56:32 | 07:56:43 | 0.2m | Glen Joseph (BRANCH) |
| Quotation approval | 07:56:43 | 08:12:00 | 15.3m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 08:10:08 | 08:10:08 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:11:46 | 08:11:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:11:46 | 08:21:24 | 9.6m | Glen Joseph (BRANCH) |
| Order | 08:21:24 | 08:24:04 | 2.7m | — |
| Completion | 08:21:24 | 08:24:04 | 2.7m | system |

### 94. WGKA-55618 · USHA JAYADEVAN · KL-THRISSUR · PHYSICAL_GOLD
Opened **07:59:43** → Completed **08:27:18** · total **27.6m** · opened by Ciljan George (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 07:59:43 | 07:59:56 | 0.2m | Ciljan George (BRANCH) |
| Quotation approval | 07:59:56 | 08:12:19 | 12.4m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 08:11:13 | 08:11:13 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 08:11:40 | 08:11:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:11:40 | 08:23:29 | 11.8m | Neslin A (ACCOUNTS) |
| Order | 08:23:29 | 08:27:18 | 3.8m | — |
| Completion | 08:23:29 | 08:27:18 | 3.8m | system |

### 95. WGKA-55619 · BIJOY HARIDAS · KL-EDAPPALLY · PHYSICAL_GOLD
Opened **08:08:06** → Completed **08:28:51** · total **20.8m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:08:06 | 08:08:30 | 0.4m | Anand M Menon (BRANCH) |
| Quotation approval | 08:08:30 | 08:25:49 | 17.3m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 08:18:38 | 08:18:38 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:18:45 | 08:18:45 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:18:45 | 08:27:04 | 8.3m | Anand M Menon (BRANCH) |
| Order | 08:27:04 | 08:28:51 | 1.8m | — |
| Completion | 08:27:04 | 08:28:51 | 1.8m | system |

### 96. WGKA-55623 · vasanth Kumar  K E · JALAHALLI · PHYSICAL_GOLD
Opened **08:14:56** → Completed **09:27:18** · total **1.2h** · opened by Madhusudhan P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:14:56 | 08:16:03 | 1.1m | Madhusudhan P (BRANCH) |
| Quotation approval | 08:16:03 | 09:13:18 | 57.2m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:04:24 | 09:04:24 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · REQUESTED | 09:10:08 | 09:10:08 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:12:52 | 09:12:52 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:13:04 | 09:13:04 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:13:04 | 09:25:53 | 12.8m | Madhusudhan P (BRANCH) |
| Order | 09:25:53 | 09:27:18 | 1.4m | — |
| Completion | 09:25:53 | 09:27:18 | 1.4m | system |

### 97. WGKA-55625 · Abiswetha S · HOSA ROAD · PHYSICAL_GOLD
Opened **08:18:11** → Completed **08:44:32** · total **26.3m** · opened by Hareesh  Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:18:11 | 08:18:40 | 0.5m | Hareesh  Naik (BRANCH) |
| Quotation approval | 08:18:40 | 08:34:56 | 16.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:30:44 | 08:30:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:33:05 | 08:33:05 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:33:05 | 08:39:51 | 6.8m | Praveen J (BRANCH) |
| Order | 08:39:51 | 08:44:32 | 4.7m | — |
| Completion | 08:39:51 | 08:44:32 | 4.7m | system |

### 98. WGKA-55626 · Balraj Balraj · TS-KUKATPALLY · PHYSICAL_GOLD
Opened **08:18:59** → Completed **10:25:53** · total **2.1h** · opened by Gaddala Paul  Dinakar (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:18:59 | 08:22:43 | 3.7m | Gaddala Paul  Dinakar (BRANCH) |
| Quotation approval | 08:22:43 | 10:00:34 | 1.6h | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 09:08:10 | 09:08:10 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 09:20:38 | 09:20:38 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 09:56:07 | 09:56:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:59:05 | 09:59:05 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:00:20 | 10:00:20 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:00:20 | 10:19:04 | 18.7m | accounts / branch |
| Completion | 10:19:04 | 10:25:53 | 6.8m | system |

### 99. WGKA-55627 · Biswas Kumar · K R PURAM · PHYSICAL_GOLD
Opened **08:19:32** → Completed **09:13:56** · total **54.4m** · opened by Sridhara MS (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:19:32 | 08:20:04 | 0.5m | Sridhara MS (BRANCH) |
| Quotation approval | 08:20:04 | 09:05:18 | 45.2m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 08:46:44 | 08:46:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 08:51:51 | 08:51:51 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · REQUESTED | 09:03:07 | 09:03:07 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:04:35 | 09:04:35 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:04:50 | 09:04:50 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:04:50 | 09:12:26 | 7.6m | Sridhara MS (BRANCH) |
| Order | 09:12:26 | 09:13:56 | 1.5m | — |
| Completion | 09:12:26 | 09:13:56 | 1.5m | system |

### 100. WGKA-55631 · MIDHUN JACOB · KL-THOPPUMPADY · PHYSICAL_GOLD
Opened **08:23:39** → Completed **09:13:32** · total **49.9m** · opened by Glen Joseph (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:23:39 | 08:24:48 | 1.2m | Glen Joseph (BRANCH) |
| Quotation approval | 08:24:48 | 09:08:04 | 43.3m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:07:43 | 09:07:43 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:07:52 | 09:07:52 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:07:56 | 09:07:56 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:07:56 | 09:11:15 | 3.3m | Glen Joseph (BRANCH) |
| Order | 09:11:15 | 09:13:32 | 2.3m | — |
| Completion | 09:11:15 | 09:13:32 | 2.3m | system |

### 101. WGKA-55632 · PRABHAKAR DVID KAUNDS · TUMKUR · PHYSICAL_GOLD
Opened **08:24:30** → Completed **09:40:12** · total **1.3h** · opened by Mohammed Pasha (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:24:30 | 08:25:56 | 1.4m | Mohammed Pasha (BRANCH) |
| Quotation approval | 08:25:56 | 09:14:51 | 48.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:12:33 | 09:12:33 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:13:12 | 09:13:12 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 09:13:14 | 09:13:14 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:13:14 | 09:37:07 | 23.9m | Mohammed Pasha (BRANCH) |
| Order | 09:37:07 | 09:40:12 | 3.1m | — |
| Completion | 09:37:07 | 09:40:12 | 3.1m | system |

### 102. WGKA-55634 · Arun  Krishna · THANISANDRA · PHYSICAL_GOLD
Opened **08:25:22** → Completed **09:32:21** · total **1.1h** · opened by Sushmitha H T (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:25:22 | 08:26:00 | 0.6m | Sushmitha H T (BRANCH) |
| Quotation approval | 08:26:00 | 09:25:22 | 59.4m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 09:23:28 | 09:23:28 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:23:46 | 09:23:46 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:23:46 | 09:30:38 | 6.9m | Sushmitha H T (BRANCH) |
| Order | 09:30:38 | 09:32:21 | 1.7m | — |
| Completion | 09:30:38 | 09:32:21 | 1.7m | system |

### 103. WGKA-55635 · Mahantesh M S · DAVANAGERE · RELEASED_GOLD
Opened **08:25:29** → Completed **10:36:23** · total **2.2h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:25:29 | 09:51:34 | 1.4h | Venkatesh Naik (BRANCH) |
| Quotation approval | 09:51:34 | 10:09:00 | 17.4m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 08:45:19 | 08:45:19 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:47:19 | 08:47:19 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:48:22 | 08:48:22 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:48:22 | 09:22:46 | 34.4m | Sudarshan  B L (ACCOUNTS) |
| Order | 09:22:46 | 10:36:23 | 1.2h | — |
| Completion | 09:22:46 | 10:36:23 | 1.2h | system |

### 104. WGKA-55636 · BHAVIKA RAJAN · KL-EDAPPALLY · PHYSICAL_GOLD
Opened **08:32:27** → Completed **09:05:54** · total **33.4m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:32:27 | 08:36:10 | 3.7m | Anand M Menon (BRANCH) |
| Quotation approval | 08:36:10 | 09:01:37 | 25.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 08:54:23 | 08:54:23 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 08:55:20 | 08:55:20 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 08:55:20 | 09:04:12 | 8.9m | Anand M Menon (BRANCH) |
| Order | 09:04:12 | 09:05:54 | 1.7m | — |
| Completion | 09:04:12 | 09:05:54 | 1.7m | system |

### 105. WGKA-55638 · Sevya  Naik · DAVANAGERE · PHYSICAL_GOLD
Opened **08:40:24** → Completed **09:48:27** · total **1.1h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:40:24 | 08:42:01 | 1.6m | Venkatesh Naik (BRANCH) |
| Quotation approval | 08:42:01 | 09:40:27 | 58.4m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:16:38 | 09:16:38 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:39:37 | 09:39:37 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:40:17 | 09:40:17 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 09:40:39 | 09:40:39 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:40:39 | 09:46:59 | 6.3m | Venkatesh Naik (BRANCH) |
| Order | 09:46:59 | 09:48:27 | 1.5m | — |
| Completion | 09:46:59 | 09:48:27 | 1.5m | system |

### 106. WGKA-55639 · Koushik K · LINGARAJPURAM · PHYSICAL_GOLD
Opened **08:41:23** → Completed **09:24:31** · total **43.1m** · opened by Umar Farooq (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:41:23 | 08:43:16 | 1.9m | Umar Farooq (BRANCH) |
| Quotation approval | 08:43:16 | 09:15:35 | 32.3m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:05:48 | 09:05:48 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:14:42 | 09:14:42 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:15:00 | 09:15:00 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:15:00 | 09:21:15 | 6.3m | Umar Farooq (BRANCH) |
| Order | 09:21:15 | 09:24:31 | 3.3m | — |
| Completion | 09:21:15 | 09:24:31 | 3.3m | system |

### 107. WGKA-55644 · Uday  Naik · BELAGAVI · PHYSICAL_GOLD
Opened **08:48:49** → Completed **09:56:27** · total **1.1h** · opened by Amit Gangadhar Harani (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:48:49 | 08:49:20 | 0.5m | Amit Gangadhar Harani (BRANCH) |
| Quotation approval | 08:49:20 | 09:49:09 | 59.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:39:24 | 09:39:24 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:43:25 | 09:43:25 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:47:40 | 09:47:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:47:40 | 09:54:08 | 6.5m | Amit Gangadhar Harani (BRANCH) |
| Order | 09:54:08 | 09:56:27 | 2.3m | — |
| Completion | 09:54:08 | 09:56:27 | 2.3m | system |

### 108. WGKA-55648 · MEENA S KUMAR · KL-KESHAVADASAPURAM · PHYSICAL_GOLD
Opened **08:53:26** → Completed **09:09:44** · total **16.3m** · opened by Jinu Chandran  B S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 08:53:26 | 08:54:05 | 0.6m | Jinu Chandran  B S (BRANCH) |
| Quotation approval | 08:54:05 | 09:05:51 | 11.8m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 09:02:53 | 09:02:53 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:05:31 | 09:05:31 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:05:31 | 09:08:09 | 2.6m | Jinu Chandran  B S (BRANCH) |
| Order | 09:08:09 | 09:09:44 | 1.6m | — |
| Completion | 09:08:09 | 09:09:44 | 1.6m | system |

### 109. WGKA-55654 · PRASANTH  KUMAR PP · KL-KANNUR · PHYSICAL_GOLD
Opened **09:02:24** → Completed **09:18:21** · total **16.0m** · opened by Juwel  Davis (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:02:24 | 09:02:41 | 0.3m | Juwel  Davis (BRANCH) |
| Quotation approval | 09:02:41 | 09:13:01 | 10.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:12:09 | 09:12:09 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:12:54 | 09:12:54 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:12:54 | 09:16:06 | 3.2m | Juwel  Davis (BRANCH) |
| Order | 09:16:06 | 09:18:21 | 2.3m | — |
| Completion | 09:16:06 | 09:18:21 | 2.3m | system |

### 110. WGKA-55655 · Nagaraju Lakkavarapu · TS-KUKATPALLY · PHYSICAL_GOLD
Opened **09:02:45** → Completed **09:50:42** · total **48.0m** · opened by Achannagari  Rakesh (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:02:45 | 09:11:01 | 8.3m | Achannagari  Rakesh (BRANCH) |
| Quotation approval | 09:11:01 | 09:36:06 | 25.1m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:34:08 | 09:34:08 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:35:41 | 09:35:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:35:54 | 09:35:54 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:35:54 | 09:43:29 | 7.6m | Achannagari  Rakesh (BRANCH) |
| Order | 09:43:29 | 09:50:42 | 7.2m | — |
| Completion | 09:43:29 | 09:50:42 | 7.2m | system |

### 111. WGKA-55656 · Thippeswamy V k · DAVANAGERE · PHYSICAL_GOLD
Opened **09:03:30** → Completed **10:21:30** · total **1.3h** · opened by Venkatesh Naik (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:03:30 | 09:03:59 | 0.5m | Venkatesh Naik (BRANCH) |
| Quotation approval | 09:03:59 | 09:16:52 | 12.9m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:16:22 | 09:16:22 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:16:39 | 09:16:39 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:16:39 | 10:17:03 | 1.0h | Venkatesh Naik (BRANCH) |
| Order | 10:17:03 | 10:21:30 | 4.5m | — |
| Completion | 10:17:03 | 10:21:30 | 4.5m | system |

### 112. WGKA-55663 · Sanjay Kumar · HASSAN · PHYSICAL_GOLD
Opened **09:08:52** → Completed **10:02:45** · total **53.9m** · opened by Nuthan D S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:08:52 | 09:09:16 | 0.4m | Nuthan D S (BRANCH) |
| Quotation approval | 09:09:16 | 09:54:43 | 45.4m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 09:48:11 | 09:48:11 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:51:49 | 09:51:49 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:53:05 | 09:53:05 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:53:05 | 10:00:53 | 7.8m | Nuthan D S (BRANCH) |
| Order | 10:00:53 | 10:02:45 | 1.9m | — |
| Completion | 10:00:53 | 10:02:45 | 1.9m | system |

### 113. WGKA-55668 · Appannanaika  Naik · HOSPETE · PHYSICAL_GOLD
Opened **09:19:04** → Completed **11:07:37** · total **1.8h** · opened by Sangeetha J (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:19:04 | 09:21:12 | 2.1m | Sangeetha J (BRANCH) |
| Quotation approval | 09:21:12 | 10:54:50 | 1.6h | Chethan A N (OPERATIONS) |
| KYC · REQUESTED | 10:46:25 | 10:46:25 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:51:18 | 10:51:18 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:53:44 | 10:53:44 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:53:44 | 11:00:43 | 7.0m | Sangeetha J (BRANCH) |
| Order | 11:00:43 | 11:07:37 | 6.9m | — |
| Completion | 11:00:43 | 11:07:37 | 6.9m | system |

### 114. WGKA-55669 · Rajesh Kumar · KOLAR · PHYSICAL_GOLD
Opened **09:19:24** → Completed **10:44:32** · total **1.4h** · opened by Harish K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:19:24 | 09:20:57 | 1.5m | Harish K (BRANCH) |
| Quotation approval | 09:20:57 | 10:22:24 | 1.0h | Vinay M (OPERATIONS) |
| KYC · APPROVED | 10:21:37 | 10:21:37 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:22:05 | 10:22:05 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:22:05 | 10:32:39 | 10.6m | accounts / branch |
| Completion | 10:32:39 | 10:44:32 | 11.9m | system |

### 115. WGKA-55670 · Saran  Kumar · TC PALYA · PHYSICAL_GOLD
Opened **09:20:43** → Completed **09:45:22** · total **24.7m** · opened by Srinivas Kempanna (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:20:43 | 09:21:35 | 0.9m | Srinivas Kempanna (BRANCH) |
| Quotation approval | 09:21:35 | 09:38:19 | 16.7m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:37:22 | 09:37:22 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:37:40 | 09:37:40 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:37:40 | 09:43:41 | 6.0m | Srinivas Kempanna (BRANCH) |
| Order | 09:43:41 | 09:45:22 | 1.7m | — |
| Completion | 09:43:41 | 09:45:22 | 1.7m | system |

### 116. WGKA-55673 · Ajay Krishna · BASAWESHWARANAGAR · PHYSICAL_GOLD
Opened **09:23:04** → Completed **10:02:51** · total **39.8m** · opened by Yashas Gowda H R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:23:04 | 09:24:45 | 1.7m | Yashas Gowda H R (BRANCH) |
| Quotation approval | 09:24:45 | 09:57:26 | 32.7m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 09:36:48 | 09:36:48 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 09:49:36 | 09:49:36 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · REQUESTED | 09:50:09 | 09:50:09 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 09:57:21 | 09:57:21 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:57:21 | 10:00:35 | 3.2m | Yashas Gowda H R (BRANCH) |
| Order | 10:00:35 | 10:02:51 | 2.3m | — |
| Completion | 10:00:35 | 10:02:51 | 2.3m | system |

### 117. WGKA-55676 · VIJAYABALAKRISHNAN S · KL-VARKALA · PHYSICAL_GOLD
Opened **09:26:42** → Completed **10:15:27** · total **48.8m** · opened by Sona S Kumar (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:26:42 | 09:27:14 | 0.5m | Sona S Kumar (BRANCH) |
| Quotation approval | 09:27:14 | 09:38:16 | 11.0m | Sanathana K (OTHERS) |
| KYC · APPROVED | 09:38:02 | 09:38:02 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:38:04 | 09:38:04 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 09:38:08 | 09:38:08 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:38:08 | 10:08:09 | 30.0m | Sona S Kumar (BRANCH) |
| Order | 10:08:09 | 10:15:27 | 7.3m | — |
| Completion | 10:08:09 | 10:15:27 | 7.3m | system |

### 118. WGKA-55678 · AISHA PRAVEEN VF · KL-VENNALA-BY-PASS · PHYSICAL_GOLD
Opened **09:32:07** → Completed **09:43:55** · total **11.8m** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:32:07 | 09:32:14 | 0.1m | Arun Kumar P K (BRANCH) |
| Quotation approval | 09:32:14 | 09:39:43 | 7.5m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 09:37:17 | 09:37:17 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:37:32 | 09:37:32 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:37:32 | 09:42:29 | 4.9m | Arun Kumar P K (BRANCH) |
| Order | 09:42:29 | 09:43:55 | 1.4m | — |
| Completion | 09:42:29 | 09:43:55 | 1.4m | system |

### 119. WGKA-55679 · Heena Houser · CHIKMAGALURU · PHYSICAL_GOLD
Opened **09:35:24** → Completed **10:49:04** · total **1.2h** · opened by Joyalin Seravo (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:35:24 | 09:36:21 | 1.0m | Joyalin Seravo (BRANCH) |
| Quotation approval | 09:36:21 | 09:53:10 | 16.8m | Vinay M (OPERATIONS) |
| KYC · REQUESTED | 09:50:03 | 09:50:03 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:52:35 | 09:52:35 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 09:52:51 | 09:52:51 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 09:52:51 | 10:02:33 | 9.7m | accounts / branch |
| Completion | 10:02:33 | 10:49:04 | 46.5m | system |

### 120. WGKA-55680 · NAJEEB S · KL-EDAPPALLY · PHYSICAL_GOLD
Opened **09:36:39** → Completed **10:31:40** · total **55.0m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:36:39 | 09:36:46 | 0.1m | Anand M Menon (BRANCH) |
| Quotation approval | 09:36:46 | 10:28:06 | 51.3m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 10:25:21 | 10:25:21 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:27:57 | 10:27:57 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:27:57 | 10:30:10 | 2.2m | Anand M Menon (BRANCH) |
| Order | 10:30:10 | 10:31:40 | 1.5m | — |
| Completion | 10:30:10 | 10:31:40 | 1.5m | system |

### 121. WGKA-55682 · Divya  V · AP-GAJUWAKA · PHYSICAL_GOLD
Opened **09:40:25** → Completed **11:12:24** · total **1.5h** · opened by Siripuram Srinivasa Rao (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:40:25 | 09:42:01 | 1.6m | Siripuram Srinivasa Rao (BRANCH) |
| Quotation approval | 09:42:01 | 10:29:12 | 47.2m | Nagendra Prasad D (OPERATIONS) |
| KYC · REQUESTED | 10:17:42 | 10:17:42 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:28:44 | 10:28:44 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:28:53 | 10:28:53 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:28:53 | 11:03:17 | 34.4m | Siripuram Srinivasa Rao (BRANCH) |
| Order | 11:03:17 | 11:12:24 | 9.1m | — |
| Completion | 11:03:17 | 11:12:24 | 9.1m | system |

### 122. WGKA-55685 · Zaiba Kousafar · ADUGODI · PHYSICAL_GOLD
Opened **09:52:56** → Completed **10:19:43** · total **26.8m** · opened by Tejus A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:52:56 | 09:54:06 | 1.2m | Tejus A (BRANCH) |
| Quotation approval | 09:54:06 | 10:09:37 | 15.5m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 10:07:05 | 10:07:05 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:08:30 | 10:08:30 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:09:27 | 10:09:27 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:09:27 | 10:16:52 | 7.4m | Tejus A (BRANCH) |
| Order | 10:16:52 | 10:19:43 | 2.8m | — |
| Completion | 10:16:52 | 10:19:43 | 2.8m | system |

### 123. WGKA-55687 · Roshan  S · JAYANAGAR · PHYSICAL_GOLD
Opened **09:53:29** → Completed **10:21:39** · total **28.2m** · opened by Preethi s (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:53:29 | 09:54:21 | 0.9m | Preethi s (BRANCH) |
| Quotation approval | 09:54:21 | 10:14:11 | 19.8m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 10:13:14 | 10:13:14 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:13:23 | 10:13:23 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:13:23 | 10:20:02 | 6.7m | Preethi s (BRANCH) |
| Order | 10:20:02 | 10:21:39 | 1.6m | — |
| Completion | 10:20:02 | 10:21:39 | 1.6m | system |

### 124. WGKA-55688 · NISHAND N B · KL-EDAPPALLY · PHYSICAL_GOLD
Opened **09:54:55** → Completed **10:08:50** · total **13.9m** · opened by Anand M Menon (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 09:54:55 | 09:55:19 | 0.4m | Anand M Menon (BRANCH) |
| Quotation approval | 09:55:19 | 10:03:53 | 8.6m | Sanathana K (OTHERS) |
| KYC · APPROVED | 10:02:44 | 10:02:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:02:52 | 10:02:52 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| KYC · APPROVED | 10:03:03 | 10:03:03 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:03:03 | 10:07:12 | 4.1m | Anand M Menon (BRANCH) |
| Order | 10:07:12 | 10:08:50 | 1.6m | — |
| Completion | 10:07:12 | 10:08:50 | 1.6m | system |

### 125. WGKA-55691 · Madhubani krishnappa K · MARATHAHALLI · PHYSICAL_GOLD
Opened **10:03:40** → Completed **11:15:19** · total **1.2h** · opened by Sunil Javali (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 10:03:40 | 10:04:52 | 1.2m | Sunil Javali (BRANCH) |
| Quotation approval | 10:04:52 | 11:02:41 | 57.8m | Sanathana K (OTHERS) |
| KYC · REQUESTED | 10:38:32 | 10:38:32 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 11:01:45 | 11:01:45 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 11:02:34 | 11:02:34 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 11:02:34 | 11:13:01 | 10.5m | Sunil Javali (BRANCH) |
| Order | 11:13:01 | 11:15:19 | 2.3m | — |
| Completion | 11:13:01 | 11:15:19 | 2.3m | system |

### 126. WGKA-55693 · Aswin R · BOMMANAHALLI · PHYSICAL_GOLD
Opened **10:06:12** → Completed **10:47:34** · total **41.4m** · opened by Geetha S (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 10:06:12 | 10:07:02 | 0.8m | Geetha S (BRANCH) |
| Quotation approval | 10:07:02 | 10:31:25 | 24.4m | Vinay M (OPERATIONS) |
| KYC · APPROVED | 10:27:41 | 10:27:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:27:51 | 10:27:51 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:27:51 | 10:39:29 | 11.6m | Mallikarjun Dalavi (BRANCH) |
| Order | 10:39:29 | 10:47:34 | 8.1m | — |
| Completion | 10:39:29 | 10:47:34 | 8.1m | system |

### 127. WGKA-55698 · GREESHMA  PB · KL-CALICUT · PHYSICAL_GOLD
Opened **10:23:10** → Completed **10:41:28** · total **18.3m** · opened by Urmila P (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 10:23:10 | 10:23:54 | 0.7m | Urmila P (BRANCH) |
| Quotation approval | 10:23:54 | 10:37:21 | 13.4m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 10:36:54 | 10:36:54 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:36:57 | 10:36:57 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:36:59 | 10:36:59 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:36:59 | 10:39:40 | 2.7m | Urmila P (BRANCH) |
| Order | 10:39:40 | 10:41:28 | 1.8m | — |
| Completion | 10:39:40 | 10:41:28 | 1.8m | system |

### 128. WGKA-55701 · Satish kumar  Ontikommu · SARJAPURA · PHYSICAL_GOLD
Opened **10:26:15** → Completed **11:17:25** · total **51.2m** · opened by Ananda R (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 10:26:15 | 10:28:08 | 1.9m | Ananda R (BRANCH) |
| Quotation approval | 10:28:08 | 10:59:31 | 31.4m | Sanathana K (OTHERS) |
| KYC · APPROVED | 10:58:10 | 10:58:10 | — | Monica Celestina (KYC_MAKER) · KYC_MAKER |
| KYC · APPROVED | 10:59:07 | 10:59:07 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:59:07 | 11:14:55 | 15.8m | Ananda R (BRANCH) |
| Order | 11:14:55 | 11:17:25 | 2.5m | — |
| Completion | 11:14:55 | 11:17:25 | 2.5m | system |

### 129. WGKA-55702 · Suma S · MALLESHWARAM · PHYSICAL_GOLD
Opened **10:30:51** → Completed **11:25:19** · total **54.5m** · opened by Drakshayani K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 10:30:51 | 10:31:41 | 0.8m | Drakshayani K (BRANCH) |
| Quotation approval | 10:31:41 | 10:56:57 | 25.3m | Sanathana K (OTHERS) |
| KYC · APPROVED | 10:56:15 | 10:56:15 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:56:20 | 10:56:20 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:56:20 | 11:22:37 | 26.3m | Drakshayani K (BRANCH) |
| Order | 11:22:37 | 11:25:19 | 2.7m | — |
| Completion | 11:22:37 | 11:25:19 | 2.7m | system |

### 130. WGKA-55705 · NIVI  KURIAKOSE · KL-VENNALA-BY-PASS · PHYSICAL_GOLD
Opened **10:32:36** → Completed **11:12:21** · total **39.8m** · opened by Arun Kumar P K (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 10:32:36 | 10:33:11 | 0.6m | Arun Kumar P K (BRANCH) |
| Quotation approval | 10:33:11 | 11:08:09 | 35.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 10:40:41 | 10:40:41 | — | Vinith K (KYC_CHECKER) · KYC_MAKER |
| KYC · APPROVED | 10:40:44 | 10:40:44 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 10:40:45 | 10:40:45 | — | Vinith K (KYC_CHECKER) · KYC_CHECKER |
| Payment | 10:40:45 | 11:10:32 | 29.8m | Arun Kumar P K (BRANCH) |
| Order | 11:10:32 | 11:12:21 | 1.8m | — |
| Completion | 11:10:32 | 11:12:21 | 1.8m | system |

### 131. WGKA-55717 · SREELEKHA RAJAN · KL-KALPETTA · PHYSICAL_GOLD
Opened **11:04:16** → Completed **11:22:31** · total **18.3m** · opened by ANEESH  A (BRANCH)

| Stage | Start | End | Duration | Handled by (role) |
|---|---|---|---|---|
| Estimation / valuation | 11:04:16 | 11:06:17 | 2.0m | ANEESH  A (BRANCH) |
| Quotation approval | 11:06:17 | 11:19:18 | 13.0m | Vishnupriya U (BRANCH) |
| KYC · APPROVED | 11:18:24 | 11:18:24 | — | Megha M (OTHERS) · KYC_MAKER |
| KYC · APPROVED | 11:18:44 | 11:18:44 | — | Inchara R (KYC_CHECKER) · KYC_CHECKER |
| Payment | 11:18:44 | 11:20:41 | 2.0m | ANEESH  A (BRANCH) |
| Order | 11:20:41 | 11:22:31 | 1.8m | — |
| Completion | 11:20:41 | 11:22:31 | 1.8m | system |

