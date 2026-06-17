'use client'

// MeltingIncoming — Melting sub-module. Branch-wise view of gold incoming to HO
// for melting: today's Bangalore purchases + outstation consignments arriving.
// Each branch row shows bills, gross/net, expected arrival, booked/unbooked
// split and the booking rate; click a branch to drill into its cases.
//
//   auditedOnly=false → "Incoming" (everything heading to HO)
//   auditedOnly=true  → "Audited" (only auditor-touched cases — Collection
//                        Audit or the Bangalore EOD audit)

import { useEffect, useState, useCallback, Fragment } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { REGION_COLORS, CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtDate = (ymd) => {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-')
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]
  return `${d} ${mon}`
}

export default function MeltingIncoming({ auditedOnly = false }) {
  const { theme } = useApp()
  const c = THEMES[theme] || THEMES.dark

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/consignments?action=melting_incoming${auditedOnly ? '&audited=1' : ''}`)
      const j = await res.json()
      if (!j.error) setData(j)
    } catch { /* keep last */ } finally { setLoading(false) }
  }, [auditedOnly])

  useEffect(() => { load() }, [load])

  const toggle = (b) => setOpen(prev => { const n = new Set(prev); n.has(b) ? n.delete(b) : n.add(b); return n })

  const branches = data?.branches || []
  const total = data?.total || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 300, color: c.text1, letterSpacing: '-.01em' }}>
            {auditedOnly ? 'Audited · For Melting' : 'Incoming for Melting'}
          </h2>
          <div style={{ fontSize: 12, color: c.text3, marginTop: 4 }}>
            Today's Bangalore purchases + outstation consignments arriving at HO
            {data?.today ? ` · ${fmtDate(data.today)}` : ''}
            {auditedOnly ? ' · auditor-verified only' : ''}
          </div>
        </div>
        <button onClick={load} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.card, color: c.text2, fontSize: 12, cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Stat c={c} label="Total Bills" value={loading ? '…' : fmt(total.bills, 0)} accent={c.gold} />
        <Stat c={c} label="Gross Weight" value={loading ? '…' : `${fmt(total.gross)} g`} accent={c.text1} />
        <Stat c={c} label="Net Weight" value={loading ? '…' : `${fmt(total.net)} g`} accent={c.text1} />
        <Stat c={c} label="Booked" value={loading ? '…' : fmt(total.booked_bills, 0)} sub="bills" accent={c.blue} />
        <Stat c={c} label="Unbooked" value={loading ? '…' : fmt(total.unbooked_bills, 0)} sub="bills" accent={c.orange || '#e58a3b'} />
        {!auditedOnly && <Stat c={c} label="Audited" value={loading ? '…' : fmt(total.audited_bills, 0)} sub="bills" accent={c.green} />}
      </div>

      {/* Branch table */}
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 130px 80px 96px 110px 110px', gap: 8, padding: '10px 16px', background: c.card2 || c.card, borderBottom: `1px solid ${c.border}` }}>
          {['', 'Branch', 'Region', 'Bills', 'Net Wt', 'Booked / Unbk', 'Arrival · Rate'].map((h, i) => (
            <span key={i} style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: c.text4, fontWeight: 700, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</span>
          ))}
        </div>
        {loading ? (
          <div style={{ padding: 28, textAlign: 'center', color: c.text4, fontSize: 13 }}>Loading…</div>
        ) : branches.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: c.text4, fontSize: 13 }}>
            {auditedOnly ? 'No audited cases incoming for melting.' : 'No gold incoming for melting today.'}
          </div>
        ) : branches.map((b) => {
          const isOpen = open.has(b.branch_name)
          return (
            <Fragment key={b.branch_name}>
              <div onClick={() => toggle(b.branch_name)}
                style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 130px 80px 96px 110px 110px', gap: 8, padding: '11px 16px', borderBottom: `1px solid ${c.border}22`, alignItems: 'center', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = c.card2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 10, color: c.text4 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: c.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.branch_name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: REGION_COLORS?.[b.region] || c.text3 }}>{b.region}</span>
                <span style={{ fontSize: 12.5, color: c.text2, textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{b.bills}</span>
                <span style={{ fontSize: 12.5, color: c.gold, fontWeight: 700, textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{fmt(b.net)} g</span>
                <span style={{ fontSize: 11.5, textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>
                  <span style={{ color: c.blue }}>{b.booked_bills}</span>
                  <span style={{ color: c.text4 }}> / </span>
                  <span style={{ color: c.orange || '#e58a3b' }}>{b.unbooked_bills}</span>
                </span>
                <span style={{ fontSize: 11, textAlign: 'right', color: c.text3 }}>
                  <span>{(b.arrivals || []).map(fmtDate).join(', ') || '—'}</span>
                  {b.rates?.length > 0 && <span style={{ color: c.green, display: 'block', fontFamily: 'ui-monospace,monospace' }}>₹{b.rates.map(r => Number(r).toLocaleString('en-IN')).join(' / ')}</span>}
                </span>
              </div>
              {isOpen && (
                <div style={{ padding: '4px 16px 10px 44px', background: `${c.card2 || c.card}66`, borderBottom: `1px solid ${c.border}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) 70px 86px 96px 70px', gap: 8, padding: '6px 0', borderBottom: `1px solid ${c.border}30` }}>
                    {['Bill No', 'Customer', 'Net Wt', 'Source', 'Status · Rate', 'Audited'].map((h, i) => (
                      <span key={i} style={{ fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase', color: c.text4, fontWeight: 700, textAlign: i === 2 ? 'right' : 'left' }}>{h}</span>
                    ))}
                  </div>
                  {b.cases.map((x, j) => (
                    <div key={x.application_id || j} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) 70px 86px 96px 70px', gap: 8, padding: '6px 0', borderBottom: `1px solid ${c.border}14`, alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, color: c.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{x.application_id}</span>
                      <span style={{ fontSize: 12, color: c.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.customer_name || '—'}</span>
                      <span style={{ fontSize: 12, color: c.text1, textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{fmt(x.net_weight)} g</span>
                      <span style={{ fontSize: 11, color: c.text3 }}>{x.source === 'bangalore' ? 'Bangalore' : 'Consignment'}</span>
                      <span style={{ fontSize: 11 }}>
                        {x.booked
                          ? <span style={{ color: c.blue }}>Booked{x.rate ? <span style={{ color: c.green, fontFamily: 'ui-monospace,monospace' }}> · ₹{Number(x.rate).toLocaleString('en-IN')}</span> : ''}</span>
                          : <span style={{ color: c.orange || '#e58a3b' }}>Unbooked</span>}
                      </span>
                      <span style={{ fontSize: 11, color: x.audited ? c.green : c.text4, fontWeight: x.audited ? 700 : 400 }}>{x.audited ? '✓ Yes' : '—'}</span>
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
