'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

async function triggerDownload(url, filename) {
  const res  = await fetch(url)
  if (!res.ok) { alert('Download failed: ' + (await res.text())); return }
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTS   = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export default function ConsignmentSummary() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [movements, setMovements] = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [detail, setDetail]       = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [filterBranchFrom, setFilterBranchFrom] = useState('')
  const [filterBranchTo, setFilterBranchTo]     = useState('')
  const [filterDateFrom, setFilterDateFrom]     = useState('')
  const [filterDateTo, setFilterDateTo]         = useState('')
  const [downloading, setDownloading]           = useState(false)

  async function downloadChallan(id, challanNo) {
    setDownloading(true)
    await triggerDownload(`/api/generate-challan-pdf?id=${id}`, `${challanNo?.replace(/\//g,'-')}.pdf`)
    setDownloading(false)
  }
  const [search, setSearch]                     = useState('')

  useEffect(() => { fetchMovements() }, [])

  async function fetchMovements() {
    setLoading(true)
    const params = new URLSearchParams({ action: 'consignments' })
    if (filterType)       params.set('movement_type', filterType)
    if (filterBranchFrom) params.set('branch_from', filterBranchFrom)
    if (filterBranchTo)   params.set('branch_to', filterBranchTo)
    if (filterDateFrom)   params.set('date_from', filterDateFrom)
    if (filterDateTo)     params.set('date_to', filterDateTo)
    const res = await fetch(`/api/consignments?${params}`)
    const { data } = await res.json()
    setMovements(data || [])
    setLoading(false)
  }

  async function fetchDetail(id) {
    setLoadingDetail(true)
    const res  = await fetch(`/api/consignments?action=consignment_detail&id=${id}`)
    const { data } = await res.json()
    setDetail(data)
    setLoadingDetail(false)
  }

  function handleSelect(m) {
    setSelected(m.id)
    fetchDetail(m.id)
  }

  const filtered = movements.filter(m => {
    if (search) {
      const q = search.toLowerCase()
      if (!m.tmp_prf_no?.toLowerCase().includes(q) &&
          !m.challan_no?.toLowerCase().includes(q) &&
          !m.branch_name?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }

  // Grand totals
  const grandBills  = filtered.reduce((s, m) => s + (m.total_bills || 0), 0)
  const grandWt     = filtered.reduce((s, m) => s + parseFloat(m.total_net_wt || 0), 0)
  const grandAmt    = filtered.reduce((s, m) => s + parseFloat(m.total_amount || 0), 0)

  // Group by movement type
  const byType = filtered.reduce((acc, m) => {
    const key = m.movement_type || 'UNKNOWN'
    if (!acc[key]) acc[key] = { count: 0, bills: 0, wt: 0, amt: 0 }
    acc[key].count++
    acc[key].bills += m.total_bills || 0
    acc[key].wt    += parseFloat(m.total_net_wt || 0)
    acc[key].amt   += parseFloat(m.total_amount || 0)
    return acc
  }, {})

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Movement Report</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>Branch-to-Consignee movements · {filtered.length} consignments</div>
        </div>
        <button onClick={fetchMovements} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        {[
          { label: 'Total Movements', value: filtered.length, color: t.text1 },
          { label: 'Total Bills', value: grandBills, color: t.gold },
          { label: 'Total Net Weight', value: fmtWt(grandWt), color: t.blue },
          { label: 'Total Amount', value: `₹${fmt(Math.round(grandAmt))}`, color: t.green },
        ].map(k => (
          <div key={k.label} style={{ ...card, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '4px' }}>{k.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 300, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Movement type breakdown */}
      {Object.keys(byType).length > 0 && (
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 600 }}>Movement Type Breakdown</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            {Object.entries(byType).map(([type, stats]) => (
              <div key={type} style={{ background: t.card2, borderRadius: '7px', padding: '10px 12px', border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: type === 'INTERNAL' ? t.purple : t.orange, marginBottom: '6px' }}>{type}</div>
                <div style={{ fontSize: '9px', color: t.text4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                  <div>Movements: <span style={{ color: t.text2, fontWeight: 500 }}>{stats.count}</span></div>
                  <div>Bills: <span style={{ color: t.text2, fontWeight: 500 }}>{stats.bills}</span></div>
                  <div>Weight: <span style={{ color: t.text2, fontWeight: 500 }}>{fmtWt(stats.wt)}</span></div>
                  <div>Amount: <span style={{ color: t.text2, fontWeight: 500 }}>₹{fmt(Math.round(stats.amt))}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ ...card, padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search TMP PRF, Challan, Branch..."
          style={{ flex: 1, minWidth: '200px', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text1, outline: 'none' }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="">All Types</option>
          <option value="INTERNAL">Internal</option>
          <option value="EXTERNAL">External</option>
        </select>
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
        <button onClick={fetchMovements} style={{ ...btnGold, padding: '6px 12px' }}>Apply</button>
      </div>

      {/* Split view: list + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '12px' }}>

        {/* List */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 480px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {['TMP PRF No', 'Challan No', 'Branch From', 'Type', 'Bills', 'Net Wt', 'Amount', 'Status', 'Date'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>No movements found</td></tr>
                ) : filtered.map(m => (
                  <tr key={m.id}
                    onClick={() => handleSelect(m)}
                    style={{ borderBottom: `1px solid ${t.border}15`, cursor: 'pointer', background: selected === m.id ? `${t.gold}08` : 'transparent' }}
                    onMouseEnter={e => { if (selected !== m.id) e.currentTarget.style.background = `${t.gold}05` }}
                    onMouseLeave={e => { if (selected !== m.id) e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.gold, fontWeight: 600, fontFamily: 'monospace' }}>{m.tmp_prf_no}</td>
                    <td style={{ padding: '8px 12px', fontSize: '11px', color: t.blue, fontFamily: 'monospace', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.challan_no}</td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2 }}>{m.branch_name}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ fontSize: '10px', color: m.movement_type === 'INTERNAL' ? t.purple : t.orange, background: m.movement_type === 'INTERNAL' ? `${t.purple}15` : `${t.orange}15`, borderRadius: '4px', padding: '2px 6px' }}>{m.movement_type}</span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{m.total_bills}</td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(m.total_net_wt)}</td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(m.total_amount))}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        fontSize: '10px',
                        color: m.status === 'received' ? t.green : m.status === 'dispatched' ? t.blue : t.orange,
                        background: m.status === 'received' ? `${t.green}15` : m.status === 'dispatched' ? `${t.blue}15` : `${t.orange}15`,
                        borderRadius: '4px',
                        padding: '2px 7px',
                        textTransform: 'capitalize'
                      }}>{m.status}</span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtDate(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: t.gold }}>{detail?.tmp_prf_no || '...'}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button disabled={downloading} onClick={() => downloadChallan(selected, detail?.challan_no)} style={{ ...btnGold, padding: '4px 10px', fontSize: '11px', opacity: downloading ? 0.6 : 1 }}>{downloading ? '⏳ Downloading...' : '📄 Delivery Challan'}</button>
                <button onClick={() => { setSelected(null); setDetail(null) }} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px' }}>✕</button>
              </div>
            </div>
            {loadingDetail ? (
              <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
            ) : detail && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* Movement timeline */}
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Movement Timeline</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.green }}></div>
                      <div style={{ fontSize: '11px', color: t.text2 }}>
                        <span style={{ fontWeight: 600, color: t.text1 }}>From:</span> {detail.branch_name}
                      </div>
                    </div>
                    <div style={{ marginLeft: '4px', borderLeft: `2px dashed ${t.border}`, height: '20px' }}></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.purple }}></div>
                      <div style={{ fontSize: '11px', color: t.text2 }}>
                        <span style={{ fontWeight: 600, color: t.text1 }}>To:</span> {detail.movement_type === 'INTERNAL' ? 'Head Office' : 'External Consignee'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Consignment details */}
                <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'TMP PRF No',   value: detail.tmp_prf_no },
                    { label: 'External No',  value: detail.external_no },
                    { label: 'Internal No',  value: detail.internal_no || '—' },
                    { label: 'Challan No',   value: detail.challan_no },
                    { label: 'Branch',       value: detail.branch_name },
                    { label: 'State',        value: detail.state_code },
                    { label: 'Movement',     value: detail.movement_type },
                    { label: 'Status',       value: detail.status },
                    { label: 'Total Bills',  value: detail.total_bills },
                    { label: 'Total Net Wt', value: fmtWt(detail.total_net_wt) },
                    { label: 'Total Amt',    value: `₹${fmt(Math.round(detail.total_amount))}` },
                    { label: 'Created',      value: fmtTS(detail.created_at) },
                  ].map(item => (
                    <div key={item.label} style={{ background: t.card2, borderRadius: '6px', padding: '7px 10px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '2px' }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: t.text1, fontWeight: 500 }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* Bills table */}
                <div style={{ borderTop: `1px solid ${t.border}`, padding: '10px 16px 6px' }}>
                  <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Bills in this movement</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['#', 'Date', 'Customer', 'Net Wt', 'Amount'].map(h => (
                          <th key={h} style={{ padding: '5px 8px', fontSize: '9px', color: t.text4, textAlign: 'left', borderBottom: `1px solid ${t.border}`, letterSpacing: '.06em', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((item, i) => (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${t.border}10` }}>
                          <td style={{ padding: '5px 8px', fontSize: '11px', color: t.text4 }}>{i + 1}</td>
                          <td style={{ padding: '5px 8px', fontSize: '11px', color: t.text3 }}>{fmtDate(item.purchase?.purchase_date)}</td>
                          <td style={{ padding: '5px 8px', fontSize: '11px', color: t.text2 }}>{item.purchase?.customer_name}</td>
                          <td style={{ padding: '5px 8px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{fmtWt(item.purchase?.net_weight)}</td>
                          <td style={{ padding: '5px 8px', fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>₹{fmt(Math.round(item.purchase?.total_amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}