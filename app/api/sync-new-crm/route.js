import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { NEW_CRM_LIVE_DATE } from '../../../lib/crmConfig'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { aliasBranchName } from '../../../lib/crmBranchAlias'

const { Client } = pg

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// ── Map new CRM Transaction.status → simple crm_status ───────────────────────
function mapStatus(status) {
  if (!status) return 'pending'
  const s = status.toUpperCase()
  if (s === 'FINAL_PAYMENT_COMPLETED') return 'approved'
  if (s === 'WALKOUT') return 'rejected'
  return 'pending'  // everything else: ESTIMATION_PENDING, KYC_PENDING, FINAL_PAYMENT_PENDING, etc.
}

// ── Map new CRM transaction_type → GoldApp type ──────────────────────────────
function mapTxnType(type) {
  if (!type) return 'PHYSICAL'
  return type.toUpperCase().includes('RELEASED') ? 'TAKEOVER' : 'PHYSICAL'
}

// Percentage fields (service charge, purity) are bounded 0–100 by definition.
// Clamp so bad source data can't overflow the numeric column and abort the sync.
function clampPct(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

// ── Format Postgres timestamp → YYYY-MM-DD (IST) ─────────────────────────────
function fmtDate(ts) {
  if (!ts) return null
  const d = new Date(ts)
  // Add 5:30 for IST
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`
}

function fmtTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return `${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')}:${String(ist.getUTCSeconds()).padStart(2,'0')}`
}

// Extracted body so the cron GET handler can call it without tripping user auth.
async function runSync(request) {
  // ── New CRM not live yet — wipe any test data and skip sync ────────────────
  if (!NEW_CRM_LIVE_DATE) {
    await supabaseAdmin.from('purchases').delete().eq('crm_source', 'new_crm')
    return Response.json({ success: true, message: 'New CRM is not live yet. Test data has been cleared.', synced: 0 })
  }

  let client
  try {
    client = new Client({
      host:     process.env.NEW_CRM_DB_HOST,
      port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
      database: process.env.NEW_CRM_DB_NAME,
      user:     process.env.NEW_CRM_DB_USER,
      password: process.env.NEW_CRM_DB_PASSWORD,
      ssl:      { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    await client.connect()

    // ── Find cutoff: latest new_crm record in Supabase ─────────────────────
    const { data: latestRow } = await supabaseAdmin
      .from('purchases')
      .select('purchase_date')
      .eq('crm_source', 'new_crm')
      .order('purchase_date', { ascending: false })
      .limit(1)
      .single()

    // 7-day buffer; never go before the official go-live date
    const cutoffDate = latestRow?.purchase_date
      ? new Date(Math.max(
          new Date(latestRow.purchase_date).getTime() - 7 * 86400000,
          new Date(NEW_CRM_LIVE_DATE).getTime()
        )).toISOString().split('T')[0]
      : NEW_CRM_LIVE_DATE

    // ── Pull only completed (FINAL_PAYMENT_COMPLETED) transactions ────────────
    // orn_dedup: the new CRM can leave a duplicate Ornament row per item (same
    // ornament_id, one approve=true + one approve=false leftover) — summing both
    // doubles the weight. Keep ONE row per (transaction, ornament_id), preferring
    // the approved/latest. Then aggregate the deduped rows.
    const { rows } = await client.query(`
      WITH txn_orn AS (
        -- Weight basis = APPROVED ornaments only (approve=true), matching the CRM
        -- dashboard's latest_gold_transaction_report. Unapproved/superseded
        -- ornament rows are excluded (they inflated 15-Jun by ~84 g). Gather
        -- approved ornaments via BOTH estimation_id (pre-quotation) and
        -- quotation_id links so an approved-at-estimation bill still carries
        -- weight, then dedupe by ornament_id keeping the latest.
        SELECT q.transaction_id, o.ornament_id, o.id::text AS oid,
               o.gross_weight, o.stone_weight, o.wastage, o.net_weight, o.purity, o.amount,
               o.created_at
        FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id
        WHERE o.approve = true
        UNION ALL
        SELECT e.transaction_id, o.ornament_id, o.id::text,
               o.gross_weight, o.stone_weight, o.wastage, o.net_weight, o.purity, o.amount,
               o.created_at
        FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id
        WHERE o.approve = true
      ),
      orn_dedup AS (
        SELECT DISTINCT ON (transaction_id, COALESCE(ornament_id, oid))
               transaction_id, gross_weight, stone_weight, wastage, net_weight, purity, amount
        FROM txn_orn
        ORDER BY transaction_id, COALESCE(ornament_id, oid), created_at DESC
      ),
      orn AS (
        SELECT transaction_id,
               SUM(gross_weight) gross_weight, SUM(stone_weight) stone_weight,
               SUM(wastage) wastage, SUM(net_weight) net_weight,
               CASE WHEN SUM(net_weight) > 0 THEN SUM(net_weight * purity) / SUM(net_weight) ELSE 0 END purity,
               SUM(amount) total_amount
        FROM orn_dedup GROUP BY transaction_id
      )
      SELECT
        t.id, t.code, t.status, t.transaction_type, t.created_at, t.branch_id, t.customer_id,
        -- Customer name comes from the WALKIN record (per DevOps, that's what
        -- the branch-facing CRM dashboard shows — it carries the KYC-stage name).
        -- Falls back to the Customer record only if there's no Walkin row.
        COALESCE(NULLIF(btrim(w.first_name), ''), c.first_name) AS first_name,
        COALESCE(NULLIF(btrim(w.last_name),  ''), c.last_name)  AS last_name,
        c.mobile, b.name AS branch_name,
        q.service_charge, q.service_charge_amount, q.final_amount,
        COALESCE(orn.gross_weight, 0) AS gross_weight,
        COALESCE(orn.stone_weight, 0) AS stone_weight,
        COALESCE(orn.wastage, 0)      AS wastage,
        COALESCE(orn.net_weight, 0)   AS net_weight,
        COALESCE(orn.purity, 0)       AS purity,
        COALESCE(orn.total_amount, 0) AS total_amount,
        -- Final-payment timestamp = the day the purchase actually happened (== the
        -- invoice date). This is the purchase_date we store, NOT created_at.
        fpay.fp AS final_payment_at
      FROM "Transaction" t
      LEFT JOIN "Customer" c ON c.id = t.customer_id
      LEFT JOIN "Branch"   b ON b.id = t.branch_id
      LEFT JOIN LATERAL (
        SELECT first_name, last_name FROM "Walkin"
        WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1
      ) w ON true
      LEFT JOIN LATERAL (
        SELECT service_charge, service_charge_amount, final_amount
        FROM "Quotation" WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1
      ) q ON true
      LEFT JOIN LATERAL (
        SELECT MAX(created_at) fp FROM "Payment"
        WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT'
      ) fpay ON true
      LEFT JOIN orn ON orn.transaction_id = t.id
      -- Window on the FINAL-PAYMENT date, not created_at: a bill walked-in before
      -- the cutoff but PAID recently is a recent purchase and must still sync.
      -- (created_at-based windowing silently dropped such bills from the master.)
      WHERE fpay.fp >= $1
        AND t.status = 'FINAL_PAYMENT_COMPLETED'
      ORDER BY fpay.fp DESC
    `, [cutoffDate])

    if (!rows.length) {
      return Response.json({ success: true, message: 'No new CRM records found', synced: 0, newCount: 0 })
    }

    // ── Build normalized records ───────────────────────────────────────────
    const allRecords = rows.map(r => {
      const netWeight   = parseFloat(r.net_weight)   || 0
      const finalAmount = parseFloat(r.final_amount)  || 0
      // Clamp service-charge % to 0–100. Some new-CRM quotations carry garbage
      // values (e.g. 1685.94) that overflow the numeric column and, because the
      // upsert batches are all-or-nothing, block every new bill in the run.
      const svcPct      = clampPct(r.service_charge)
      const svcAmount   = parseFloat(r.service_charge_amount) || 0
      const customerName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null

      // Normalize code: strip any spaces, ensure WGKA prefix (new CRM uses WGKA-XXXXX)
      const rawCode  = String(r.code || '').trim().replace(/-/g, '')
      const appId    = rawCode.toUpperCase().startsWith('WGKA') ? rawCode.toUpperCase() : `WGKA${rawCode}`

      return {
        application_id:             appId,
        crm_source:                 'new_crm',
        crm_status:                 mapStatus(r.status),
        // Purchase date/time = when the final payment was made (== invoice date).
        // Falls back to created_at only if a completed bill somehow lacks a
        // final-payment row (shouldn't happen for FINAL_PAYMENT_COMPLETED).
        purchase_date:              fmtDate(r.final_payment_at || r.created_at),
        transaction_time:           fmtTime(r.final_payment_at || r.created_at),
        customer_name:              customerName,
        phone_number:               r.mobile?.trim() || null,
        branch_name:                aliasBranchName(r.branch_name?.trim()) || null,
        transaction_type:           mapTxnType(r.transaction_type),
        gross_weight:               parseFloat(r.gross_weight) || 0,
        stone_weight:               parseFloat(r.stone_weight) || 0,
        wastage:                    parseFloat(r.wastage)      || 0,
        net_weight:                 netWeight,
        net_weight_crm:             netWeight,
        net_weight_calculated:      netWeight,
        purity:                     parseFloat(r.purity)       || 0,
        total_amount:               parseFloat(r.total_amount) || 0,
        final_amount_crm:           finalAmount,
        final_amount_calc:          finalAmount,
        service_charge_pct:         svcPct,
        service_charge_amount_crm:  svcAmount,
        service_charge_amount_calc: svcAmount,
        net_weight_mismatch:        false,
        service_charge_mismatch:    false,
        final_amount_mismatch:      false,
        // stock_status intentionally omitted — DB default 'at_branch' applies on INSERT,
        // existing rows keep their current status (in_consignment, at_ho, etc.)
        is_duplicate:               false,
        is_deleted:                 false,
      }
    })

    const dates   = allRecords.map(r => r.purchase_date).filter(Boolean)
    const minDate = dates.reduce((a, b) => a < b ? a : b)
    const maxDate = dates.reduce((a, b) => a > b ? a : b)

    // ── Non-destructive upsert (NO delete-then-reinsert) ─────────────────────
    // Earlier this did a "full refresh" — delete every new_crm row in the
    // window, then re-insert. That nuked operational state: a bill marked
    // in_consignment (or booked) would lose stock_status / dispatched_at /
    // booking_id on the very next cron cycle and snap back to at_branch.
    // The upsert below carries ONLY CRM-sourced columns; stock_status,
    // dispatched_at, booking_id and the audit fields are intentionally NOT in
    // the record object, so ON CONFLICT DO UPDATE leaves them untouched for
    // existing rows, while new rows fall back to their DB defaults on INSERT.
    // Batch for speed, but on any batch error fall back to per-row upserts so a
    // single bad record (e.g. an overflowing numeric value) only drops itself
    // and is named in the response, instead of aborting the whole batch and
    // silently stalling the sync.
    const BATCH = 100
    let synced = 0, errors = 0, lastError = null
    const failedIds = []
    for (let i = 0; i < allRecords.length; i += BATCH) {
      const batch = allRecords.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
        .from('purchases')
        .upsert(batch, { onConflict: 'application_id,crm_source', ignoreDuplicates: false })
      if (!error) { synced += batch.length; continue }
      console.error('New CRM batch failed, retrying per-row:', error.message)
      for (const rec of batch) {
        const { error: e1 } = await supabaseAdmin
          .from('purchases')
          .upsert([rec], { onConflict: 'application_id,crm_source', ignoreDuplicates: false })
        if (e1) {
          console.error(`New CRM row failed ${rec.application_id}: ${e1.message}`)
          lastError = e1; errors++; failedIds.push(rec.application_id)
        } else {
          synced++
        }
      }
    }

    return Response.json({
      success:   errors === 0,
      total:     rows.length,
      synced,
      errors,
      failedIds,
      lastError: lastError ? lastError.message : null,
      message:   `New CRM upsert ${minDate}→${maxDate}: ${allRecords.length} completed bills (${errors} errors${failedIds.length ? `: ${failedIds.join(', ')}` : ''})`,
    })

  } catch (err) {
    console.error('New CRM sync error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (client) await client.end()
  }
}

// Manual sync — ADMIN only.
export async function POST(request) {
  const auth = await requireAuth(request, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response
  return runSync(request)
}

// Vercel cron handler — gated by CRON_SECRET (server-to-server).
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSync(req)
}
