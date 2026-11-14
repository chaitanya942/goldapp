# Request to the CRM team: log finance payment activity

**From:** WhiteGold gold app (Finance → Finance Performance)
**Why:** to measure how long finance staff take to act on payment requests, including time to view the bill and the first click. The CRM doesn't record these today.

## What's missing today

| Needed | Today in the CRM |
|---|---|
| When a request lands in an employee's queue | Not recorded. Inferred from the previous step (for example, penny drop completed). |
| When the employee opens / views the bill | Not recorded |
| The employee's first click on the action button | Not recorded |
| Who approved a penny drop | Only the branch employee who requested it (`Payment.employee_id`) |
| Who recorded a manual (OFFLINE) final payment | Not recorded: `Payment.employee_id` is empty on all 1,445 since 15 Jun 2026 |
| When a release request reaches finance | `Release.updated_at` is overwritten when the release is paid |

The CRM already has an **`AuditTrails`** table with the right shape (`emp_id`, `action`, `payload`, `duration`, `created_at`), but it has **0 rows**. Writing to it for the events below would be enough.

## Events to log (one row per event)

| `action` | When | `payload` must include |
|---|---|---|
| `PAYMENT_REQUEST_QUEUED` | A penny drop / final payment / release payment / manual payment request becomes actionable by finance | `transaction_id`, `request_type` (PENNY_DROP / FINAL_PAYMENT / RELEASE_PAYMENT / MANUAL_PAYMENT), `assigned_emp_id` if assigned |
| `PAYMENT_BILL_VIEWED` | An employee opens the bill / case for that request | `transaction_id`, `request_type` |
| `PAYMENT_ACTION_CLICKED` | The employee's **first** click on the action button (approve / pay / skip / record payment) | `transaction_id`, `request_type`, `button` |
| `PAYMENT_UTR_SAVED` | UTR entered (release / manual) | `transaction_id`, `request_type`, `payment_id` |
| `PAYMENT_SCREENSHOT_SAVED` | Payout screenshot uploaded | `transaction_id`, `request_type`, `payment_id`, `file_id` |
| `PAYMENT_APPROVED` | Final approve / pay / record is completed (also for penny drop approve or skip) | `transaction_id`, `request_type`, `payment_id`, `outcome` |

Also: set `Payment.employee_id` for **manual (OFFLINE) payments**, and record the **approving finance employee** for penny drops.

**Common to every row:** `emp_id` = the CRM employee code (for example `WG00949`), and `created_at` = server time in UTC.

Once rows appear, the gold app's Finance Performance report fills in the **Time to view bill** and **Time to first click** columns automatically, and switches "landed in queue" to the logged `PAYMENT_REQUEST_QUEUED` time.
