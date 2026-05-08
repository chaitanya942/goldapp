// lib/consignmentUtils.js
// Single source of truth for consignment number generation logic.
// Import from here — do NOT duplicate these functions in route files.

// ── External number seed ──────────────────────────────────────────────────────
// Last used number before this system went live (Apr 2026).
// Stored here once so all 3 routes (create, preview, seed) stay in sync.
export const EXT_NO_SEED = 1903

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
export async function generateTmpPrfNo(supabase, branchName) {
  if (!branchName) throw new Error('generateTmpPrfNo: branchName is required (per-branch sequence)')
  const { data } = await supabase
    .from('consignments')
    .select('tmp_prf_no')
    .eq('branch_name', branchName)
    .not('tmp_prf_no', 'is', null)
    .order('tmp_prf_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const last = data?.tmp_prf_no ? parseInt(String(data.tmp_prf_no).replace('WG', '')) || 0 : 0
  return `WG${String(last + 1).padStart(6, '0')}`
}

// ── Generate External No + Challan No (global sequential) ────────────────────
// NOTE: This uses a read-then-write pattern which has a race condition under
// high concurrency. For production scale, replace with a Postgres sequence RPC.
// Until then, the seed floor (EXT_NO_SEED) prevents going below a known safe value.
export async function generateExternalNo(supabase, branchCode, stateCode) {
  const now   = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year  = now.getFullYear()

  const { data } = await supabase
    .from('consignments')
    .select('external_no')
    .not('external_no', 'is', null)
    .order('external_no', { ascending: false })
    .limit(1)
    .single()

  const lastNo  = data?.external_no ? parseInt(data.external_no) || 0 : 0
  const extNo   = String(Math.max(lastNo, EXT_NO_SEED) + 1).padStart(6, '0')
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
