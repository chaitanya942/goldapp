'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'
import Toast from '../ui/Toast'

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

const STATUS_COLORS = { draft: '#c9981f', dispatched: '#3a8fbf', received: '#3aaa6a' }

export default function ConsignmentReport() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [consignments, setConsignments] = useState([])
  const [loading, setLoading]           = useState(true)
  const [selected, setSelected]         = useState(null)
  const [detail, setDetail]             = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [toast, setToast] = useState(null)
  const [filterDateTo, setFilterDateTo]     = useState('')
  const [search, setSearch]             = useState('')
  const [downloading, setDownloading]   = useState(null)   // 'report' | 'challan' | null

  async function download(type, id, filename) {
    setDownloading(type)
    const url = type === 'report'
      ? `/api/generate-consignee-report?id=${id}`
      : `/api/generate-challan-pdf?id=${id}`
    await triggerDownload(url, filename)
    setDownloading(null)
  }

  useEffect(() => { fetchConsignments() }, [])

  async function fetchConsignments() {
    setLoading(true)
    const params = new URLSearchParams({ action: 'consignments' })
    if (filterStatus)   params.set('status', filterStatus)
    if (filterBranch)   params.set('branch', filterBranch)
    if (filterDateFrom) params.set('date_from', filterDateFrom)
    if (filterDateTo)   params.set('date_to', filterDateTo)
    const res = await fetch(`/api/consignments?${params}`)
    const { data } = await res.json()
    setConsignments(data || [])
    setLoading(false)
  }

  async function fetchDetail(id) {
    setLoadingDetail(true)
    const res  = await fetch(`/api/consignments?action=consignment_detail&id=${id}`)
    const { data } = await res.json()
    setDetail(data)
    setLoadingDetail(false)
  }

  function handleSelect(c) {
    setSelected(c.id)
    fetchDetail(c.id)
  }

  const filtered = consignments.filter(c => {
    if (search) {
      const q = search.toLowerCase()
      if (!c.tmp_prf_no?.toLowerCase().includes(q) &&
          !c.challan_no?.toLowerCase().includes(q) &&
          !c.branch_name?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }

  // Grand totals
  const grandBills  = filtered.reduce((s, c) => s + (c.total_bills || 0), 0)
  const grandWt     = filtered.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const grandAmt    = filtered.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Consignment Report</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>All delivery challans · {filtered.length} consignments</div>
        </div>
        <button onClick={fetchConsignments} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        {[
          { label: 'Total Consignments', value: filtered.length, color: t.text1 },
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

      {/* Filters */}
      <div style={{ ...card, padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search TMP PRF, Challan, Branch..."
          style={{ flex: 1, minWidth: '200px', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text1, outline: 'none' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="dispatched">Dispatched</option>
          <option value="received">Received</option>
        </select>
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
        <button onClick={fetchConsignments} style={{ ...btnGold, padding: '6px 12px' }}>Apply</button>
      </div>

      {/* Split view: list + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '12px' }}>

        {/* List */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {['TMP PRF No', 'Challan No', 'Branch', 'Type', 'Bills', 'Net Wt', 'Amount', 'Status', 'Created'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>No consignments found</td></tr>
                ) : filtered.map(c => (
                  <tr key={c.id}
                    onClick={() => handleSelect(c)}
                    style={{ borderBottom: `1px solid ${t.border}15`, cursor: 'pointer', background: selected === c.id ? `${t.gold}08` : 'transparent' }}
                    onMouseEnter={e => { if (selected !== c.id) e.currentTarget.style.background = `${t.gold}05` }}
                    onMouseLeave={e => { if (selected !== c.id) e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.gold, fontWeight: 600, fontFamily: 'monospace' }}>{c.tmp_prf_no}</td>
                    <td style={{ padding: '8px 12px', fontSize: '11px', color: t.blue, fontFamily: 'monospace', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.challan_no}</td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2 }}>{c.branch_name}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ fontSize: '10px', color: c.movement_type === 'INTERNAL' ? t.purple : t.orange, background: c.movement_type === 'INTERNAL' ? `${t.purple}15` : `${t.orange}15`, borderRadius: '4px', padding: '2px 6px' }}>{c.movement_type}</span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(c.total_net_wt)}</td>
                    <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(c.total_amount))}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <Badge label={c.status} color={c.status === 'received' ? 'green' : c.status === 'dispatched' ? 'blue' : 'orange'} />
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtTS(c.created_at)}</td>
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
                <button disabled={!!downloading} onClick={() => download('report', selected, `GoldConsigneeReport-${detail?.tmp_prf_no}.jpg`)} style={{ ...btnOut, padding: '4px 10px', fontSize: '11px', opacity: downloading === 'report' ? 0.6 : 1 }}>{downloading === 'report' ? '⏳ Downloading...' : '📋 Consignee Report'}</button>
                <button disabled={!!downloading} onClick={() => download('challan', selected, `${detail?.challan_no?.replace(/\//g,'-')}.pdf`)} style={{ ...btnGold, padding: '4px 10px', fontSize: '11px', opacity: downloading === 'challan' ? 0.6 : 1 }}>{downloading === 'challan' ? '⏳ Downloading...' : '📄 Delivery Challan'}</button>
                <button onClick={() => { setSelected(null); setDetail(null) }} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px' }}>✕</button>
              </div>
            </div>
            {loadingDetail ? (
              <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
            ) : detail && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
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
                  <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Bills in this consignment</div>
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
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}