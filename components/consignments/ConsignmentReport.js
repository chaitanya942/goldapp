'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'

async function triggerDownload(url, filename, onError) {
  const res  = await authedFetch(url)
  if (!res.ok) {
    let msg = `Download failed: ${res.status}`
    try { const j = await res.json(); if (j.error) msg = j.error } catch { try { msg = await res.text() } catch {} }
    onError?.(msg); return
  }
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTS   = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// Status visualisation only — receive lives in the future Inventory Audit module.
const STATUS_META = {
  dispatched: { color: '#3a8fbf', label: 'In Transit' },
  received:   { color: '#3aaa6a', label: 'Received at HO' },
}

export default function ConsignmentReport() {
  const { theme } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const [consignments,    setConsignments]    = useState([])
  const [loading,         setLoading]         = useState(true)
  const [selected,        setSelected]        = useState(null)
  const [detail,          setDetail]          = useState(null)
  const [loadingDetail,   setLoadingDetail]   = useState(false)
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterBranch,    setFilterBranch]    = useState('')
  const [filterType,      setFilterType]      = useState('')
  const [filterDateFrom,  setFilterDateFrom]  = useState('')
  const [filterDateTo,    setFilterDateTo]    = useState('')
  const [search,          setSearch]          = useState('')
  const [downloading,     setDownloading]     = useState(null)
  const [toast,           setToast]           = useState(null)

  useEffect(() => { fetchConsignments() }, [])

  async function fetchConsignments() {
    setLoading(true)
    const params = new URLSearchParams({ action: 'consignments' })
    if (filterStatus)   params.set('status',    filterStatus)
    if (filterBranch)   params.set('branch',    filterBranch)
    if (filterDateFrom) params.set('date_from', filterDateFrom)
    if (filterDateTo)   params.set('date_to',   filterDateTo)
    const res = await authedFetch(`/api/consignments?${params}`)
    const { data } = await res.json()
    setConsignments((data || []).filter(c => c.status !== 'seed'))
    setLoading(false)
  }

  async function fetchDetail(id) {
    setLoadingDetail(true)
    const res  = await authedFetch(`/api/consignments?action=consignment_detail&id=${id}`)
    const { data } = await res.json()
    setDetail(data)
    setLoadingDetail(false)
  }

  function handleSelect(c) { setSelected(c.id); fetchDetail(c.id) }

  async function download(type, id, filename) {
    setDownloading(type)
    const url = type === 'report'  ? `/api/generate-consignee-report?id=${id}`
              : type === 'voucher' ? `/api/generate-issue-voucher-pdf?id=${id}`
              :                      `/api/generate-challan-pdf?id=${id}`
    await triggerDownload(url, filename, msg => setToast({ msg, type: 'error' }))
    setDownloading(null)
  }

  // ── Filtered ──────────────────────────────────────────────────────────────
  const filtered = consignments.filter(c => {
    if (filterType && c.movement_type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      if (!c.tmp_prf_no?.toLowerCase().includes(q) && !c.challan_no?.toLowerCase().includes(q) && !c.branch_name?.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Aggregates ────────────────────────────────────────────────────────────
  const grandBills = filtered.reduce((s, c) => s + (c.total_bills || 0), 0)
  const grandWt    = filtered.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const grandAmt   = filtered.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)

  const byStatus = filtered.reduce((acc, c) => {
    if (!acc[c.status]) acc[c.status] = 0
    acc[c.status]++
    return acc
  }, {})

  const byType = filtered.reduce((acc, c) => {
    const key = c.movement_type || 'UNKNOWN'
    if (!acc[key]) acc[key] = { count: 0, bills: 0, wt: 0 }
    acc[key].count++
    acc[key].bills += c.total_bills || 0
    acc[key].wt    += parseFloat(c.total_net_wt || 0)
    return acc
  }, {})

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>Consignment Report</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>All branch-to-HO movements · {filtered.length} consignments</div>
        </div>
        <button onClick={fetchConsignments} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px' }}>
        {[
          { label: 'Total Consignments', value: filtered.length,         color: t.text1 },
          { label: 'Total Bills',        value: grandBills,              color: t.gold   },
          { label: 'Total Net Weight',   value: fmtWt(grandWt),         color: t.blue   },
          { label: 'Total Amount',       value: `₹${fmt(Math.round(grandAmt))}`, color: t.green },
        ].map(k => (
          <div key={k.label} style={{ ...card, padding: '14px 18px' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>{k.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 300, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Status + Type breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
        {/* Status breakdown */}
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '12px', fontWeight: 600 }}>Status Breakdown</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {Object.entries(STATUS_META).map(([status, meta]) => (
              <div key={status} onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
                style={{ flex: 1, padding: '10px 12px', background: filterStatus === status ? `${meta.color}18` : t.card2, borderRadius: '8px', border: `1px solid ${filterStatus === status ? meta.color + '40' : t.border}`, cursor: 'pointer', textAlign: 'center', transition: 'all .15s' }}>
                <div style={{ fontSize: '18px', fontWeight: 300, color: meta.color, fontFamily: 'monospace' }}>{byStatus[status] || 0}</div>
                <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>{meta.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Movement type breakdown */}
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '12px', fontWeight: 600 }}>Movement Type</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {['EXTERNAL', 'INTERNAL'].map(type => {
              const stats = byType[type] || { count: 0, bills: 0, wt: 0 }
              const color = type === 'INTERNAL' ? t.purple : t.orange
              return (
                <div key={type} onClick={() => setFilterType(filterType === type ? '' : type)}
                  style={{ flex: 1, padding: '10px 12px', background: filterType === type ? `${color}15` : t.card2, borderRadius: '8px', border: `1px solid ${filterType === type ? color + '40' : t.border}`, cursor: 'pointer', transition: 'all .15s' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color, marginBottom: '5px' }}>{type}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
                    <div style={{ fontSize: '9px', color: t.text4 }}>Consignments</div><div style={{ fontSize: '9px', color: t.text2, fontWeight: 500 }}>{stats.count}</div>
                    <div style={{ fontSize: '9px', color: t.text4 }}>Bills</div><div style={{ fontSize: '9px', color: t.text2, fontWeight: 500 }}>{stats.bills}</div>
                    <div style={{ fontSize: '9px', color: t.text4 }}>Net Wt</div><div style={{ fontSize: '9px', color: t.text2, fontWeight: 500 }}>{fmtWt(stats.wt)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search TMP PRF, Challan, Branch…"
            style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px 7px 28px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <input value={filterBranch} onChange={e => setFilterBranch(e.target.value)} placeholder="Branch…"
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none', width: '140px' }} />
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
        <button onClick={fetchConsignments} style={{ ...btnGold, padding: '7px 14px' }}>Apply</button>
        {(filterStatus || filterType || filterBranch || filterDateFrom || filterDateTo || search) && (
          <button onClick={() => { setFilterStatus(''); setFilterType(''); setFilterBranch(''); setFilterDateFrom(''); setFilterDateTo(''); setSearch('') }} style={btnOut}>Clear</button>
        )}
      </div>

      {/* Split view */}
      <div style={{ display: 'grid', gridTemplateColumns: selected && !isMobile ? '1fr 420px' : '1fr', gap: '12px', alignItems: 'start' }}>

        {/* List */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 460px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {['TMP PRF', 'Challan', 'Branch', 'Type', 'Bills', 'Net Wt', 'Amount', 'Status', 'Created'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No consignments found</td></tr>
                ) : filtered.map(c => {
                  const sm = STATUS_META[c.status] || {}
                  return (
                    <tr key={c.id} onClick={() => handleSelect(c)}
                      style={{ borderBottom: `1px solid ${t.border}15`, cursor: 'pointer', background: selected === c.id ? `${t.gold}08` : 'transparent', transition: 'background .1s' }}
                      onMouseEnter={e => { if (selected !== c.id) e.currentTarget.style.background = `${t.gold}04` }}
                      onMouseLeave={e => { if (selected !== c.id) e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{c.tmp_prf_no}</td>
                      <td style={{ padding: '10px 12px', fontSize: '11px', color: t.blue, fontFamily: 'monospace', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.challan_no}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }}>{c.branch_name}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: '10px', color: c.movement_type === 'INTERNAL' ? t.purple : t.orange, background: c.movement_type === 'INTERNAL' ? `${t.purple}15` : `${t.orange}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>{c.movement_type}</span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtWt(c.total_net_wt)}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>₹{fmt(Math.round(c.total_amount))}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: '10px', color: sm.color || t.text4, background: `${sm.color || t.text4}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{sm.label || c.status}</span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtTS(c.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'sticky', top: '22px' }}>
            {/* Panel header */}
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, background: t.card2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: t.gold, fontFamily: 'monospace' }}>{detail?.tmp_prf_no || '…'}</div>
                <button onClick={() => { setSelected(null); setDetail(null) }} style={{ background: 'transparent', border: 'none', color: t.text4, cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
              </div>
              {/* Action buttons — receive flow lives in Inventory Audit module */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {detail?.movement_type === 'INTERNAL' ? (
                  <button disabled={!!downloading} onClick={() => download('voucher', selected, `${(detail?.tmp_prf_no || 'voucher').replace(/\//g,'-')}_voucher.pdf`)}
                    style={{ ...btnGold, padding: '5px 11px', fontSize: '11px', opacity: downloading === 'voucher' ? .6 : 1 }}>
                    {downloading === 'voucher' ? '⏳…' : '📄 Issue Voucher'}
                  </button>
                ) : (
                  <button disabled={!!downloading} onClick={() => download('challan', selected, `${detail?.challan_no?.replace(/\//g,'-')}.pdf`)}
                    style={{ ...btnGold, padding: '5px 11px', fontSize: '11px', opacity: downloading === 'challan' ? .6 : 1 }}>
                    {downloading === 'challan' ? '⏳…' : '📄 Challan'}
                  </button>
                )}
                {detail?.status !== 'draft' && (
                  <button disabled={!!downloading} onClick={() => download('report', selected, `GoldConsigneeReport-${detail?.tmp_prf_no}.jpg`)}
                    style={{ ...btnOut, padding: '5px 11px', fontSize: '11px', opacity: downloading === 'report' ? .6 : 1 }}>
                    {downloading === 'report' ? '⏳…' : '📋 Report'}
                  </button>
                )}
              </div>
            </div>

            {loadingDetail ? (
              <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
            ) : detail && (
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 460px)' }}>
                {/* Timeline */}
                <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '12px', fontWeight: 600 }}>Movement Timeline</div>
                  {[
                    { label: 'Created',    time: detail.created_at,    color: t.gold,   done: true },
                    { label: 'Dispatched', time: detail.dispatched_at, color: t.blue,   done: !!detail.dispatched_at },
                    { label: 'Received',   time: detail.received_at,   color: t.green,  done: !!detail.received_at },
                  ].map((step, i) => (
                    <div key={step.label} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: i < 2 ? '8px' : 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: '2px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: step.done ? step.color : t.border2, boxShadow: step.done ? `0 0 6px ${step.color}60` : 'none', transition: 'all .2s' }} />
                        {i < 2 && <div style={{ width: '1px', height: '16px', background: step.done ? `${step.color}40` : t.border, margin: '3px 0' }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: step.done ? step.color : t.text4 }}>{step.label}</div>
                        {step.time && <div style={{ fontSize: '10px', color: t.text4, marginTop: '1px' }}>{fmtTS(step.time)}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Meta grid */}
                <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', borderBottom: `1px solid ${t.border}` }}>
                  {[
                    ['Branch',       detail.branch_name],
                    ['State',        detail.state_code],
                    ['Movement',     detail.movement_type],
                    ['Total Bills',  detail.total_bills],
                    ['Net Weight',   fmtWt(detail.total_net_wt)],
                    ['Amount',       `₹${fmt(Math.round(detail.total_amount))}`],
                    ['External No',  detail.external_no],
                    ['Internal No',  detail.internal_no || '—'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: t.card2, borderRadius: '7px', padding: '7px 10px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
                      <div style={{ fontSize: '11px', color: t.text1, fontWeight: 500, fontFamily: typeof value === 'number' || String(value).includes('g') || String(value).includes('₹') ? 'monospace' : 'inherit' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Bills */}
                <div style={{ padding: '12px 18px' }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 600 }}>Bills in this consignment ({detail.items?.length || 0})</div>
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
                          <td style={{ padding: '6px 8px', fontSize: '10px', color: t.text4 }}>{i + 1}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(item.purchase?.purchase_date)}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', color: t.text2, maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.purchase?.customer_name}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', color: t.gold, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtWt(item.purchase?.net_weight)}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', color: t.text2, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>₹{fmt(Math.round(item.purchase?.total_amount))}</td>
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
