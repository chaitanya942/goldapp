'use client'

// Collection Audit — the at-HO intake workflow that replaces the previous
// manual stock_status flips. Auditor sees two pools of pending bills:
//
//   1. Outstation In-Transit  (grouped by parent consignment / TMP_PRF)
//   2. Bangalore Pending      (KA-Bangalore branches walking goods in)
//
// Clicking a bill opens a modal that asks for the measured gross weight.
// Exact match (0.000g diff) → single "Mark Received" button.
// Any diff at all → discrepancy warning + two paths: accept with mandatory
// remark, or "Keep Pending" to write the audit fields without flipping
// stock_status. When the last in_consignment bill of a consignment is
// received, the consignment auto-flips to status='received'.

import { useState, useEffect, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtAge  = (d) => {
  if (!d) return '—'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 0) return 'just now'
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `${days}d`
  const hrs = Math.floor(ms / 3600000)
  if (hrs >= 1)  return `${hrs}h`
  const mins = Math.max(1, Math.floor(ms / 60000))
  return `${mins}m`
}

export default function CollectionAudit() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [loading,     setLoading]     = useState(true)
  const [bangalore,   setBangalore]   = useState([])
  const [outstation,  setOutstation]  = useState([])    // [{ consignment, bills: [] }, ...]
  const [activeBill,  setActiveBill]  = useState(null)  // bill the audit modal is open for
  const [search,      setSearch]      = useState('')
  const [toast,       setToast]       = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const res = await authedFetch('/api/collection-audit')
    const j   = await res.json()
    if (!res.ok || j.error) {
      setToast({ msg: j.error || 'Failed to load audit queue', type: 'error' })
      setLoading(false)
      return
    }
    setBangalore(j.bangalore || [])
    setOutstation(j.outstation || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Search filter — applied client-side. Matches against application_id,
  // customer name, and (for outstation) the parent consignment's TMP_PRF.
  const q = search.trim().toLowerCase()
  const matchesQuery = (bill) =>
    !q
    || (bill.application_id  || '').toLowerCase().includes(q)
    || (bill.customer_name   || '').toLowerCase().includes(q)
    || (bill.branch_name     || '').toLowerCase().includes(q)

  const filteredBangalore  = bangalore.filter(matchesQuery)
  const filteredOutstation = outstation
    .map(g => ({
      consignment: g.consignment,
      bills:       g.bills.filter(b =>
        matchesQuery(b)
        || (g.consignment?.tmp_prf_no || '').toLowerCase().includes(q)
        || (g.consignment?.challan_no || '').toLowerCase().includes(q)),
    }))
    .filter(g => g.bills.length > 0)

  // Totals — quick read of "what's pending audit overall" for the header band.
  const totalBangaloreBills    = bangalore.length
  const totalOutstationBills   = outstation.reduce((s, g) => s + g.bills.length, 0)
  const totalOutstationConsign = outstation.length
  const totalNetWt = [...bangalore, ...outstation.flatMap(g => g.bills)]
    .reduce((s, b) => s + Number(b.net_weight || 0), 0)
  const totalValue = [...bangalore, ...outstation.flatMap(g => g.bills)]
    .reduce((s, b) => s + Number(b.total_amount || 0), 0)

  // ── Styles ──
  const s = {
    wrap:       { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1400px', margin: '0 auto' },
    title:      { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:        { fontSize: '11px', color: t.text3 },
    card:       { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    section:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    secHeader:  { padding: '12px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px' },
    badge:      (color) => ({ fontSize: '9px', color, background: `${color}18`, borderRadius: '5px', padding: '4px 9px', fontWeight: 700, letterSpacing: '.08em' }),
    th:         { padding: '9px 12px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' },
    td:         { padding: '9px 12px', fontSize: '12px', color: t.text2, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    btnGold:    { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' },
    btnOut:     { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '11px', color: t.text3, cursor: 'pointer' },
    input:      { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 12px', color: t.text1, fontSize: '12px', outline: 'none', width: '320px' },
  }

  return (
    <div style={s.wrap}>
      {toast && <Toast key={toast.key || Date.now()} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>Collection Audit</div>
          <div style={{ ...s.sub, marginTop: '2px' }}>
            Weigh each inbound bill on arrival. Match against CRM gross or flag a discrepancy.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            style={s.input}
            placeholder="Search app ID, customer, branch, TMP_PRF…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button onClick={fetchAll} style={s.btnOut}>Refresh</button>
        </div>
      </div>

      {/* KPI band */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1px', background: t.border, borderRadius: '12px', overflow: 'hidden' }}>
        <Kpi t={t} label="Outstation consignments" primary={totalOutstationConsign} sub={`${totalOutstationBills} bill${totalOutstationBills === 1 ? '' : 's'}`} accent={t.orange} />
        <Kpi t={t} label="Bangalore bills"          primary={totalBangaloreBills}    sub="pending at HO"                   accent={t.gold} />
        <Kpi t={t} label="Total net wt pending"     primary={fmtWt(totalNetWt)}      sub="across both pools"               accent={t.blue} mono />
        <Kpi t={t} label="Total value pending"      primary={`₹${fmt(Math.round(totalValue))}`} sub="across both pools" accent={t.green} mono />
      </div>

      {/* Loading */}
      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : (
        <>
          {/* ─── Outstation section ─── */}
          <div style={s.section}>
            <div style={s.secHeader}>
              <span style={s.badge(t.orange)}>OUTSTATION</span>
              <div>
                <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>In-Transit Consignments</div>
                <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                  {filteredOutstation.length} consignment{filteredOutstation.length === 1 ? '' : 's'} · {filteredOutstation.reduce((s, g) => s + g.bills.length, 0)} bill{filteredOutstation.reduce((s, g) => s + g.bills.length, 0) === 1 ? '' : 's'} awaiting weight check
                </div>
              </div>
            </div>
            {filteredOutstation.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>
                {q ? 'No outstation bills match the search.' : 'No outstation consignments are currently in transit.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: t.card2 || t.card }}>
                      <th style={s.th}>App ID</th>
                      <th style={s.th}>Customer</th>
                      <th style={s.th}>Source</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>CRM Gross</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Net Wt</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Value</th>
                      <th style={s.th}>Dispatched</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOutstation.map(group => (
                      <Fragment key={group.consignment.id}>
                        <tr>
                          <td colSpan={9} style={{ padding: '10px 14px', background: `${t.orange}10`, borderTop: `1px solid ${t.border}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                              <span style={{ ...s.badge(t.gold), letterSpacing: '.05em' }}>{group.consignment.tmp_prf_no || '—'}</span>
                              <span style={{ fontSize: '11px', color: t.text2 }}>
                                {group.consignment.branch_name} <span style={{ color: t.text4 }}>→</span> {group.consignment.movement_type === 'INTERNAL' ? group.consignment.dest_branch : 'HO'}
                              </span>
                              <span style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace' }}>{group.consignment.challan_no}</span>
                              <span style={{ marginLeft: 'auto', fontSize: '10px', color: t.text3 }}>
                                <strong style={{ color: t.text2 }}>{group.bills.length}</strong> bill{group.bills.length === 1 ? '' : 's'} · <strong style={{ color: t.gold, fontFamily: 'monospace' }}>{fmtWt(group.consignment.total_gross_wt)}</strong> gross
                              </span>
                            </div>
                          </td>
                        </tr>
                        {group.bills.map(bill => <BillRow key={bill.id} bill={bill} s={s} t={t} onAudit={() => setActiveBill(bill)} />)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ─── Bangalore section ─── */}
          <div style={s.section}>
            <div style={s.secHeader}>
              <span style={s.badge(t.gold)}>BANGALORE</span>
              <div>
                <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>Pending at HO</div>
                <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                  {filteredBangalore.length} bill{filteredBangalore.length === 1 ? '' : 's'} from Bangalore branches walking in for intake
                </div>
              </div>
            </div>
            {filteredBangalore.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>
                {q ? 'No Bangalore bills match the search.' : 'No Bangalore bills currently pending.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: t.card2 || t.card }}>
                      <th style={s.th}>App ID</th>
                      <th style={s.th}>Customer</th>
                      <th style={s.th}>Branch</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>CRM Gross</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Net Wt</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Value</th>
                      <th style={s.th}>Purchase Date</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBangalore.map(bill => <BillRow key={bill.id} bill={bill} s={s} t={t} onAudit={() => setActiveBill(bill)} bangaloreFlavour />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Audit modal ─── */}
      {activeBill && createPortal(
        <AuditModal
          bill={activeBill}
          t={t}
          onClose={() => setActiveBill(null)}
          onDone={(msg) => { setToast({ msg, type: 'success', key: Date.now() }); setActiveBill(null); fetchAll() }}
          onError={(msg) => setToast({ msg, type: 'error', key: Date.now() })}
        />,
        document.body,
      )}
    </div>
  )
}

function BillRow({ bill, s, t, onAudit, bangaloreFlavour }) {
  const hasDiscrepancy = bill.audit_gross_weight != null && Number(bill.audit_discrepancy_g || 0) !== 0
  const dateField = bangaloreFlavour ? bill.purchase_date : bill.dispatched_at
  return (
    <tr style={{ background: hasDiscrepancy ? `${t.red}06` : 'transparent' }}>
      <td style={{ ...s.td, color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{bill.application_id}</td>
      <td style={s.td}>{bill.customer_name || '—'}</td>
      <td style={s.td}>{bill.branch_name}</td>
      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold }}>{fmtWt(bill.gross_weight)}</td>
      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(bill.net_weight)}</td>
      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.green }}>₹{fmt(Math.round(bill.total_amount || 0))}</td>
      <td style={{ ...s.td, color: t.text3, fontSize: '11px' }}>
        {fmtDate(dateField)} <span style={{ color: t.text4 }}>· {fmtAge(dateField)} old</span>
      </td>
      <td style={{ ...s.td }}>
        {hasDiscrepancy ? (
          <span style={{ fontSize: '10px', color: t.red, background: `${t.red}18`, borderRadius: '4px', padding: '2px 6px', fontFamily: 'monospace', fontWeight: 700 }}>
            Discrepancy {Number(bill.audit_discrepancy_g) > 0 ? '+' : ''}{Number(bill.audit_discrepancy_g).toFixed(3)}g
          </span>
        ) : bill.audit_gross_weight != null ? (
          <span style={{ fontSize: '10px', color: t.green, background: `${t.green}18`, borderRadius: '4px', padding: '2px 6px', fontWeight: 700 }}>
            Audited (pending)
          </span>
        ) : (
          <span style={{ fontSize: '10px', color: t.text4 }}>Pending</span>
        )}
      </td>
      <td style={{ ...s.td, textAlign: 'right' }}>
        <button onClick={onAudit} style={s.btnGold}>
          {bill.audit_gross_weight != null ? 'Re-audit' : 'Enter weight'}
        </button>
      </td>
    </tr>
  )
}

function AuditModal({ bill, t, onClose, onDone, onError }) {
  const crmGross = Number(bill.gross_weight || 0)
  const [weight, setWeight] = useState(bill.audit_gross_weight != null ? String(bill.audit_gross_weight) : '')
  const [remark, setRemark] = useState(bill.audit_remark || '')
  const [busy,   setBusy]   = useState(false)

  const measured = parseFloat(weight)
  const valid    = Number.isFinite(measured) && measured > 0
  const diff     = valid ? Number((measured - crmGross).toFixed(3)) : null
  const exact    = diff === 0
  const showDiscrepancy = valid && !exact

  async function run(action) {
    if (!valid) { onError('Enter a valid measured gross weight'); return }
    if (showDiscrepancy && action === 'receive' && !remark.trim()) {
      onError('Discrepancy detected — add a remark before accepting.')
      return
    }
    setBusy(true)
    try {
      const res = await authedFetch('/api/collection-audit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          purchase_id:        bill.id,
          audit_gross_weight: measured,
          action,
          remark:             remark.trim() || null,
        }),
      })
      const j = await res.json()
      if (!res.ok || j.error) { onError(j.error || 'Audit action failed'); return }
      if (action === 'receive') {
        const tail = j.consignment_received ? ' · Parent consignment also marked received.' : ''
        onDone(`${bill.application_id} received at HO.${tail}`)
      } else {
        onDone(`${bill.application_id} kept pending (discrepancy ${diff > 0 ? '+' : ''}${diff}g recorded).`)
      }
    } finally { setBusy(false) }
  }

  // ── Styles ──
  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', maxWidth: '520px', width: '100%', overflow: 'hidden' }
  const label   = { fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }
  const input   = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 14px', fontSize: '15px', color: t.text1, fontFamily: 'monospace', outline: 'none', width: '100%', boxSizing: 'border-box' }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Audit Bill</div>
          <div style={{ fontSize: '20px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, marginTop: '4px' }}>{bill.application_id}</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '2px' }}>
            {bill.customer_name} · {bill.branch_name}
          </div>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* CRM gross — what we're matching against */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={label}>CRM Gross Weight</div>
            <div style={{ fontSize: '20px', color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>{fmtWt(crmGross)}</div>
          </div>

          {/* Measured weight input */}
          <div>
            <div style={{ ...label, marginBottom: '6px' }}>Measured Gross Weight (g)</div>
            <input
              type="number"
              step="0.001"
              autoFocus
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="e.g. 12.345"
              style={input}
            />
          </div>

          {/* Diff feedback */}
          {valid && (
            <div style={{
              padding: '12px 14px',
              borderRadius: '8px',
              background: exact ? `${t.green}12` : `${t.red}12`,
              border:     `1px solid ${exact ? t.green : t.red}40`,
              fontSize:   '12px',
              color:      exact ? t.green : t.red,
              fontWeight: 600,
            }}>
              {exact
                ? <>Exact match — measured weight equals CRM ({fmtWt(crmGross)}).</>
                : <>Discrepancy: <strong style={{ fontFamily: 'monospace' }}>{diff > 0 ? '+' : ''}{diff.toFixed(3)}g</strong> ({measured > crmGross ? 'measured more' : 'measured less'}). Provide a remark to accept and mark received, or keep pending.</>}
            </div>
          )}

          {/* Remark — shown only on discrepancy */}
          {showDiscrepancy && (
            <div>
              <div style={{ ...label, marginBottom: '6px' }}>Audit Remark <span style={{ color: t.red, textTransform: 'none', letterSpacing: 'normal' }}>(required to accept the discrepancy)</span></div>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="Why is there a difference? e.g. stones in casing, packing residue, etc."
                rows={2}
                style={{ ...input, fontFamily: 'inherit', fontSize: '13px', resize: 'vertical' }}
              />
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: `1px solid ${t.border}`, background: t.card2 || t.card, display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 16px', fontSize: '12px', color: t.text3, cursor: 'pointer' }}>Cancel</button>
          {showDiscrepancy && (
            <button onClick={() => run('keep_pending')} disabled={busy || !valid}
              style={{ background: 'transparent', border: `1px solid ${t.orange}60`, borderRadius: '8px', padding: '8px 16px', fontSize: '12px', color: t.orange, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
              Keep Pending
            </button>
          )}
          <button onClick={() => run('receive')} disabled={busy || !valid || (showDiscrepancy && !remark.trim())}
            style={{ background: t.green, color: '#0a0a0a', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: (busy || !valid || (showDiscrepancy && !remark.trim())) ? .5 : 1 }}>
            {busy ? 'Saving…' : exact ? 'Mark Received' : 'Accept & Mark Received'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Kpi({ t, label, primary, sub, accent, mono }) {
  return (
    <div style={{ background: t.card, padding: '16px 18px 18px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent || t.text3, opacity: .55 }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', color: accent || t.text1, fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit', lineHeight: 1.1, letterSpacing: '-.015em' }}>{primary}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '8px' }}>{sub}</div>}
    </div>
  )
}
