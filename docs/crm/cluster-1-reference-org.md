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
