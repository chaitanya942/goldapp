'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtTS = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export default function ConsignmentSummary() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [consignments, setConsignments] = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => { fetchToday() }, [selectedDate])

  async function fetchToday() {
    setLoading(true)
    const dayStart = `${selectedDate}T00:00:00.000Z`
    const dayEnd   = `${selectedDate}T23:59:59.999Z`
    const res = await fetch(`/api/consignments?action=consignments&date_from=${dayStart}&date_to=${dayEnd}`)
    const { data } = await res.json()
    setConsignments(data || [])
    setLoading(false)
  }

  const totalBills = consignments.reduce((s, c) => s + (c.total_bills || 0), 0)
  const totalWt    = consignments.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const totalAmt   = consignments.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Movement Report</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>
            {isToday ? "Today's" : selectedDate} consignment movements — {consignments.length} consignments created
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
          <button onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} style={{ ...btnOut, fontSize: '11px', padding: '5px 10px' }}>Today</button>
          <button onClick={fetchToday} style={btnOut}>⟳</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        {[
          { label: 'Consignments Moved', value: consignments.length, color: t.gold, icon: '📦' },
          { label: 'Bills Moved', value: totalBills, color: t.blue, icon: '🧾' },
          { label: 'Net Weight Moved', value: fmtWt(totalWt), color: t.green, icon: '⚖' },
        ].map(k => (
          <div key={k.label} style={{ ...card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '24px' }}>{k.icon}</div>
            <div>
              <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '4px' }}>{k.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 300, color: k.color }}>{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Movement list — BR-CONSIGNY style */}
      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>
            {isToday ? "Today's Movements" : `Movements on ${selectedDate}`}
          </div>
          <div style={{ fontSize: '11px', color: t.text4 }}>{consignments.length} consignments</div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>Loading...</div>
        ) : consignments.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
            No movements {isToday ? 'today' : `on ${selectedDate}`}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'TMP PRF No', 'Challan No', 'Branch', 'State', 'Type', 'Bills', 'Net Wt', 'Amount', 'Time'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: i > 5 ? 'right' : 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consignments.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${t.border}15` }}
                  onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text4 }}>{i + 1}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, fontWeight: 600, fontFamily: 'monospace' }}>{c.tmp_prf_no}</td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.blue, fontFamily: 'monospace', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.challan_no}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text2 }}>{c.branch_name}</td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{ fontSize: '10px', color: t.text3, background: t.card2, borderRadius: '4px', padding: '2px 6px' }}>{c.state_code}</span>
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{ fontSize: '10px', color: c.movement_type === 'INTERNAL' ? t.purple : t.orange, background: c.movement_type === 'INTERNAL' ? `${t.purple}15` : `${t.orange}15`, borderRadius: '4px', padding: '2px 6px' }}>{c.movement_type}</span>
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(c.total_net_wt)}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(c.total_amount))}</td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtTS(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr style={{ borderTop: `1px solid ${t.border}` }}>
                <td colSpan={6} style={{ padding: '9px 12px', fontSize: '11px', color: t.text4, fontWeight: 600 }}>TOTAL</td>
                <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontWeight: 600 }}>{totalBills}</td>
                <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtWt(totalWt)}</td>
                <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>₹{fmt(Math.round(totalAmt))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}