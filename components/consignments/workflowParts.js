'use client'

// components/consignments/workflowParts.js
//
// Shared building blocks for the consignment workflow gates. Used by both
// ConsignmentData (operations view) and ConsignmentApprovals (accounts review)
// so the same compact strip + the same Confirm flow + the same cross-doc
// audit panel render in both places. Keeping these in one file means a fix to
// the workflow display (status pill, timestamps, audit fields) lands once and
// shows everywhere.
//
// Exports:
//   - WorkflowStrip      : 4-step indicator pill row + Confirm CTA
//   - DocAuditPanel      : EWB/E-Invoice/Report cross-document mismatch banner
//   - confirmConsignment : promise-based handler that opens a themed dialog,
//                          POSTs /api/consignments/confirm, toasts the result.

import { authedFetch } from '../../lib/authedFetch'
import { openConfirm } from '../ui/ConfirmDialog'

// ── Local format helpers ────────────────────────────────────────────────────
// Kept local because the upstream views each define their own; pulling those
// in would force a circular dep. Only used for tooltips + dialog body text.
const fmt   = (n) => (n != null ? Number(n).toLocaleString('en-IN') : '—')
const fmtWt = (n) => (n != null ? `${Number(n).toFixed(3)}g` : '—')
const fmtTS = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

// ───────────────────────────────────────────────────────────────────────────
// WorkflowStrip — compact 3-step indicator
// ───────────────────────────────────────────────────────────────────────────
//
// Steps: Consignee report → Voucher/Challan → EWB / E-Invoice
//
// Bill confirmation is now auto-stamped at consignment creation (the user
// confirmed twice in the create flow — review modal + 'Yes, create now'
// dialog). A separate strip step would just be a third redundant click.
//
// Each step renders as a pill in one of three states:
//   - done:    green tick + timestamp on hover
//   - active:  gold ring, the only step the user can act on right now
//   - locked:  greyed out — prior step not complete yet
//
// The strip is purely a status indicator; the actions live on the existing
// Report / Voucher / Preview EWB buttons elsewhere in the card. The button
// gating mirrors the strip state via canActOnStep() below.
export function WorkflowStrip({ t, c, isType }) {
  const reported  = !!c.consignee_report_generated_at
  const docMade   = !!(c.issue_voucher_generated_at || c.delivery_challan_generated_at)
  const ewbDone   = !!(c.eway_bill_no || c.irn)

  // First not-done step. Indices after it are locked.
  const activeIdx = !reported ? 0 : !docMade ? 1 : !ewbDone ? 2 : -1

  const steps = [
    { key: 'report',  label: 'Consignee report',  done: reported,  ts: c.consignee_report_generated_at, hint: 'Download the report — operations does this first' },
    {
      key:   'doc',
      label: isType ? 'Issue voucher' : 'Delivery challan',
      done:  docMade,
      ts:    c.issue_voucher_generated_at || c.delivery_challan_generated_at,
      hint:  isType ? 'Download the voucher (unlocks after the report)' : 'Download the challan (unlocks after the report)',
    },
    { key: 'ewb', label: 'EWB / E-Invoice', done: ewbDone, ts: c.ewb_generated_at || c.einvoice_generated_at, hint: 'Accounts: Preview → Confirm → Generate on NIC / IRP' },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginRight: '4px' }}>Workflow</span>
      {steps.map((s, i) => {
        const isActive = i === activeIdx
        const isLocked = !s.done && i > activeIdx
        const tone     = s.done ? t.green : isActive ? t.gold : t.text4
        return (
          <span
            key={s.key}
            title={s.done ? `${s.label} · ${s.ts ? fmtTS(s.ts) : 'done'}` : isActive ? `Next: ${s.hint}` : 'Locked — finish prior steps first'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '3px 9px',
              background: s.done ? `${t.green}12` : isActive ? `${t.gold}12` : 'transparent',
              border: `1px solid ${s.done ? `${t.green}40` : isActive ? `${t.gold}40` : t.border}`,
              borderRadius: '6px',
              fontSize: '10px',
              color: tone,
              fontWeight: s.done || isActive ? 600 : 400,
              opacity: isLocked ? 0.55 : 1,
            }}>
            <span style={{ fontSize: '11px', lineHeight: 1 }}>
              {s.done ? '✓' : isActive ? '◔' : '◌'}
            </span>
            {s.label}
            {i < steps.length - 1 && <span style={{ marginLeft: '4px', color: t.text4, opacity: 0.6 }}>›</span>}
          </span>
        )
      })}
    </div>
  )
}

// Tells the UI whether a given doc-action button is currently allowed.
// Mirrors the backend gate in lib/workflowGate.js so the button can be
// visually disabled with a clear tooltip — users never reach the API just
// to discover they're blocked.
export function canActOnStep(c, step) {
  switch (step) {
    case 'report':
      return { allowed: true, reason: null }
    case 'voucher':
    case 'challan':
      return c.consignee_report_generated_at
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Download the Consignee Report first' }
    case 'preview_ewb':
    case 'preview_einvoice':
      return (c.issue_voucher_generated_at || c.delivery_challan_generated_at)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Download the Voucher / Challan first' }
    default:
      return { allowed: true, reason: null }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// DocAuditPanel — EWB / E-Invoice / Report consistency banner
// ───────────────────────────────────────────────────────────────────────────
//
// Renders inside the Preview modal body. Green tick when all docs agree,
// red mismatch table listing only the diverging fields (EWB / E-Invoice /
// Report side-by-side) when they don't. Pure presentation — the audit data
// itself comes from /api/consignments/document-audit.
export function DocAuditPanel({ t, audit }) {
  const { all_match, discrepancies = [] } = audit || {}
  const allOk  = all_match && discrepancies.length === 0
  const accent = allOk ? t.green : t.red

  const fmtVal = (v) => {
    if (v == null || v === '') return '—'
    if (typeof v === 'number') {
      // Heuristic: weight-looking numbers use 3 decimals, INR uses commas.
      if (Math.abs(v) < 100000 && !Number.isInteger(v)) {
        return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
      }
      return v.toLocaleString('en-IN')
    }
    const s = String(v)
    return s.length > 60 ? s.slice(0, 57) + '…' : s
  }

  return (
    <div style={{
      background: allOk ? `${t.green}10` : `${t.red}10`,
      border: `1px solid ${accent}40`,
      borderRadius: '8px',
      padding: '12px 14px',
      marginBottom: '14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: allOk ? 0 : '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            background: accent, color: '#fff', fontSize: 11, fontWeight: 700,
          }}>{allOk ? '✓' : '!'}</span>
          <span style={{ fontSize: '11px', color: accent, fontWeight: 700, letterSpacing: '.04em' }}>
            {allOk
              ? 'All documents agree'
              : `${discrepancies.length} discrepanc${discrepancies.length === 1 ? 'y' : 'ies'} between EWB / E-Invoice / Report`}
          </span>
        </div>
        <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>cross-doc check</span>
      </div>

      {!allOk && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
            gap: '6px 10px',
            fontSize: '9px', color: t.text4,
            letterSpacing: '.06em', textTransform: 'uppercase',
            paddingBottom: '4px', borderBottom: `1px solid ${t.border}`,
          }}>
            <div>Field</div>
            <div>EWB</div>
            <div>E-Invoice</div>
            <div>Report / Items</div>
          </div>
          {discrepancies.map(d => (
            <div key={d.key} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
              gap: '6px 10px',
              fontSize: '11px',
              padding: '6px 0',
              borderBottom: `1px solid ${t.border}30`,
              alignItems: 'baseline',
            }}>
              <div style={{ color: t.text2, fontWeight: 600 }}>{d.label}</div>
              <div style={{ color: t.text1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(d.ewb)}>{fmtVal(d.ewb)}</div>
              <div style={{ color: t.text1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(d.einvoice)}>{fmtVal(d.einvoice)}</div>
              <div style={{ color: t.text1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(d.report ?? '')}>{d.report != null ? fmtVal(d.report) : '—'}</div>
            </div>
          ))}
          <div style={{ fontSize: '10px', color: t.red, marginTop: '6px', lineHeight: 1.5 }}>
            ⚠ Generation is allowed but the values above will not match across the documents NIC stores. Verify the consignment data before proceeding.
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// confirmConsignment — promise-based confirm flow used by the strip's CTA
// ───────────────────────────────────────────────────────────────────────────
//
// Opens the themed confirm dialog showing bills/weight/value, POSTs to
// /api/consignments/confirm, toasts the outcome, then refreshes the parent
// list. Returns { ok: true|false, message? } so callers can chain.
//
// Caller passes:
//   c          : consignment row
//   onToast    : (message, level) => void  — success / error toasts
//   onRefresh  : () => void                — re-fetch the parent list on success
//
// The caller is responsible for setting/clearing a 'confirming' busy state
// so the strip can dim while the request is in flight (UX) and prevent
// double-fire (correctness).
export async function confirmConsignment(c, { onToast, onRefresh } = {}) {
  const ok = await openConfirm({
    title: c.ops_confirmed_at ? `Re-confirm ${c.tmp_prf_no}?` : `Confirm ${c.tmp_prf_no}?`,
    message: c.ops_confirmed_at
      ? `This consignment was already confirmed on ${fmtTS(c.ops_confirmed_at)}.\n\nRe-confirming refreshes the timestamp but does NOT unlock anything new — proceed only if you re-checked the bill list.`
      : `Lock the bill list for ${c.tmp_prf_no} and unlock the consignee report?\n\nAfter this step, bills can no longer be added or removed without reopening the consignment.\n\n· ${c.total_bills || 0} bills\n· ${fmtWt(c.total_net_wt)} net\n· ₹${fmt(Math.round(c.total_amount || 0))} value`,
    confirmLabel: c.ops_confirmed_at ? 'Re-confirm' : 'Confirm & lock',
  })
  if (!ok) return { ok: false, cancelled: true }

  try {
    const r = await authedFetch('/api/consignments/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ consignment_id: c.id }),
    })
    const j = await r.json()
    if (!r.ok) {
      onToast?.(j.error || 'Confirm failed', 'error')
      return { ok: false, error: j.error }
    }
    onToast?.(j.message || 'Consignment confirmed', 'success')
    onRefresh?.()
    return { ok: true, message: j.message }
  } catch (e) {
    onToast?.(e.message, 'error')
    return { ok: false, error: e.message }
  }
}
