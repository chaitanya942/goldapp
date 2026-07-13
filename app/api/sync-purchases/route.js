import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { recordSyncSuccess, recordSyncFailure } from '../../../lib/syncHeartbeat'
import { aliasBranchName } from '../../../lib/crmBranchAlias'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

function parseCSVFloat(str) {
  if (!str) return []
  return str.split(',').map(v => parseFloat(v.trim()) || 0)
}

function sumCSV(str) {
  return parseCSVFloat(str).reduce((a, b) => a + b, 0)
}

function weightedAvgPurity(netWetStr, purityStr) {
  const nets     = parseCSVFloat(netWetStr)
  const purities = parseCSVFloat(purityStr)
  const totalNet = nets.reduce((a, b) => a + b, 0)
  if (totalNet === 0) return 0
  const weighted = nets.reduce((sum, n, i) => sum + n * (purities[i] || 0), 0)
  return weighted / totalNet
}

// ── Normalize application_id — strip any existing WGKA prefix first ──────────
function normalizeAppId(raw) {
  const s = String(raw).trim()
  if (s.toUpperCase().startsWith('WGKA')) return s.toUpperCase()
  return `WGKA${s}`
}

// ── Format MySQL date safely without timezone shift ───────────────────────────
function fmtDate(d) {
  if (!d) return null
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return String(d).split('T')[0].split(' ')[0]
}

// ── Preserve every CRM transaction; suffix on bill_no collision ──────────────
// Older logic dropped rows it thought were duplicates (matched by name + date
// + weight + amount + phone). That cost ops 25+ bills per day in production
// because walk-ins with NULL phone or shared default names were wrongly
// collapsed, leaving consignments uncreatable for the missing bills.
//
// New rule: every distinct CRM txn_id is preserved. We only modify
// application_id (bill_no) to stay unique within the batch — CRM legitimately
// re-uses bill numbers across transactions, but the (application_id,
// crm_source) upsert key must be unique. Smallest txn_id within a group
// keeps the bare bill_no so the assignment is deterministic across syncs;
// the rest get suffixed with their txn_id.
function smartDedup(records) {
  const groups = new Map()
  for (const r of records) {
    if (!groups.has(r.application_id)) groups.set(r.application_id, [])
    groups.get(r.application_id).push(r)
  }
  const result = []
  for (const group of groups.values()) {
    group.sort((a, b) => Number(a._txn_id) - Number(b._txn_id))
    for (let i = 0; i < group.length; i++) {
      const r = group[i]
      result.push(i === 0 ? r : { ...r, application_id: `${r.application_id}-${r._txn_id}` })
    }
  }
  return result
}

// ── Look up ID proofs + customer bank for a set of CRM kyc_ids ──────────────
// Proofs live in `cust_addr_tbl` (linked by `custspt_id = transac_tbl.kyc_id`).
// A single customer can have multiple rows there — same Aadhaar repeated, or
// genuinely different docs (aadhar + PAN + DL). We dedupe on (proof, proof_num)
// pairs, so each distinct doc shows up exactly once.
//
// Bank name lives in `bank_details` — we pick the most recent row per kyc_id.
// Payment reference is on transac_tbl.pmt_refno (already in main SELECT).
//
// Returns { proofMap, bankMap } keyed on String(kyc_id).
//   proofMap: Map<kyc_id, { types: string, numbers: string }> (CSV strings, same order)
//   bankMap:  Map<kyc_id, string>
export async function fetchKycMetaMaps(conn, kycIds) {
  const proofMap = new Map()
  const bankMap  = new Map()
  const unique   = [...new Set(kycIds.map(k => String(k).trim()).filter(Boolean))]
  if (!unique.length) return { proofMap, bankMap }

  // Buffer raw (type, number) pairs per kyc_id while we walk chunks, then
  // dedupe + serialize to CSV at the end. Using a Set per kyc keeps it O(1)
  // membership-check without an N² pass.
  const rawProofs = new Map()   // kyc_id → Set<"type|number">

  const CHUNK = 1000
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const ph    = chunk.map(() => '?').join(',')

    const [proofRows] = await conn.execute(
      `SELECT custspt_id, proof, proof_num FROM cust_addr_tbl
       WHERE custspt_id IN (${ph})
         AND proof IS NOT NULL AND proof != ''
         AND proof_num IS NOT NULL AND proof_num != ''`,
      chunk
    )
    for (const r of proofRows) {
      const kyc  = String(r.custspt_id).trim()
      const type = String(r.proof).trim().toLowerCase()
      const num  = String(r.proof_num).trim()
      // Drop the obvious placeholder rows (all 9s, all 0s, etc.).
      if (!num || /^9{8,}$/.test(num) || /^0+$/.test(num)) continue
      const key = `${type}|${num}`
      if (!rawProofs.has(kyc)) rawProofs.set(kyc, new Set())
      rawProofs.get(kyc).add(key)
    }

    // Most-recent bank per kyc_id (inner subquery picks MAX(id) per group,
    // then self-join recovers bank_nme for that row).
    const [bankRows] = await conn.execute(
      `SELECT b1.kyc_id, b1.bank_nme FROM bank_details b1
       INNER JOIN (
         SELECT kyc_id, MAX(id) AS max_id FROM bank_details
         WHERE kyc_id IN (${ph}) AND bank_nme IS NOT NULL AND bank_nme != ''
         GROUP BY kyc_id
       ) b2 ON b1.id = b2.max_id`,
      chunk
    )
    bankRows.forEach(r => bankMap.set(String(r.kyc_id), String(r.bank_nme).trim()))
  }

  // Serialize the deduped (type, number) set per kyc_id into parallel CSVs.
  for (const [kyc, keySet] of rawProofs.entries()) {
    const pairs   = [...keySet].map(k => k.split('|'))
    const types   = pairs.map(p => p[0]).join(', ')
    const numbers = pairs.map(p => p[1]).join(', ')
    proofMap.set(kyc, { types, numbers })
  }

  return { proofMap, bankMap }
}

// Extracted sync body — callable from both the user POST handler (auth-gated)
// and the cron GET handler (CRON_SECRET-gated). Keeps the recursive call from
// the GET path working without it tripping the user-auth check.
async function runSync(request) {
  const url = new URL(request.url)
  const daysBack = parseInt(url.searchParams.get('days') || '2')

  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // ── Cutoff = daysBack days ago (or 30 days ago as absolute fallback) ─────
    const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0]

    // ── Pull only approved records from CRM ──────────────────────────────────
    // pmt_refno comes directly off transac_tbl. PAN + customer bank live in
    // joined tables (aadhar_valid, bank_details) and are looked up separately
    // below via fetchKycMetaMaps — doing them as scalar subqueries in this
    // SELECT was too slow.
    const [rows] = await conn.execute(`
      SELECT
        t.id                          AS txn_id,
        t.bill_no                     AS application_id,
        t.kyc_id                      AS kyc_id,
        t.trxn_status                 AS crm_status,
        t.date                        AS purchase_date,
        t.time                        AS transaction_time,
        t.cust_name                   AS customer_name,
        t.cust_mobile                 AS phone_number,
        t.branch_id,
        t.type_gold                   AS transaction_type,
        t.serv_chr                    AS service_charge_pct,
        t.finl_amnt                   AS final_amount_crm,
        t.pmt_refno                   AS payment_reference,
        GROUP_CONCAT(o.grms_wet   ORDER BY o.id) AS gross_weight_str,
        GROUP_CONCAT(o.stnt_wet   ORDER BY o.id) AS stone_weight_str,
        GROUP_CONCAT(o.wastag_wet ORDER BY o.id) AS wastage_str,
        GROUP_CONCAT(o.net_wet    ORDER BY o.id) AS net_weight_str,
        GROUP_CONCAT(o.purity     ORDER BY o.id) AS purity_str,
        GROUP_CONCAT(o.grs_amnt   ORDER BY o.id) AS total_amount_str
      FROM transac_tbl t
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.trxn_status = 'approved' AND t.date >= ?
      GROUP BY t.id
    `, [cutoff])

    // ID proof + bank lookups for the kyc_ids in this batch.
    const { proofMap, bankMap } = await fetchKycMetaMaps(conn, rows.map(r => r.kyc_id))

    if (!rows.length) {
      await recordSyncSuccess(supabaseAdmin, 'old_crm', 0)
      return Response.json({ success: true, message: 'No approved records in CRM window', synced: 0, newCount: 0 })
    }

    // ── Branch lookup ──────────────────────────────────────
    const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
    const branchMap  = {}
    branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name?.trim() })

    // ── Map CRM rows → Supabase records ───────────────────
    const allRecords = rows.map(r => {
      const grossWeight = sumCSV(r.gross_weight_str)
      const stoneWeight = sumCSV(r.stone_weight_str)
      const wastage     = sumCSV(r.wastage_str)
      const netWeight   = sumCSV(r.net_weight_str)
      const totalAmount = sumCSV(r.total_amount_str)
      const purity      = weightedAvgPurity(r.net_weight_str, r.purity_str)
      const finalAmount = parseFloat(r.final_amount_crm) || 0
      const svcPct      = parseFloat(r.service_charge_pct) || 0
      const svcAmount   = finalAmount * (svcPct / 100)
      // Normalize through the SAME alias map the new-CRM sync uses. The old CRM
      // stores bare Karnataka names ("ADUGODI", "MYSURU"); without this, every
      // old-CRM bill it touches would overwrite the canonical KA- name and orphan
      // the bill from its branch. Both syncs must agree on the canonical name.
      const branchName  = aliasBranchName((branchMap[r.branch_id] || String(r.branch_id))?.trim())
      const txnType     = r.transaction_type?.trim()?.toLowerCase()
      const appId       = normalizeAppId(r.application_id)

      let txnTime = null
      if (r.transaction_time !== null && r.transaction_time !== undefined) {
        if (typeof r.transaction_time === 'string') {
          txnTime = r.transaction_time.trim()
        } else if (typeof r.transaction_time === 'object') {
          const h = String(Math.floor(Math.abs(r.transaction_time) / 3600)).padStart(2, '0')
          const m = String(Math.floor((Math.abs(r.transaction_time) % 3600) / 60)).padStart(2, '0')
          const s = String(Math.abs(r.transaction_time) % 60).padStart(2, '0')
          txnTime = `${h}:${m}:${s}`
        }
      }

      return {
        _txn_id:                    r.txn_id,    // smartDedup sorting (stripped before upsert)
        crm_txn_id:                 r.txn_id,    // persisted: stable identity for rename detection
        application_id:             appId,
        crm_status:                 r.crm_status || 'approved',
        purchase_date:              fmtDate(r.purchase_date),
        transaction_time:           txnTime,
        customer_name:              r.customer_name?.trim() || null,
        phone_number:               r.phone_number?.trim()  || null,
        branch_name:                branchName,
        transaction_type:           txnType === 'physical' ? 'PHYSICAL' : 'TAKEOVER',
        gross_weight:               grossWeight,
        stone_weight:               stoneWeight,
        wastage:                    wastage,
        net_weight:                 netWeight,
        net_weight_crm:             netWeight,
        net_weight_calculated:      netWeight,
        purity:                     purity,
        total_amount:               totalAmount,
        final_amount_crm:           finalAmount,
        final_amount_calc:          finalAmount,
        service_charge_pct:         svcPct,
        service_charge_amount_crm:  svcAmount,
        service_charge_amount_calc: svcAmount,
        id_proof_types:             proofMap.get(String(r.kyc_id || '').trim())?.types   || null,
        id_proof_numbers:           proofMap.get(String(r.kyc_id || '').trim())?.numbers || null,
        bank_name:                  bankMap.get(String(r.kyc_id || '').trim()) || null,
        payment_reference:          (r.payment_reference || '').toString().trim() || null,
        net_weight_mismatch:        false,
        service_charge_mismatch:    false,
        final_amount_mismatch:      false,
        // stock_status intentionally omitted — DB default 'at_branch' applies on INSERT,
        // existing rows keep their current status (in_consignment, at_ho, etc.)
        is_duplicate:               false,
        is_deleted:                 false,
        crm_source:                 'old_crm',
      }
    })

    // ── Dedup within the CRM result set ──────────────────────────────────────
    const deduped = smartDedup(allRecords).map(({ _txn_id, ...r }) => r)

    // ── Detect CRM bill_no renames; rename in place to preserve stock_status ─
    // application_id (= bill_no) is mutable in CRM. Without this step, a
    // rename looks like "new bill": fresh row inserted at stock_status
    // default 'at_branch', original row carrying ops's in_consignment /
    // at_ho work gets orphaned and reconcile marks it deleted. Matching on
    // crm_txn_id (CRM's primary key — stable across renames) lets us spot
    // the same transaction under a new bill_no and UPDATE the existing
    // row's application_id in place, so the row's stock_status survives.
    let renamed = 0, renameCollisions = 0
    const incomingByTxn = new Map()
    for (const r of deduped) {
      if (r.crm_txn_id) incomingByTxn.set(r.crm_txn_id, r.application_id)
    }
    const txnIds = [...incomingByTxn.keys()]
    if (txnIds.length > 0) {
      // Page through Supabase 1000 at a time (max_rows limit) to find existing
      // rows whose crm_txn_id matches an incoming record.
      const CHUNK = 1000
      const existingRows = []
      for (let i = 0; i < txnIds.length; i += CHUNK) {
        const slice = txnIds.slice(i, i + CHUNK)
        const { data } = await supabaseAdmin
          .from('purchases')
          .select('application_id, crm_txn_id')
          .eq('crm_source', 'old_crm')
          .in('crm_txn_id', slice)
        if (data) existingRows.push(...data)
      }
      for (const existing of existingRows) {
        const incomingAppId = incomingByTxn.get(existing.crm_txn_id)
        if (incomingAppId && existing.application_id !== incomingAppId) {
          const { error } = await supabaseAdmin
            .from('purchases')
            .update({ application_id: incomingAppId })
            .eq('crm_txn_id', existing.crm_txn_id)
            .eq('crm_source', 'old_crm')
          if (error) {
            renameCollisions++
            console.warn(`Bill_no rename collision: ${existing.application_id} → ${incomingAppId} (crm_txn_id=${existing.crm_txn_id}):`, error.message)
          } else {
            renamed++
            console.log(`Bill_no renamed: ${existing.application_id} → ${incomingAppId} (crm_txn_id=${existing.crm_txn_id}, stock_status preserved)`)
          }
        }
      }
    }

    // ── Safe upsert-only sync (no delete) ────────────────────────────────────
    // Deleting before upsert caused data loss when function timed out mid-operation.
    // Upsert with onConflict handles add/update of approved bills safely.
    // Bills that were approved→rejected in CRM stay in Supabase (acceptable: they
    // are marked approved in CRM first before being rejected, so the window is small).
    const BATCH = 200
    let synced = 0, errors = 0, lastError = null

    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
        .from('purchases')
        .upsert(batch, { onConflict: 'application_id,crm_source', ignoreDuplicates: false })
      if (error) {
        console.error('Upsert error:', JSON.stringify(error, null, 2))
        lastError = error
        errors += batch.length
      } else {
        synced += batch.length
      }
    }

    const dates   = deduped.map(r => r.purchase_date).filter(Boolean)
    const minDate = dates.reduce((a, b) => a < b ? a : b)
    const maxDate = dates.reduce((a, b) => a > b ? a : b)

    // ── Full reconcile: mark ANY Supabase bill in sync window missing from CRM ──
    // Catches both delete+recreate AND pure deletes. Since we have the full CRM
    // approved ID set for the synced date range, anything in Supabase but not in
    // CRM was deleted from CRM and should be marked accordingly.
    let ghostsMarked = 0
    let deletedIds = []
    let carriedForward = 0, carryAmbiguous = 0
    try {
      const crmIds = new Set(deduped.map(r => r.application_id))

      const CHUNK = 1000
      let offset = 0, supaRows = []
      while (true) {
        const { data } = await supabaseAdmin
          .from('purchases')
          .select('application_id')
          .eq('crm_source', 'old_crm')
          .eq('crm_status', 'approved')
          .gte('purchase_date', minDate)
          .lte('purchase_date', maxDate)
          .range(offset, offset + CHUNK - 1)
        if (!data || data.length === 0) break
        supaRows.push(...data)
        if (data.length < CHUNK) break
        offset += CHUNK
      }

      deletedIds = supaRows
        .map(b => b.application_id)
        .filter(id => !crmIds.has(id))

      if (deletedIds.length > 0) {
        await supabaseAdmin
          .from('purchases')
          .update({ crm_status: 'deleted' })
          .in('application_id', deletedIds)
          .eq('crm_source', 'old_crm')
        ghostsMarked = deletedIds.length
        console.log(`Reconcile: marked ${deletedIds.length} CRM-deleted bills`, deletedIds)
      }
    } catch (ghostErr) {
      console.error('Reconcile error (non-fatal):', ghostErr.message)
    }

    // ── Carry-forward: rescue stock_status across CRM delete-and-recreate ──
    // Distinct from the bill_no-rename case (handled by crm_txn_id above):
    // here CRM DELETED a transaction and made a brand-new one (different
    // crm_txn_id) for the same physical bill. No shared identity, so we fall
    // back to a TIGHTLY constrained business-attribute match — and only when
    //   (a) the just-deleted row had ops state worth saving (moved past
    //       at_branch), and
    //   (b) there's exactly ONE fresh at_branch lookalike under a different
    //       application_id.
    // Anything ambiguous (0 or >1 matches) is logged and skipped, never
    // guessed — that's the V.1 over-merge lesson. Bounded to rows deleted in
    // THIS run (O(new deletions), not O(all-deletions-ever)) and idempotent:
    // once carried, the lookalike is no longer at_branch so it can't match
    // again on a later sync.
    try {
      if (deletedIds.length > 0) {
        const lost = []
        for (let i = 0; i < deletedIds.length; i += 1000) {
          const slice = deletedIds.slice(i, i + 1000)
          const { data } = await supabaseAdmin
            .from('purchases')
            .select('id, application_id, stock_status, booking_id, customer_name, branch_name, purchase_date, net_weight')
            .eq('crm_source', 'old_crm')
            .in('application_id', slice)
            .neq('stock_status', 'at_branch')
            .not('stock_status', 'is', null)
          if (data) lost.push(...data)
        }

        for (const L of lost) {
          // Need strong business keys to match safely — if any are missing
          // we cannot trust a fuzzy match (NULL-heavy rows are exactly what
          // caused the original over-merge). Skip rather than risk it.
          if (!L.customer_name || !L.branch_name || !L.purchase_date || L.net_weight == null) {
            carryAmbiguous++
            console.warn(`Carry-forward skipped (insufficient match keys): ${L.application_id}`)
            continue
          }
          const { data: cands } = await supabaseAdmin
            .from('purchases')
            .select('id, application_id, net_weight')
            .eq('crm_source', 'old_crm')
            .eq('crm_status', 'approved')
            .eq('stock_status', 'at_branch')
            .eq('customer_name', L.customer_name)
            .eq('branch_name', L.branch_name)
            .eq('purchase_date', L.purchase_date)
            .neq('application_id', L.application_id)
          const matches = (cands || []).filter(c =>
            Math.abs(Number(c.net_weight) - Number(L.net_weight)) < 0.001
          )
          if (matches.length === 1) {
            const tgt = matches[0]
            const upd = { stock_status: L.stock_status }
            if (L.booking_id) upd.booking_id = L.booking_id  // booking follows the gold
            const { error: cfErr } = await supabaseAdmin
              .from('purchases')
              .update(upd)
              .eq('id', tgt.id)
            if (cfErr) {
              console.warn(`Carry-forward failed ${L.application_id} → ${tgt.application_id}:`, cfErr.message)
            } else {
              carriedForward++
              console.log(`Carry-forward: ${L.stock_status} ${L.application_id} → ${tgt.application_id} (delete+recreate, single business-attr match)`)
            }
          } else if (matches.length > 1) {
            carryAmbiguous++
            console.warn(`Carry-forward ambiguous for ${L.application_id}: ${matches.length} lookalikes — skipped, manual review`, matches.map(m => m.application_id))
          }
          // matches.length === 0 → genuinely deleted, not recreated. Leave it.
        }
      }
    } catch (cfErr) {
      console.error('Carry-forward error (non-fatal):', cfErr.message)
    }

    // Pipeline auto-attach — walks LIVE bookings (arrival_date today or
    // later) and attaches freshly-synced unbooked bills FIFO, but ONLY
    // bills that fit the remaining gap (target_net − sourced_net). A bill
    // too big is skipped and left unbooked — no overshoot. Defined in
    // sql/cal_quotas_gain_model.sql.
    //
    // close_stale_pipelines() and audit_daily_gain() are no longer called:
    // the new gain model derives gain = net × rate exactly (and folds the
    // small EOD leftover in automatically once arrival_date passes), so
    // there's nothing to close or redistribute. Those functions remain
    // defined in the DB but unused.
    //
    // Non-fatal: if the RPC fails we still return the sync result. The
    // attacher retries on the next sync tick, so a transient blip self-heals.
    let pipelineAttached = 0
    let pipelineWeight   = 0
    try {
      const { data: attachRows, error: attachErr } = await supabaseAdmin.rpc('process_pipeline_attachments')
      if (attachErr) {
        console.warn('process_pipeline_attachments error (non-fatal):', attachErr.message)
      } else if (Array.isArray(attachRows) && attachRows.length > 0) {
        for (const row of attachRows) {
          pipelineAttached += Number(row.bills_attached  || 0)
          pipelineWeight   += Number(row.weight_attached || 0)
        }
        console.log(`Pipeline auto-attach: ${attachRows.length} booking(s), ${pipelineAttached} bill(s), ${pipelineWeight.toFixed(2)}g attached (no-overshoot)`)
      }
    } catch (paErr) {
      console.error('Pipeline auto-attach threw (non-fatal):', paErr.message)
    }

    await recordSyncSuccess(supabaseAdmin, 'old_crm', synced)

    return Response.json({
      success:  errors === 0,
      total:    rows.length,
      synced,
      renamed,
      renameCollisions,
      errors,
      ghostsMarked,
      carriedForward,
      carryAmbiguous,
      pipelineAttached,
      pipelineWeight,
      lastError: lastError ? JSON.stringify(lastError) : null,
      message:  `Upsert ${minDate}→${maxDate}: ${deduped.length} approved bills synced, ${renamed} bill_no renames preserved, ${ghostsMarked} ghost bills marked deleted, ${carriedForward} stock_status carried forward across delete-recreate (${carryAmbiguous} ambiguous skipped, ${errors} errors)`,
    })

  } catch (err) {
    console.error('Sync error:', err)
    await recordSyncFailure(supabaseAdmin, 'old_crm', err.message)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}

// Manual sync — ADMIN only.
export async function POST(request) {
  const auth = await requireAuth(request, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response
  return runSync(request)
}

// Vercel cron (midnight auto-sync) — always 7-day window. Gated by CRON_SECRET
// since it's a server-to-server call without a user session.
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  url.searchParams.set('days', '7')
  return runSync(new Request(url.toString(), req))
}