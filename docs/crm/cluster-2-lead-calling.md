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
