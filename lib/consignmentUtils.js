// lib/consignmentUtils.js
// Single source of truth for consignment number generation logic.
// Import from here — do NOT duplicate these functions in route files.

// ── External number seed ──────────────────────────────────────────────────────
// Last used delivery-challan / external_no before this system went live.
// Stored here once so all 3 routes (create, preview, seed) stay in sync.
// Bumped 2026-05-08: ops team's last issued was 1904 → next must be 1905.
export const EXT_NO_SEED = 1904

// ── Region → state code ───────────────────────────────────────────────────────
// Derived from the `branches.region` field in the DB.
// To support a NEW state: add the branch in Branch Management with the correct
// `region` value, and add that region here. No other code changes needed.
export function regionToStateCode(region) {
  const map = {
    'Andhra Pradesh':    'AP',
    'Kerala':            'KL',
    'Telangana':         'TS',
    'Tamil Nadu':        'TN',
    'Rest of Karnataka': 'KA',
    'Bangalore':         'KA',
  }
  const code = map[region]
  if (!code) {
    // Unknown region — log and default to KA so generation doesn't break,
    // but callers should surface this to the user.
    console.warn(`[consignmentUtils] Unknown region: "${region}" — defaulting to KA. Add it to regionToStateCode.`)
  }
  return code || 'KA'
}

// ── Branch code from branch name ──────────────────────────────────────────────
// Strips state prefix (AP-, KL-, TS-, TN-, KA-) then abbreviates.
// Works for any prefix format — no fixed state list needed here.
export function autoBranchCode(branchName) {
  const name     = branchName.toUpperCase().trim()
  // Remove any 2-3 letter state prefix followed by a dash
  const stripped = name.replace(/^[A-Z]{2,3}-/, '')
  const words    = stripped.split(/[\s-]+/).filter(Boolean)
  if (words.length === 1) return words[0].substring(0, 3)
  if (words.length === 2) return (words[0].substring(0, 2) + words[1].substring(0, 2)).substring(0, 4)
  return words.map(w => w[0]).join('').substring(0, 4)
}

// ── Generate TMP PRF No (PER-BRANCH sequential) ──────────────────────────────
// Each branch has its own independent counter — MYSURU's WG000493 is unrelated
// to TUMKUR's WG000313. Different branches can reuse the same number without
// conflict. NIC / IRP don't see TMP_PRF directly: buildNicDocRef wraps it with
// a 6-char UUID fingerprint so the per-attempt DocumentNumber is globally
// unique even when two branches both issue WG000001.
//
// Seeded by sql/per_branch_tmp_prf_seed.sql (one status='seed' row per branch
// holding the last-used number from the physical book).
//
// Cancelled consignments are EXCLUDED when picking the max — when ops cancels
// the most recent consignment, the number returns to the pool so the next
// creation reuses it (Hassan last used 22 → create 23 → cancel → next is 23
// again). Older cancelled numbers stay as natural gaps in the sequence.
//
// EXPLICIT NEXT OVERRIDE (branches.next_seal_override): the default max+1 counter
// is monotonic and can't be pointed backward. Ops can set a one-shot next number
// (any UNUSED value, forward or backward) via /api/branch-tamper; it lands in
// branches.next_seal_override. generateTmpPrfNo() below consumes it; peekTmpPrfNo()
// reads it without consuming (previews). See sql/branch_seal_override.sql.
export const tmpPrfToInt = (v) => v ? (parseInt(String(v).replace(/\D/g, '')) || 0) : 0
export const intToTmpPrf = (n) => `WG${String(n).padStart(6, '0')}`

// Highest non-cancelled tmp_prf for a branch (INCLUDING status='seed' floor rows).
async function maxTmpPrf(supabase, branchName) {
  const { data } = await supabase
    .from('consignments')
    .select('tmp_prf_no')
    .eq('branch_name', branchName)
    .not('tmp_prf_no', 'is', null)
    .neq('status', 'cancelled')
    .order('tmp_prf_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return tmpPrfToInt(data?.tmp_prf_no)
}

// Is seal number N already used by a LIVE consignment of this branch? "Used" means
// a real, non-cancelled, non-seed row carries WG{N}. Cancelled seals return to the
// pool; seed/override rows are internal pointers, not real seals. Returns the
// offending consignment (or null).
export async function tmpPrfUsedBy(supabase, branchName, n) {
  if (!n || n < 1) return null
  const { data } = await supabase
    .from('consignments')
    .select('tmp_prf_no, challan_no, consignment_no, status')
    .eq('branch_name', branchName)
    .eq('tmp_prf_no', intToTmpPrf(n))
    .neq('status', 'cancelled')
    .neq('status', 'seed')
    .limit(1)
    .maybeSingle()
  return data || null
}

// PEEK the next tmp_prf without consuming the override — for previews.
export async function peekTmpPrfNo(supabase, branchName) {
  if (!branchName) throw new Error('peekTmpPrfNo: branchName is required (per-branch sequence)')
  const { data: br } = await supabase
    .from('branches').select('next_seal_override').eq('name', branchName).maybeSingle()
  const ov = br?.next_seal_override || 0
  if (ov > 0 && !(await tmpPrfUsedBy(supabase, branchName, ov))) return intToTmpPrf(ov)
  return intToTmpPrf((await maxTmpPrf(supabase, branchName)) + 1)
}

export async function generateTmpPrfNo(supabase, branchName) {
  if (!branchName) throw new Error('generateTmpPrfNo: branchName is required (per-branch sequence)')
  // 1) Honour an explicit one-shot override if it's still unused. Claim it
  //    atomically (conditional clear) so two concurrent creates can't both take
  //    the same override — the loser falls through to the default counter.
  const { data: br } = await supabase
    .from('branches').select('next_seal_override').eq('name', branchName).maybeSingle()
  const ov = br?.next_seal_override || 0
  if (ov > 0) {
    if (!(await tmpPrfUsedBy(supabase, branchName, ov))) {
      const { data: claimed } = await supabase
        .from('branches').update({ next_seal_override: null })
        .eq('name', branchName).eq('next_seal_override', ov)
        .select('id')
      if (claimed && claimed.length) return intToTmpPrf(ov)
      // lost the claim → fall through to the default counter
    } else {
      // Override went stale (a real consignment took it) — clear it, best-effort.
      await supabase.from('branches').update({ next_seal_override: null })
        .eq('name', branchName).eq('next_seal_override', ov)
    }
  }
  // 2) Default: highest non-cancelled + 1.
  return intToTmpPrf((await maxTmpPrf(supabase, branchName)) + 1)
}

// ── Generate External No + Challan No (global sequential) ────────────────────
// Uses the Postgres sequence consignment_external_no_seq (see
// sql/consignment_external_no_sequence.sql) via a thin RPC wrapper.
// nextval() is atomic at the engine level — concurrent callers each receive
// distinct values, eliminating the read-then-write race that used to trip
// the unique constraint on consignment_no.
//
// Fallback: if the RPC isn't deployed yet (PGRST202 / missing function), the
// caller will see a clear error and can run the migration. We deliberately
// don't fall back to the old read-then-write path — that would re-introduce
// the race for any deployment in the transitional window.
export async function generateExternalNo(supabase, branchCode, stateCode) {
  const now   = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year  = now.getFullYear()

  const { data: extNo, error } = await supabase.rpc('next_consignment_external_no')
  if (error || !extNo) {
    const detail = error?.message || 'rpc returned no value'
    throw new Error(`generateExternalNo failed: ${detail}. If you see "function does not exist" run sql/consignment_external_no_sequence.sql in Supabase.`)
  }
  const challan = `WG${stateCode}/${stateCode}-${branchCode}/${month}/${year}/${extNo}`
  return { extNo, challan }
}

// ── Generate Internal No (per-branch, per-month sequential) ──────────────────
export async function generateInternalNo(supabase, branchCode) {
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data } = await supabase
    .from('consignments')
    .select('internal_no')
    .eq('branch_code', branchCode)
    .eq('movement_type', 'INTERNAL')
    .gte('created_at', monthStart)
    .not('internal_no', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastNo = data?.internal_no ? parseInt(data.internal_no) || 0 : 0
  return String(lastNo + 1).padStart(6, '0')
}

// ── Fiscal year code in 'YY-YY' format ───────────────────────────────────────
// Indian FY runs April → March. April 2026 → March 2027 = '26-27'.
// Used for the E-Invoice DocNo template.
export function getCurrentFyCode(now = new Date()) {
  const y       = now.getFullYear()
  const m       = now.getMonth() + 1   // 1..12
  const yyStart = m >= 4 ? y : y - 1
  const yyEnd   = yyStart + 1
  return `${String(yyStart).slice(-2)}-${String(yyEnd).slice(-2)}`
}

// ── Generate next E-Invoice DocNo for a state (atomic per FY) ────────────────
// Format: 'WG/{state}/{fy}/{seq}'  e.g. 'WG/KL/26-27/53'
// Backed by einvoice_sequence + next_einvoice_seq RPC (sql/einvoice_sequence.sql).
// Sequence is per (state_code, fy_code) — every April 1 the per-state counter
// resets to 1 because the (state, fy) row is new.
//
// IMPORTANT: this CONSUMES a sequence number. Call only at generation time.
// For previews, use peekEInvoiceDocNo (read-only) below.
export async function nextEInvoiceDocNo(supabase, stateCode, fyCode = getCurrentFyCode()) {
  if (!stateCode) throw new Error('nextEInvoiceDocNo: stateCode is required')
  const { data, error } = await supabase.rpc('next_einvoice_seq', { p_state: stateCode, p_fy: fyCode })
  if (error) throw new Error(`Failed to allocate E-Invoice number: ${error.message}`)
  const seq = Number(data)
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Invalid E-Invoice sequence response: ${data}`)
  return `WG/${stateCode}/${fyCode}/${seq}`
}

// ── Peek next E-Invoice DocNo without consuming it (preview only) ────────────
// Returns the DocNo that would be issued if generation fired right now.
// Does NOT increment the counter — preview can be re-run safely.
export async function peekEInvoiceDocNo(supabase, stateCode, fyCode = getCurrentFyCode()) {
  if (!stateCode) throw new Error('peekEInvoiceDocNo: stateCode is required')
  const { data } = await supabase
    .from('einvoice_sequence')
    .select('last_seq')
    .eq('state_code', stateCode)
    .eq('fy_code',    fyCode)
    .maybeSingle()
  const next = (Number(data?.last_seq) || 0) + 1
  return `WG/${stateCode}/${fyCode}/${next}`
}

// ── Generate Issue Voucher No (per source branch, monthly sequential) ────────
// Used for Branch → Hub movements. Format: WGIV/{srcCode}/{MON-YYYY}/{seq}
export async function generateIssueVoucherNo(supabase, srcBranchCode, srcStateCode) {
  const now   = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year  = now.getFullYear()

  // Sequence is global across issue vouchers (use internal_no field as backing store)
  const { data } = await supabase
    .from('consignments')
    .select('internal_no')
    .eq('movement_type', 'INTERNAL')
    .not('internal_no', 'is', null)
    .order('internal_no', { ascending: false })
    .limit(1)
    .single()

  const lastNo = data?.internal_no ? parseInt(data.internal_no) || 0 : 0
  const seq    = String(lastNo + 1).padStart(6, '0')
  const voucher = `WGIV/${srcStateCode}-${srcBranchCode}/${month}/${year}/${seq}`
  return { internalNo: seq, voucher }
}
