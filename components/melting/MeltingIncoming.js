'use client'

// MeltingIncoming — Melting sub-module. Branch-wise view of gold incoming to HO
// for melting: today's Bangalore purchases + outstation consignments arriving.
// Columns: Consignment date · Branch · Bills · Gross Wt · Booked? · Arrival.
// A region filter (All + every region present in the data — never hardcoded)
// sits below the stat cards. Click a branch to drill into its cases.
//
//   auditedOnly=false → "Incoming" (everything heading to HO)
//   auditedOnly=true  → "Audited" (only auditor-touched cases — Collection
//                        Audit or the Bangalore EOD audit)

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { REGION_COLORS, CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtDate = (ymd) => {
  if (!ymd) return '—'
  const [, m, d] = ymd.split('-')
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]
  return `${d} ${mon}`
}
const fmtDates = (arr) => (arr && arr.length ? arr.map(fmtDate).join(', ') : '—')

const GRID = '22px 112px minmax(0,1fr) 64px 96px 104px 96px'
const CASE_GRID = '112px 116px minmax(0,1fr) 92px 96px 70px'

export default function MeltingIncoming({ status = 'in_consignment' }) {
  const { theme } = useApp()
  const c = THEMES[theme] || THEMES.dark
  const atHo = status === 'at_ho'

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(() => new Set())
  const [region, setRegion] = useState('')   // '' = All

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/consignments?action=melting_incoming&status=${status}`)
      const j = await res.json()
      if (!j.error) setData(j)
    } catch { /* keep last */ } finally { setLoading(false) }
  }, [status])

  useEffect(() => { load() }, [load])

  const toggle = (b) => setOpen(prev => { const n = new Set(prev); n.has(b) ? n.delete(b) : n.add(b); return n })

  const allBranches = data?.branches || []

  // Regions present in the data — derived, never hardcoded. Bangalore first,
  // then the rest alphabetically.
  const regions = useMemo(() => {
    const set = [...new Set(allBranches.map(b => b.region).filter(Boolean))]
    return set.sort((a, b) => (a === 'Bangalore' ? -1 : b === 'Bangalore' ? 1 : a.localeCompare(b)))
  }, [allBranches])

  const branches = region ? allBranches.filter(b => b.region === region) : allBranches

  // Totals recompute against the selected region.
  const total = useMemo(() => branches.reduce((t, b) => ({
    bills: t.bills + b.bills, gross: t.gross + b.gross, net: t.net + b.net,
    booked: t.booked + b.booked_bills, unbooked: t.unbooked + b.unbooked_bills, audited: t.audited + b.audited_bills,
  }), { bills: 0, gross: 0, net: 0, booked: 0, unbooked: 0, audited: 0 }), [branches])

  const chip = (active) => ({
    padding: '5px 13px', borderRadius: 999, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? c.gold : c.border}`,
    background: active ? `${c.gold}1f` : 'transparent',
    color: active ? c.gold : c.text3, fontWeight: active ? 700 : 500, transition: 'all .15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 300, color: c.text1, letterSpacing: '-.01em' }}>
            {atHo ? 'At HO · For Melting' : 'In Consignment · For Melting'}
          </h2>
          <div style={{ fontSize: 12, color: c.text3, marginTop: 4 }}>
            {atHo ? `Gold arrived at HO — ready to melt${data?.days ? ` · last ${data.days} days` : ''}` : 'Gold in transit to HO (in consignment)'}
          </div>
        </div>
        <button onClick={load} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.card, color: c.text2, fontSize: 12, cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Stat c={c} label="Total Bills" value={loading ? '…' : fmt(total.bills, 0)} accent={c.gold} />
        <Stat c={c} label="Gross Weight" value={loading ? '…' : `${fmt(total.gross)} g`} accent={c.text1} />
        <Stat c={c} label="Net Weight" value={loading ? '…' : `${fmt(total.net)} g`} accent={c.text1} />
        <Stat c={c} label="Booked" value={loading ? '…' : fmt(total.booked, 0)} sub="bills" accent={c.blue} />
        <Stat c={c} label="Unbooked" value={loading ? '…' : fmt(total.unbooked, 0)} sub="bills" accent={c.orange || '#e58a3b'} />
        <Stat c={c} label="Audited" value={loading ? '…' : fmt(total.audited, 0)} sub="bills" accent={c.green} />
      </div>

      {/* Region filter — All + every region present (derived from data) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: c.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, marginRight: 2 }}>Region</span>
        <button onClick={() => setRegion('')} style={chip(region === '')}>
          All <span style={{ opacity: .6, fontFamily: 'ui-monospace,monospace' }}>{allBranches.length}</span>
        </button>
        {regions.map(r => (
          <button key={r} onClick={() => setRegion(r)} style={chip(region === r)}>
            {r} <span style={{ opacity: .6, fontFamily: 'ui-monospace,monospace' }}>{allBranches.filter(b => b.region === r).length}</span>
          </button>
        ))}
      </div>

      {/* Branch table */}
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '10px 16px', background: c.card2 || c.card, borderBottom: `1px solid ${c.border}` }}>
          {[['', 'l'], ['Consignment', 'l'], ['Branch', 'l'], ['Bills', 'r'], ['Gross Wt', 'r'], ['Booked / Unbk', 'r'], ['Arrival', 'r']].map(([h, a], i) => (
            <span key={i} style={{ fontSize: 9.5, letterSpacing: '.07em', textTransform: 'uppercase', color: c.text4, fontWeight: 700, textAlign: a === 'r' ? 'right' : 'left' }}>{h}</span>
          ))}
        </div>
        {loading ? (
          <div style={{ padding: 28, textAlign: 'center', color: c.text4, fontSize: 13 }}>Loading…</div>
        ) : branches.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: c.text4, fontSize: 13 }}>
            {atHo ? 'No gold at HO for melting.' : 'No gold in consignment.'}
          </div>
        ) : branches.map((b) => {
          const isOpen = open.has(b.branch_name)
          return (
            <Fragment key={b.branch_name}>
              <div onClick={() => toggle(b.branch_name)}
                style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '11px 16px', borderBottom: `1px solid ${c.border}22`, alignItems: 'center', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = c.card2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 10, color: c.text4 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: 11, color: c.text3 }}>{fmtDates(b.consignment_dates)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: c.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.branch_name}
                  <span style={{ fontSize: 10.5, color: REGION_COLORS?.[b.region] || c.text4, marginLeft: 8, fontWeight: 500 }}>{b.region}</span>
                </span>
                <span style={{ fontSize: 12.5, color: c.text2, textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{b.bills}</span>
                <span style={{ fontSize: 12.5, color: c.gold, fontWeight: 700, textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{fmt(b.gross)} g</span>
                <span style={{ fontSize: 11.5, textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>
                  <span style={{ color: c.blue }}>{b.booked_bills}</span>
                  <span style={{ color: c.text4 }}> / </span>
                  <span style={{ color: c.orange || '#e58a3b' }}>{b.unbooked_bills}</span>
                </span>
                <span style={{ fontSize: 11, textAlign: 'right', color: c.text3 }}>{fmtDates(b.arrivals)}</span>
              </div>
              {isOpen && (
                <div style={{ padding: '4px 16px 10px 44px', background: `${c.card2 || c.card}66`, borderBottom: `1px solid ${c.border}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: CASE_GRID, gap: 8, padding: '6px 0', borderBottom: `1px solid ${c.border}30` }}>
                    {[['Consignment', 'l'], ['Bill No', 'l'], ['Customer', 'l'], ['Gross Wt', 'r'], ['Booked?', 'l'], ['Arrival', 'r']].map(([h, a], i) => (
                      <span key={i} style={{ fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', color: c.text4, fontWeight: 700, textAlign: a === 'r' ? 'right' : 'left' }}>{h}</span>
                    ))}
                  </div>
                  {b.cases.map((x, j) => (
                    <div key={x.application_id || j} style={{ display: 'grid', gridTemplateColumns: CASE_GRID, gap: 8, padding: '6px 0', borderBottom: `1px solid ${c.border}14`, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: c.text3 }}>{fmtDate(x.consignment_date)}</span>
                      <span style={{ fontSize: 11.5, color: c.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{x.application_id}</span>
                      <span style={{ fontSize: 12, color: c.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.customer_name || '—'}</span>
                      <span style={{ fontSize: 12, color: c.text1, textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{fmt(x.gross_weight)} g</span>
                      <span style={{ fontSize: 11 }}>{x.booked ? <span style={{ color: c.blue }}>Booked</span> : <span style={{ color: c.orange || '#e58a3b' }}>Unbooked</span>}</span>
                      <span style={{ fontSize: 11, color: c.text3, textAlign: 'right' }}>{fmtDate(x.expected_arrival)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ c, label, value, sub, accent }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: c.text4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 300, color: accent, marginTop: 4, fontFamily: 'ui-monospace,monospace', letterSpacing: '-.01em' }}>
        {value}{sub && <span style={{ fontSize: 11, color: c.text4, fontWeight: 500, marginLeft: 4 }}>{sub}</span>}
      </div>
    </div>
  )
}
