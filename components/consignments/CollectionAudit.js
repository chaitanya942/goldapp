'use client'

// Audit Data — blind-audit workflow for HO intake.
//
// Two-level drill-down:
//   Level 0  Branch cards (two pools: Outstation in-transit, Bangalore pending).
//            Each card shows bill count + oldest-age badge. NO weights, NO values.
//   Level 1  Bills from the selected branch. Bare-minimum identity columns
//            (App ID, Customer, Purchase Date, Age). NO weights, NO values.
//
// Blind audit modal: auditor types the measured gross weight on the scale and
// hits Submit. The CRM gross is NEVER revealed in the queue or in the modal
// pre-submission — it surfaces only in the POST response, AFTER the auditor
// has committed their reading. This makes rubber-stamping ("read CRM number,
// type it in, click match") structurally impossible.
//
// If the first submission is an exact match → bill is auto-marked received,
// modal closes with a ✓ toast.
// If it's a discrepancy → the POST returns 400 with crm_gross + measured +
// discrepancy_g revealed; modal flips into "discrepancy mode": shows the
// comparison, requires an audit remark, lets the auditor pick
// Accept & Mark Received  OR  Keep Pending for follow-up.

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmt    = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt  = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate= (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

function ageBadge(d, t) {
  if (!d) return { label: '—', color: t.text4, bg: 'transparent' }
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 0) return { label: 'just now', color: t.green, bg: `${t.green}15` }
  const days = Math.floor(ms / 86400000)
  let label
  if (days >= 1) label = `${days}d old`
  else {
    const hrs = Math.floor(ms / 3600000)
    if (hrs >= 1) label = `${hrs}h old`
    else { const mins = Math.max(1, Math.floor(ms / 60000)); label = `${mins}m old` }
  }
  const color = days < 1 ? t.green : days < 3 ? t.gold : days < 7 ? t.orange : t.red
  return { label, color, bg: `${color}18` }
}

function oldestAge(items, dateField) {
  if (!items.length) return null
  return items.reduce((min, b) => {
    const d = b[dateField] ? new Date(b[dateField]).getTime() : Infinity
    return d < min ? d : min
  }, Infinity)
}

export default function CollectionAudit() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [loading,    setLoading]    = useState(true)
  const [bangalore,  setBangalore]  = useState([])
  const [outstation, setOutstation] = useState([])    // [{ consignment, bills: [] }, ...]
  const [activeBill, setActiveBill] = useState(null)
  const [drillBranch, setDrillBranch] = useState(null) // { name, pool: 'outstation' | 'bangalore' } | null
  const [toast,      setToast]      = useState(null)

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

  // ── Aggregate bills by source branch for the Level-0 cards ──
  const outstationByBranch = useMemo(() => {
    const m = new Map()
    for (const g of outstation) {
      const branchName = g.consignment?.branch_name || '—'
      if (!m.has(branchName)) {
        m.set(branchName, { branch: branchName, region: null, consignments: [], bills: [] })
      }
      const entry = m.get(branchName)
      entry.consignments.push(g.consignment)
      entry.bills.push(...g.bills.map(b => ({ ...b, _consignment: g.consignment })))
    }
    return [...m.values()].sort((a, b) => {
      const aT = oldestAge(a.consignments, 'dispatched_at') ?? Infinity
      const bT = oldestAge(b.consignments, 'dispatched_at') ?? Infinity
      return aT - bT
    })
  }, [outstation])

  const bangaloreByBranch = useMemo(() => {
    const m = new Map()
    for (const b of bangalore) {
      const key = b.branch_name || '—'
      if (!m.has(key)) m.set(key, { branch: key, bills: [] })
      m.get(key).bills.push(b)
    }
    return [...m.values()].sort((a, b) => {
      const aT = oldestAge(a.bills, 'purchase_date') ?? Infinity
      const bT = oldestAge(b.bills, 'purchase_date') ?? Infinity
      return aT - bT
    })
  }, [bangalore])

  // KPI counts only — no weights, no values (blind-audit rule).
  const kpis = {
    outstationBranches: outstationByBranch.length,
    outstationBills:    outstationByBranch.reduce((s, b) => s + b.bills.length, 0),
    bangaloreBranches:  bangaloreByBranch.length,
    bangaloreBills:     bangaloreByBranch.reduce((s, b) => s + b.bills.length, 0),
    discrepancies:      [...bangalore, ...outstation.flatMap(g => g.bills)]
                          .filter(b => b.audit_gross_weight != null).length,
  }

  // ── Styles ──
  const s = {
    wrap:      { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1400px', margin: '0 auto' },
    title:     { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:       { fontSize: '11px', color: t.text3 },
    card:      { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    badge:     (color) => ({ fontSize: '9px', color, background: `${color}18`, borderRadius: '5px', padding: '4px 9px', fontWeight: 700, letterSpacing: '.08em' }),
    th:        { padding: '11px 14px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' },
    td:        { padding: '12px 14px', fontSize: '12px', color: t.text2, borderBottom: `1px solid ${t.border}25`, whiteSpace: 'nowrap', verticalAlign: 'middle' },
    btnGold:   { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '8px 16px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em' },
    btnOut:    { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', color: t.text3, cursor: 'pointer' },
  }

  return (
    <div style={s.wrap}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>Audit Data</div>
          <div style={{ ...s.sub, marginTop: '2px' }}>
            Drill into a branch, weigh each inbound bill, and match against CRM gross — blind.
          </div>
        </div>
        <button onClick={fetchAll} style={s.btnOut}>⟳ Refresh</button>
      </div>

      {/* KPI band — counts only, no weights/values (blind-audit guarantee) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1px', background: t.border, borderRadius: '12px', overflow: 'hidden' }}>
        <Kpi t={t} label="Outstation branches" primary={kpis.outstationBranches} sub={`${kpis.outstationBills} bill${kpis.outstationBills === 1 ? '' : 's'} pending`} accent={t.orange} />
        <Kpi t={t} label="Bangalore branches"  primary={kpis.bangaloreBranches}  sub={`${kpis.bangaloreBills} bill${kpis.bangaloreBills === 1 ? '' : 's'} pending`}  accent={t.gold} />
        <Kpi t={t} label="Total branches"      primary={kpis.outstationBranches + kpis.bangaloreBranches} sub="awaiting audit" accent={t.text2} />
        <Kpi t={t} label="Discrepancy follow-ups" primary={kpis.discrepancies} sub="audited & kept pending" accent={t.red} />
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : drillBranch ? (
        <BranchDrilldown
          drill={drillBranch}
          outstationByBranch={outstationByBranch}
          bangaloreByBranch={bangaloreByBranch}
          t={t}
          s={s}
          onBack={() => setDrillBranch(null)}
          onAudit={(bill) => setActiveBill(bill)}
        />
      ) : (
        <>
          {/* ─── Outstation branch cards ─── */}
          <BranchGrid
            t={t}
            s={s}
            title="Outstation — Branches In Transit"
            subtitle="Bills currently in_consignment, grouped by source branch."
            accent={t.orange}
            badge="OUTSTATION"
            empty="No outstation consignments are currently in transit."
            branches={outstationByBranch.map(b => ({
              branch:        b.branch,
              billCount:     b.bills.length,
              extraLabel:    `${b.consignments.length} consignment${b.consignments.length === 1 ? '' : 's'}`,
              oldestAt:      oldestAge(b.consignments, 'dispatched_at'),
              discrepancies: b.bills.filter(x => x.audit_gross_weight != null).length,
            }))}
            onPick={(branch) => setDrillBranch({ name: branch, pool: 'outstation' })}
          />

          {/* ─── Bangalore branch cards ─── */}
          <BranchGrid
            t={t}
            s={s}
            title="Bangalore — Pending at HO"
            subtitle="Bills from Bangalore branches walking in for intake (no consignment wrapping)."
            accent={t.gold}
            badge="BANGALORE"
            empty="No Bangalore bills currently pending."
            branches={bangaloreByBranch.map(b => ({
              branch:        b.branch,
              billCount:     b.bills.length,
              extraLabel:    null,
              oldestAt:      oldestAge(b.bills, 'purchase_date'),
              discrepancies: b.bills.filter(x => x.audit_gross_weight != null).length,
            }))}
            onPick={(branch) => setDrillBranch({ name: branch, pool: 'bangalore' })}
          />
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

// ─── BranchGrid: a pool of branch cards (Level 0) ────────────────────────────
function BranchGrid({ t, s, title, subtitle, accent, badge, empty, branches, onPick }) {
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
      {branches.length === 0 ? (
        <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>{empty}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1px', background: t.border }}>
          {branches.map(b => {
            const age = ageBadge(b.oldestAt ? new Date(b.oldestAt) : null, t)
            return (
              <button key={b.branch} onClick={() => onPick(b.branch)}
                style={{
                  background: t.card, border: 'none', textAlign: 'left',
                  padding: '16px 18px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: '10px',
                  transition: 'background .15s ease, transform .12s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${accent}10` }}
                onMouseLeave={e => { e.currentTarget.style.background = t.card }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                  <div style={{ fontSize: '13px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>{b.branch}</div>
                  <span style={{ fontSize: '9px', color: age.color, background: age.bg, borderRadius: '4px', padding: '2px 6px', fontWeight: 700 }}>{age.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <div style={{ fontSize: '28px', color: accent, fontWeight: 700, lineHeight: 1, fontFamily: 'monospace' }}>{b.billCount}</div>
                  <div style={{ fontSize: '11px', color: t.text3 }}>bill{b.billCount === 1 ? '' : 's'}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: t.text4 }}>
                  <span>{b.extraLabel || ' '}</span>
                  {b.discrepancies > 0 && (
                    <span style={{ color: t.red, background: `${t.red}18`, borderRadius: '4px', padding: '2px 6px', fontWeight: 700 }}>
                      {b.discrepancies} discrepancy
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Branch drill-down (Level 1) ────────────────────────────────────────────
function BranchDrilldown({ drill, outstationByBranch, bangaloreByBranch, t, s, onBack, onAudit }) {
  const source = drill.pool === 'outstation'
    ? outstationByBranch.find(b => b.branch === drill.name)
    : bangaloreByBranch.find(b => b.branch === drill.name)

  if (!source) {
    return (
      <div style={{ ...s.card, padding: '40px', textAlign: 'center', color: t.text4 }}>
        Branch no longer has any pending bills. <button onClick={onBack} style={{ ...s.btnOut, marginLeft: '10px' }}>← Back to branches</button>
      </div>
    )
  }

  const accent  = drill.pool === 'outstation' ? t.orange : t.gold
  const badgeLb = drill.pool === 'outstation' ? 'OUTSTATION' : 'BANGALORE'
  const dateF   = drill.pool === 'outstation' ? 'dispatched_at' : 'purchase_date'

  // For outstation, group by parent consignment for visual grouping; for
  // Bangalore, flat list. Outstation source bills carry `_consignment` from
  // the parent reducer.
  const groups = drill.pool === 'outstation'
    ? Object.values(source.bills.reduce((acc, b) => {
        const cid = b._consignment?.id || 'orphan'
        if (!acc[cid]) acc[cid] = { consignment: b._consignment, bills: [] }
        acc[cid].bills.push(b)
        return acc
      }, {}))
    : [{ consignment: null, bills: source.bills }]

  return (
    <div style={{ ...s.card, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ ...s.btnOut, padding: '4px 10px', fontSize: '11px' }}>← Branches</button>
        <span style={s.badge(accent)}>{badgeLb}</span>
        <div>
          <div style={{ fontSize: '14px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>{source.branch}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
            {source.bills.length} bill{source.bills.length === 1 ? '' : 's'} pending audit
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: t.card2 || t.card }}>
            <th style={s.th}>App ID</th>
            <th style={s.th}>Customer</th>
            <th style={s.th}>Type</th>
            <th style={s.th}>Purchase Date</th>
            <th style={s.th}>Age</th>
            <th style={s.th}>Status</th>
            <th style={s.th}></th>
          </tr></thead>
          <tbody>
            {groups.map((g, i) => (
              <Fragment key={g.consignment?.id || i}>
                {g.consignment && (
                  <tr>
                    <td colSpan={7} style={{ padding: '10px 14px', background: `${accent}10`, borderTop: `1px solid ${t.border}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={s.badge(t.gold)}>{g.consignment.tmp_prf_no || '—'}</span>
                        <span style={{ fontSize: '11px', color: t.text2 }}>
                          {g.consignment.branch_name} <span style={{ color: t.text4 }}>→</span> {g.consignment.movement_type === 'INTERNAL' ? g.consignment.dest_branch : 'HO'}
                        </span>
                        <span style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace' }}>{g.consignment.challan_no}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '10px', color: t.text3 }}>
                          <strong style={{ color: t.text2 }}>{g.bills.length}</strong> bill{g.bills.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {g.bills.map(bill => <BillRow key={bill.id} bill={bill} s={s} t={t} dateField={dateF} onAudit={() => onAudit(bill)} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BillRow({ bill, s, t, onAudit, dateField }) {
  const previouslyAudited = bill.audit_gross_weight != null
  const age = ageBadge(bill[dateField], t)
  return (
    <tr style={{
      background: previouslyAudited ? `${t.red}06` : 'transparent',
      transition: 'background .12s ease',
    }}
      onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
      onMouseLeave={e => e.currentTarget.style.background = previouslyAudited ? `${t.red}06` : 'transparent'}>
      <td style={{ ...s.td, color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{bill.application_id}</td>
      <td style={s.td}>{bill.customer_name || '—'}</td>
      <td style={s.td}>
        <span style={{ fontSize: '10px', color: bill.transaction_type === 'TAKEOVER' ? t.purple : t.gold, background: bill.transaction_type === 'TAKEOVER' ? `${t.purple}18` : `${t.gold}18`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700 }}>
          {bill.transaction_type || '—'}
        </span>
      </td>
      <td style={{ ...s.td, color: t.text3, fontSize: '11px' }}>{fmtDate(bill[dateField])}</td>
      <td style={s.td}>
        <span style={{ fontSize: '10px', color: age.color, background: age.bg, borderRadius: '4px', padding: '2px 7px', fontWeight: 700 }}>{age.label}</span>
      </td>
      <td style={s.td}>
        {previouslyAudited ? (
          <span style={{ fontSize: '10px', color: t.red, background: `${t.red}18`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700 }}>
            ⚠ Re-audit needed
          </span>
        ) : (
          <span style={{ fontSize: '10px', color: t.text4, background: `${t.text4}10`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>
            Pending
          </span>
        )}
      </td>
      <td style={{ ...s.td, textAlign: 'right' }}>
        <button onClick={onAudit} style={{ ...s.btnGold, background: previouslyAudited ? t.orange : t.gold, color: previouslyAudited ? '#fff' : '#1a0a00' }}>
          {previouslyAudited ? 'Re-weigh' : 'Weigh bill'}
        </button>
      </td>
    </tr>
  )
}

// ─── Blind audit modal ─────────────────────────────────────────────────────
function AuditModal({ bill, t, onClose, onDone, onError }) {
  const [weight,  setWeight]  = useState('')
  const [remark,  setRemark]  = useState(bill.audit_remark || '')
  const [busy,    setBusy]    = useState(false)
  // Set after a Submit that triggered a discrepancy — drives the "reveal" UI.
  const [revealed,setRevealed]= useState(null)   // { crm_gross, measured, discrepancy_g } | null

  const measured = parseFloat(weight)
  const valid    = Number.isFinite(measured) && measured > 0

  // Reset reveal if the user changes the input after a reveal — they're
  // re-weighing, so the previous comparison no longer applies.
  function onWeightChange(v) {
    setWeight(v)
    if (revealed) setRevealed(null)
  }

  async function submit(action) {
    if (!valid) { onError('Enter a valid measured gross weight'); return }
    if (revealed && action === 'receive' && !remark.trim()) {
      onError('Discrepancy is flagged — add a remark before accepting.')
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

      // Exact match — server already flipped to at_ho. Close modal with toast.
      if (res.ok && j.success && j.action === 'receive' && Number(j.discrepancy_g) === 0) {
        const tail = j.consignment_received ? ' · Parent consignment also marked received.' : ''
        onDone(`${bill.application_id} matched CRM exactly — received at HO.${tail}`)
        return
      }
      // Success path with explicit remark (auditor already saw discrepancy)
      if (res.ok && j.success && j.action === 'receive') {
        const tail = j.consignment_received ? ' · Parent consignment also marked received.' : ''
        onDone(`${bill.application_id} received with discrepancy noted (Δ ${j.discrepancy_g}g).${tail}`)
        return
      }
      if (res.ok && j.success && j.action === 'keep_pending') {
        onDone(`${bill.application_id} kept pending — discrepancy ${j.discrepancy_g}g recorded.`)
        return
      }

      // Discrepancy reveal — server returned 400 with crm_gross + diff so the
      // auditor can decide.
      if (j.requires_remark && j.crm_gross != null) {
        setRevealed({ crm_gross: Number(j.crm_gross), measured: Number(j.measured), discrepancy_g: Number(j.discrepancy_g) })
        return
      }
      onError(j.error || 'Audit action failed')
    } finally { setBusy(false) }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', maxWidth: '560px', width: '100%', overflow: 'hidden', boxShadow: `0 12px 48px rgba(0,0,0,.6)` }
  const label   = { fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }
  const input   = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px', fontSize: '16px', color: t.text1, fontFamily: 'monospace', outline: 'none', width: '100%', boxSizing: 'border-box' }

  const previouslyAudited = bill.audit_gross_weight != null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${t.border}` }}>
          <div style={label}>Audit Bill — Blind Weight Entry</div>
          <div style={{ fontSize: '20px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, marginTop: '4px' }}>{bill.application_id}</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '2px' }}>
            {bill.customer_name} · {bill.branch_name} · {fmtDate(bill.purchase_date)}
          </div>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Re-audit context (when applicable) */}
          {previouslyAudited && !revealed && (
            <div style={{ padding: '12px 14px', borderRadius: '10px', background: `${t.orange}10`, border: `1px solid ${t.orange}40`, fontSize: '12px', color: t.orange }}>
              <strong>Re-audit:</strong> previous reading was <strong style={{ fontFamily: 'monospace' }}>{fmtWt(bill.audit_gross_weight)}</strong>{bill.audit_remark ? <> · note: <em>"{bill.audit_remark}"</em></> : null}.
              Re-weigh on the scale and type what you see — the CRM gross will be revealed only after you submit.
            </div>
          )}

          {/* Weight input — blind */}
          <div>
            <div style={{ ...label, marginBottom: '6px' }}>Measured Gross Weight (g)</div>
            <input
              type="number"
              step="0.001"
              autoFocus
              value={weight}
              onChange={e => onWeightChange(e.target.value)}
              placeholder="Place gold on scale, type the reading"
              style={input}
            />
            {!revealed && (
              <div style={{ fontSize: '10px', color: t.text4, marginTop: '6px' }}>
                CRM gross is intentionally hidden. Submit your reading to compare.
              </div>
            )}
          </div>

          {/* Comparison reveal — only after first POST that flagged a discrepancy */}
          {revealed && (
            <div style={{ padding: '14px 16px', borderRadius: '10px', background: `${t.red}10`, border: `1px solid ${t.red}40` }}>
              <div style={{ fontSize: '11px', color: t.red, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
                ⚠ Discrepancy detected
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <Reveal t={t} label="Your reading" value={fmtWt(revealed.measured)} color={t.text1} />
                <Reveal t={t} label="CRM gross"    value={fmtWt(revealed.crm_gross)} color={t.gold} />
                <Reveal t={t} label="Δ"             value={`${revealed.discrepancy_g > 0 ? '+' : ''}${revealed.discrepancy_g.toFixed(3)}g`} color={t.red} />
              </div>
              <div style={{ fontSize: '12px', color: t.text2, marginTop: '12px' }}>
                {revealed.measured > revealed.crm_gross ? 'You measured MORE than CRM.' : 'You measured LESS than CRM.'} Add a remark and decide.
              </div>
            </div>
          )}

          {/* Remark — only shown after reveal */}
          {revealed && (
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
          {!revealed ? (
            <button onClick={() => submit('receive')} disabled={busy || !valid}
              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '9px 22px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: (busy || !valid) ? .5 : 1, letterSpacing: '.02em' }}>
              {busy ? 'Comparing…' : 'Submit & Compare'}
            </button>
          ) : (
            <>
              <button onClick={() => submit('keep_pending')} disabled={busy || !valid}
                style={{ background: 'transparent', border: `1px solid ${t.orange}80`, borderRadius: '8px', padding: '9px 18px', fontSize: '12px', color: t.orange, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
                Keep Pending
              </button>
              <button onClick={() => submit('receive')} disabled={busy || !valid || !remark.trim()}
                style={{ background: t.green, color: '#0a0a0a', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: (busy || !valid || !remark.trim()) ? .5 : 1 }}>
                {busy ? 'Saving…' : 'Accept & Mark Received'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Reveal({ t, label, value, color }) {
  return (
    <div style={{ background: t.card, padding: '10px 12px', borderRadius: '8px', textAlign: 'center' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '16px', color, fontWeight: 700, fontFamily: 'monospace', marginTop: '4px', letterSpacing: '-.01em' }}>{value}</div>
    </div>
  )
}

function Kpi({ t, label, primary, sub, accent }) {
  return (
    <div style={{ background: t.card, padding: '16px 18px 18px', position: 'relative', transition: 'background .18s ease' }}
      onMouseEnter={e => e.currentTarget.style.background = `${accent || t.text3}08`}
      onMouseLeave={e => e.currentTarget.style.background = t.card}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent || t.text3, opacity: .55 }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', color: accent || t.text1, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-.015em' }}>{primary}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '8px' }}>{sub}</div>}
    </div>
  )
}
