'use client'

// Audit Data — the at-HO intake workflow that replaces the previous manual
// stock_status flips. Auditor sees two pools of pending bills:
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

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

// Returns { label, color, bg } for age-coloured badges. Mirrors the urgency
// ramp used elsewhere so visual cues stay consistent across modules.
function ageBadge(d, t) {
  if (!d) return { label: '—', color: t.text4, bg: 'transparent' }
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 0) return { label: 'just now', color: t.green, bg: `${t.green}15` }
  const days = Math.floor(ms / 86400000)
  let label
  if (days >= 1)   label = `${days}d old`
  else {
    const hrs  = Math.floor(ms / 3600000)
    if (hrs >= 1)  label = `${hrs}h old`
    else { const mins = Math.max(1, Math.floor(ms / 60000)); label = `${mins}m old` }
  }
  const color = days < 1   ? t.green
              : days < 3   ? t.gold
              : days < 7   ? t.orange
              :              t.red
  return { label, color, bg: `${color}18` }
}

export default function CollectionAudit() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [loading,     setLoading]     = useState(true)
  const [bangalore,   setBangalore]   = useState([])
  const [outstation,  setOutstation]  = useState([])    // [{ consignment, bills: [] }, ...]
  const [activeBill,  setActiveBill]  = useState(null)
  const [search,      setSearch]      = useState('')
  const [filterBranch,setFilterBranch] = useState('')
  const [filterAge,   setFilterAge]   = useState('')   // '' | '0-3d' | '3-7d' | '7d+'
  const [tab,         setTab]         = useState('pending') // 'pending' | 'discrepancies'
  const [toast,       setToast]       = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const res = await authedFetch('/api/collection-audit')
    const j   = await res.json()
    if (!res.ok || j.error) {
      setToast({ msg: j.error || 'Failed to load audit queue', type: 'error', key: Date.now() })
      setLoading(false)
      return
    }
    setBangalore(j.bangalore || [])
    setOutstation(j.outstation || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Derived ─────────────────────────────────────────────────────────────
  const allBills = useMemo(
    () => [...bangalore, ...outstation.flatMap(g => g.bills)],
    [bangalore, outstation],
  )
  const branchOptions = useMemo(
    () => [...new Set(allBills.map(b => b.branch_name).filter(Boolean))].sort(),
    [allBills],
  )

  const q = search.trim().toLowerCase()
  const matchesQuery = (bill) =>
    !q
    || (bill.application_id  || '').toLowerCase().includes(q)
    || (bill.customer_name   || '').toLowerCase().includes(q)
    || (bill.branch_name     || '').toLowerCase().includes(q)

  const matchesBranch = (bill) => !filterBranch || bill.branch_name === filterBranch

  const matchesAge = (bill, dateField) => {
    if (!filterAge) return true
    if (!bill[dateField]) return false
    const days = Math.floor((Date.now() - new Date(bill[dateField]).getTime()) / 86400000)
    if (filterAge === '0-3d') return days < 3
    if (filterAge === '3-7d') return days >= 3 && days < 7
    if (filterAge === '7d+')  return days >= 7
    return true
  }

  const matchesTab = (bill) => {
    if (tab === 'discrepancies') {
      return bill.audit_gross_weight != null && Number(bill.audit_discrepancy_g || 0) !== 0
    }
    return true
  }

  // Apply all filters to each pool. For Bangalore the age field is
  // purchase_date; for Outstation it's the consignment's dispatched_at.
  const filteredBangalore = bangalore.filter(b =>
    matchesQuery(b) && matchesBranch(b) && matchesAge(b, 'purchase_date') && matchesTab(b))

  const filteredOutstation = outstation
    .map(g => ({
      consignment: g.consignment,
      bills:       g.bills.filter(b =>
        matchesQuery(b) && matchesBranch(b) && matchesTab(b)
        && (filterAge ? matchesAge(g.consignment, 'dispatched_at') : true)),
    }))
    .filter(g => g.bills.length > 0)

  // KPI totals (shown in header band — count what's currently visible).
  const visibleBills = [...filteredBangalore, ...filteredOutstation.flatMap(g => g.bills)]
  const kpis = {
    consignments: filteredOutstation.length,
    bills:        visibleBills.length,
    netWt:        visibleBills.reduce((s, b) => s + Number(b.net_weight || 0), 0),
    value:        visibleBills.reduce((s, b) => s + Number(b.total_amount || 0), 0),
    discrepancies: allBills.filter(b => b.audit_gross_weight != null && Number(b.audit_discrepancy_g || 0) !== 0).length,
  }

  // ── Styles ──
  const s = {
    wrap:      { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1400px', margin: '0 auto' },
    title:     { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:       { fontSize: '11px', color: t.text3 },
    card:      { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    badge:     (color) => ({ fontSize: '9px', color, background: `${color}18`, borderRadius: '5px', padding: '4px 9px', fontWeight: 700, letterSpacing: '.08em' }),
    th:        { padding: '10px 12px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' },
    td:        { padding: '11px 12px', fontSize: '12px', color: t.text2, borderBottom: `1px solid ${t.border}25`, whiteSpace: 'nowrap', verticalAlign: 'middle' },
    btnGold:   { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em' },
    btnOut:    { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', color: t.text3, cursor: 'pointer' },
    input:     { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 12px', color: t.text1, fontSize: '12px', outline: 'none' },
    select:    { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 10px', color: t.text1, fontSize: '12px', cursor: 'pointer', outline: 'none' },
  }

  return (
    <div style={s.wrap}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>Audit Data</div>
          <div style={{ ...s.sub, marginTop: '2px' }}>
            Weigh each inbound bill on arrival. Match against CRM gross or flag a discrepancy.
          </div>
        </div>
        <button onClick={fetchAll} style={s.btnOut}>⟳ Refresh</button>
      </div>

      {/* KPI band */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1px', background: t.border, borderRadius: '12px', overflow: 'hidden', boxShadow: `0 1px 3px ${t.border}50` }}>
        <Kpi t={t} label="Outstation consignments" primary={kpis.consignments}                  sub="awaiting weight check" accent={t.orange} />
        <Kpi t={t} label="Bangalore bills"          primary={filteredBangalore.length}           sub="walking in for intake"  accent={t.gold} />
        <Kpi t={t} label="Total bills visible"      primary={kpis.bills}                         sub="across both pools"      accent={t.text2} />
        <Kpi t={t} label="Net weight pending"       primary={fmtWt(kpis.netWt)}                  sub="against CRM gross"      accent={t.blue} mono />
        <Kpi t={t} label="Value pending"            primary={`₹${fmt(Math.round(kpis.value))}`}  sub="at risk in pipeline"    accent={t.green} mono />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}`, marginTop: '-2px', flexWrap: 'wrap' }}>
        {[
          { id: 'pending',       label: 'Pending',                 color: t.gold,    badge: kpis.bills },
          { id: 'discrepancies', label: 'Discrepancies (kept pending)', color: t.red, badge: kpis.discrepancies },
        ].map(o => {
          const active = tab === o.id
          return (
            <button key={o.id} onClick={() => setTab(o.id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                color: active ? o.color : t.text3,
                borderBottom: `2px solid ${active ? o.color : 'transparent'}`,
                marginBottom: '-1px',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}>
              {o.label}
              {o.badge > 0 && (
                <span style={{ background: `${o.color}25`, color: o.color, fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '99px', fontFamily: 'monospace', minWidth: '18px', textAlign: 'center' }}>
                  {o.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filter strip */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...s.input, flex: '1 1 280px', minWidth: '240px' }}
          placeholder="Search app ID, customer, branch, TMP_PRF…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={s.select} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
          <option value="">All Branches</option>
          {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select style={s.select} value={filterAge} onChange={e => setFilterAge(e.target.value)}>
          <option value="">Any age</option>
          <option value="0-3d">0–3 days</option>
          <option value="3-7d">3–7 days</option>
          <option value="7d+">7+ days</option>
        </select>
        {(search || filterBranch || filterAge) && (
          <button onClick={() => { setSearch(''); setFilterBranch(''); setFilterAge('') }}
            style={{ ...s.btnOut, color: t.red, borderColor: `${t.red}40` }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : (
        <>
          {/* ─── Outstation section ─── */}
          <Section t={t} s={s} accent={t.orange} badge="OUTSTATION" title="In-Transit Consignments"
            subtitle={`${filteredOutstation.length} consignment${filteredOutstation.length === 1 ? '' : 's'} · ${filteredOutstation.reduce((sum, g) => sum + g.bills.length, 0)} bill${filteredOutstation.reduce((sum, g) => sum + g.bills.length, 0) === 1 ? '' : 's'} awaiting weight check`}>
            {filteredOutstation.length === 0 ? (
              <EmptyRow t={t} text={q || filterBranch || filterAge ? 'No outstation bills match the current filters.' : 'No outstation consignments are currently in transit.'} />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: t.card2 || t.card }}>
                  <th style={s.th}>App ID</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Source</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>CRM Gross</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Value</th>
                  <th style={s.th}>Dispatched</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}></th>
                </tr></thead>
                <tbody>
                  {filteredOutstation.map(group => (
                    <Fragment key={group.consignment.id}>
                      <tr>
                        <td colSpan={9} style={{ padding: '10px 14px', background: `${t.orange}10`, borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}25` }}>
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
                      {group.bills.map(bill => <BillRow key={bill.id} bill={bill} s={s} t={t} onAudit={() => setActiveBill(bill)} dateField="dispatched_at" />)}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* ─── Bangalore section ─── */}
          <Section t={t} s={s} accent={t.gold} badge="BANGALORE" title="Pending at HO"
            subtitle={`${filteredBangalore.length} bill${filteredBangalore.length === 1 ? '' : 's'} from Bangalore branches walking in for intake`}>
            {filteredBangalore.length === 0 ? (
              <EmptyRow t={t} text={q || filterBranch || filterAge ? 'No Bangalore bills match the current filters.' : 'No Bangalore bills currently pending.'} />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: t.card2 || t.card }}>
                  <th style={s.th}>App ID</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Branch</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>CRM Gross</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Value</th>
                  <th style={s.th}>Purchase Date</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}></th>
                </tr></thead>
                <tbody>
                  {filteredBangalore.map(bill => <BillRow key={bill.id} bill={bill} s={s} t={t} onAudit={() => setActiveBill(bill)} dateField="purchase_date" />)}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}

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

function Section({ t, s, accent, badge, title, subtitle, children }) {
  return (
    <div style={{ ...s.card, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={s.badge(accent)}>{badge}</span>
        <div>
          <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  )
}

function EmptyRow({ t, text }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>
      {text}
    </div>
  )
}

function BillRow({ bill, s, t, onAudit, dateField }) {
  const audited        = bill.audit_gross_weight != null
  const discrepancy    = audited ? Number(bill.audit_discrepancy_g || 0) : 0
  const hasDiscrepancy = audited && discrepancy !== 0
  const age            = ageBadge(bill[dateField], t)
  return (
    <tr style={{
      background:    hasDiscrepancy ? `${t.red}06` : 'transparent',
      transition:    'background .12s ease',
    }}
      onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
      onMouseLeave={e => e.currentTarget.style.background = hasDiscrepancy ? `${t.red}06` : 'transparent'}>
      <td style={{ ...s.td, color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{bill.application_id}</td>
      <td style={s.td}>{bill.customer_name || '—'}</td>
      <td style={s.td}>{bill.branch_name}</td>
      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtWt(bill.gross_weight)}</td>
      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(bill.net_weight)}</td>
      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.green, fontWeight: 600 }}>₹{fmt(Math.round(bill.total_amount || 0))}</td>
      <td style={{ ...s.td, color: t.text3, fontSize: '11px' }}>
        <div>{fmtDate(bill[dateField])}</div>
        <span style={{ fontSize: '9px', color: age.color, background: age.bg, borderRadius: '4px', padding: '1px 6px', fontWeight: 700, marginTop: '2px', display: 'inline-block' }}>{age.label}</span>
      </td>
      <td style={s.td}>
        {hasDiscrepancy ? (
          <span style={{ fontSize: '10px', color: t.red, background: `${t.red}18`, borderRadius: '4px', padding: '2px 7px', fontFamily: 'monospace', fontWeight: 700 }}>
            ⚠ {discrepancy > 0 ? '+' : ''}{discrepancy.toFixed(3)}g
          </span>
        ) : audited ? (
          <span style={{ fontSize: '10px', color: t.green, background: `${t.green}18`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700 }}>
            ✓ Audited
          </span>
        ) : (
          <span style={{ fontSize: '10px', color: t.text4, background: `${t.text4}10`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>
            Pending
          </span>
        )}
      </td>
      <td style={{ ...s.td, textAlign: 'right' }}>
        <button onClick={onAudit} style={{ ...s.btnGold, background: audited ? t.orange : t.gold, color: audited ? '#fff' : '#1a0a00' }}>
          {audited ? 'Re-audit' : 'Enter weight'}
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

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', maxWidth: '540px', width: '100%', overflow: 'hidden', boxShadow: `0 12px 48px rgba(0,0,0,.6)` }
  const label   = { fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }
  const input   = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px', fontSize: '16px', color: t.text1, fontFamily: 'monospace', outline: 'none', width: '100%', boxSizing: 'border-box' }

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={label}>CRM Gross Weight</div>
            <div style={{ fontSize: '22px', color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>{fmtWt(crmGross)}</div>
          </div>

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

          {valid && (
            <div style={{
              padding: '14px 16px',
              borderRadius: '10px',
              background: exact ? `${t.green}12` : `${t.red}12`,
              border:     `1px solid ${exact ? t.green : t.red}40`,
              fontSize:   '12px',
              color:      exact ? t.green : t.red,
              fontWeight: 600,
            }}>
              {exact ? (
                <>✓ <strong>Exact match.</strong> Measured weight equals CRM ({fmtWt(crmGross)}).</>
              ) : (
                <>⚠ <strong>Discrepancy: {diff > 0 ? '+' : ''}{diff.toFixed(3)}g</strong> ({measured > crmGross ? 'measured more than CRM' : 'measured less than CRM'}). Provide a remark to accept and mark received, or keep pending for re-weighing.</>
              )}
            </div>
          )}

          {showDiscrepancy && (
            <div>
              <div style={{ ...label, marginBottom: '6px' }}>Audit Remark <span style={{ color: t.red, textTransform: 'none', letterSpacing: 'normal' }}>(required to accept)</span></div>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="Why is there a difference? e.g. stones in casing, packing residue, scale calibration drift…"
                rows={2}
                style={{ ...input, fontFamily: 'inherit', fontSize: '13px', resize: 'vertical' }}
              />
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: `1px solid ${t.border}`, background: t.card2 || t.card, display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '9px 18px', fontSize: '12px', color: t.text3, cursor: 'pointer' }}>Cancel</button>
          {showDiscrepancy && (
            <button onClick={() => run('keep_pending')} disabled={busy || !valid}
              style={{ background: 'transparent', border: `1px solid ${t.orange}80`, borderRadius: '8px', padding: '9px 18px', fontSize: '12px', color: t.orange, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
              Keep Pending
            </button>
          )}
          <button onClick={() => run('receive')} disabled={busy || !valid || (showDiscrepancy && !remark.trim())}
            style={{ background: t.green, color: '#0a0a0a', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: (busy || !valid || (showDiscrepancy && !remark.trim())) ? .5 : 1 }}>
            {busy ? 'Saving…' : exact ? 'Mark Received' : 'Accept & Mark Received'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Kpi({ t, label, primary, sub, accent, mono }) {
  return (
    <div style={{ background: t.card, padding: '16px 18px 18px', position: 'relative', transition: 'background .18s ease' }}
      onMouseEnter={e => e.currentTarget.style.background = `${accent || t.text3}08`}
      onMouseLeave={e => e.currentTarget.style.background = t.card}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent || t.text3, opacity: .55 }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', color: accent || t.text1, fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit', lineHeight: 1.1, letterSpacing: '-.015em' }}>{primary}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '8px' }}>{sub}</div>}
    </div>
  )
}
