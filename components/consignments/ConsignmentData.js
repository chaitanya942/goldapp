'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'
import Toast from '../ui/Toast'

async function triggerDownload(url, filename, onError) {
  const res  = await fetch(url)
  if (!res.ok) { onError?.('Download failed: ' + (await res.text())); return }
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', card3: '#1a1a1a', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', card3: '#ede5d8', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtTS   = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0

function AgeBadge({ days, t }) {
  if (days === null || days === undefined) return null
  const color = days > 7 ? t.red : days > 3 ? t.orange : t.green
  return <span style={{ fontSize: '10px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.02em' }}>{days}d</span>
}

function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function ConsignmentData() {
  const { theme, consignmentDeepLink, setConsignmentDeepLink } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  // Mode: null = Active Consignments list,  { type:'branch', branch, fromRegion } = bill picker
  const [nav,                 setNav]                = useState(null)
  const [purchases,           setPurchases]          = useState([])
  const [consignments,        setConsignments]       = useState([])
  const [branches,            setBranches]           = useState([])
  const [unknownBranches,     setUnknownBranches]    = useState([])
  const [loading,             setLoading]            = useState(true)
  const [selected,            setSelected]           = useState(new Set())
  const [sortBy,              setSortBy]             = useState('date_desc')
  const [search,              setSearch]             = useState('')
  const [creating,            setCreating]           = useState(false)
  const [moveType,            setMoveType]           = useState('EXTERNAL')
  const [destBranch,          setDestBranch]         = useState('')
  const [destSearch,          setDestSearch]         = useState('')
  const [destOpen,            setDestOpen]           = useState(false)
  const [ewayBillNo,          setEwayBillNo]         = useState('')
  const [showModal,           setShowModal]          = useState(false)
  const [lastConsignment,     setLastConsignment]    = useState(null)
  const [previewNumbers,      setPreviewNumbers]     = useState(null)
  const [loadingPreview,      setLoadingPreview]     = useState(false)
  const [downloadingId,       setDownloadingId]      = useState(null)
  const [ewbActionId,         setEwbActionId]        = useState(null)
  const [toast,               setToast]              = useState(null)

  // List filters
  const [filterType,   setFilterType]   = useState('')
  const [filterRegion, setFilterRegion] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [p, b, c, u] = await Promise.all([
      fetch('/api/consignments?action=stock_in_branch').then(r => r.json()),
      fetch('/api/consignments?action=branches').then(r => r.json()),
      fetch('/api/consignments?action=consignments').then(r => r.json()),
      fetch('/api/consignments?action=unknown_branches').then(r => r.json()),
    ])
    setPurchases(p.data || [])
    setBranches(b.data || [])
    // Active = not received, not seed
    setConsignments((c.data || []).filter(x => x.status !== 'received' && x.status !== 'seed'))
    setUnknownBranches(u.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Deep-link from Branch Stock Overview → enter bill-picker mode for that branch
  useEffect(() => {
    if (consignmentDeepLink) {
      setNav({ type: 'branch', branch: consignmentDeepLink.branch, fromRegion: consignmentDeepLink.region })
      setSelected(new Set())
      setSearch('')
      setConsignmentDeepLink(null)
    }
  }, [consignmentDeepLink])

  // Reset hub destination when source branch changes
  useEffect(() => {
    if (!nav?.branch) { setDestBranch(''); setDestSearch(''); return }
    setDestBranch(''); setDestSearch('')
  }, [nav?.branch])

  // ── Bill picker filtering / selection ─────────────────────────────────────
  function getBillsForBranch() {
    if (!nav?.branch) return []
    let bills = purchases.filter(p => (p.current_branch || p.branch_name) === nav.branch)
    if (search) {
      const q = search.toLowerCase()
      bills = bills.filter(p =>
        p.customer_name?.toLowerCase().includes(q) ||
        p.phone_number?.includes(q) ||
        p.application_id?.toLowerCase().includes(q))
    }
    return [...bills].sort((a, b) => {
      if (sortBy === 'date_desc')   return new Date(b.purchase_date) - new Date(a.purchase_date)
      if (sortBy === 'oldest')      return new Date(a.purchase_date) - new Date(b.purchase_date)
      if (sortBy === 'weight_desc') return parseFloat(b.net_weight || 0) - parseFloat(a.net_weight || 0)
      if (sortBy === 'amount_desc') return parseFloat(b.final_amount_crm || 0) - parseFloat(a.final_amount_crm || 0)
      return 0
    })
  }

  const visibleBills = getBillsForBranch()
  const selectedRows = visibleBills.filter(p => selected.has(p.id))
  const allSelected  = visibleBills.length > 0 && visibleBills.every(p => selected.has(p.id))
  const totalSelWt   = selectedRows.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalSelAmt  = selectedRows.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  function toggleAll() {
    if (allSelected) { const n = new Set(selected); visibleBills.forEach(p => n.delete(p.id)); setSelected(n) }
    else { const n = new Set(selected); visibleBills.forEach(p => n.add(p.id)); setSelected(n) }
  }
  function toggleRow(id) { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }

  async function fetchPreviewNumbers() {
    if (!nav?.branch) return
    setLoadingPreview(true)
    try {
      const res  = await fetch(`/api/consignments-preview?branch=${encodeURIComponent(nav.branch)}&movement_type=${moveType}`)
      const data = await res.json()
      if (!data.error) setPreviewNumbers(data)
    } catch {}
    finally { setLoadingPreview(false) }
  }

  async function handleCreate() {
    if (!selected.size || !nav?.branch) return
    if (moveType === 'INTERNAL' && !destBranch) {
      setToast({ msg: 'Pick a destination hub before creating', type: 'error' })
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_consignment',
          purchase_ids: [...selected],
          branch_name: nav.branch,
          movement_type: moveType,
          dest_branch: moveType === 'INTERNAL' ? destBranch : null,
          eway_bill_no: ewayBillNo || null,
        }),
      })
      const result = await res.json()
      if (result.error) { setToast({ msg: result.error, type: 'error' }); return }
      setLastConsignment(result.data)
      setSelected(new Set())
      setShowModal(false)
      setDestBranch(''); setEwayBillNo('')
      await fetchAll()
      // Return to Active Consignments list with the new one highlighted
      setNav(null)
    } finally { setCreating(false) }
  }

  async function generateEinv(c) {
    setEwbActionId(c.id + ':einv')
    try {
      const res  = await fetch('/api/e-invoice/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        // Dump full debug context to console so it's visible without Railway logs
        console.group('[E-Invoice] Debug')
        console.log('Error:', data.error)
        console.log('ClearTax response:', data.cleartax_response)
        console.log('Outgoing payload:', data.outgoing_payload)
        console.groupEnd()
        setToast({ msg: (data.error || 'E-Invoice failed') + ' — see browser console (F12) for full details', type: 'error' })
        return
      }
      setToast({ msg: `E-Invoice generated · IRN: ${String(data.irn).slice(0, 20)}…`, type: 'success' })
      await fetchAll()
    } catch (err) {
      setToast({ msg: err.message || 'E-Invoice generation failed', type: 'error' })
    } finally { setEwbActionId(null) }
  }

  async function cancelEinv(c) {
    if (!confirm(`Cancel E-Invoice IRN?\n\nMust be done within 24h of generation.`)) return
    setEwbActionId(c.id + ':einv-cancel')
    try {
      const res  = await fetch('/api/e-invoice/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setToast({ msg: data.error || 'E-Invoice cancel failed', type: 'error' }); return }
      setToast({ msg: 'E-Invoice cancelled', type: 'success' })
      await fetchAll()
    } finally { setEwbActionId(null) }
  }

  async function generateEwb(c) {
    setEwbActionId(c.id + ':gen')
    try {
      const res  = await fetch('/api/eway-bill/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        // Dump full debug context to console for diagnosis
        console.group('[EWB] Debug')
        console.log('Error:', data.error)
        console.log('ClearTax response:', data.cleartax_response)
        console.log('Outgoing payload:', data.outgoing_payload)
        console.groupEnd()
        setToast({ msg: (data.error || 'EWB failed') + ' — open browser console (F12) for details', type: 'error' })
        return
      }
      setToast({ msg: `E-Way Bill ${data.ewb_no} generated — downloading PDF…`, type: 'success' })
      await fetchAll()
      // Auto-download the EWB PDF immediately
      await triggerDownload(`/api/eway-bill/pdf?id=${c.id}`, `EWB_${data.ewb_no}.pdf`,
        msg => setToast({ msg, type: 'error' }))
    } catch (err) {
      setToast({ msg: err.message || 'EWB generation failed', type: 'error' })
    } finally { setEwbActionId(null) }
  }

  async function cancelEwb(c) {
    if (!confirm(`Cancel E-Way Bill ${c.eway_bill_no}?\n\nThis must be done within 24h of generation.`)) return
    setEwbActionId(c.id + ':cancel')
    try {
      const res  = await fetch('/api/eway-bill/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setToast({ msg: data.error || 'EWB cancel failed', type: 'error' }); return }
      setToast({ msg: 'E-Way Bill cancelled', type: 'success' })
      await fetchAll()
    } finally { setEwbActionId(null) }
  }

  async function downloadEwbPdf(c) {
    setDownloadingId(c.id + ':ewb')
    await triggerDownload(`/api/eway-bill/pdf?id=${c.id}`, `EWB_${c.eway_bill_no}.pdf`, msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  async function downloadDoc(c, kind) {
    setDownloadingId(c.id + ':' + kind)
    const url      = kind === 'report'  ? `/api/generate-consignee-report?id=${c.id}`
                   : kind === 'voucher' ? `/api/generate-issue-voucher-pdf?id=${c.id}`
                   :                       `/api/generate-challan-pdf?id=${c.id}`
    const filename = kind === 'report'  ? `GoldConsigneeReport-${c.tmp_prf_no}.jpg`
                   : kind === 'voucher' ? `${(c.tmp_prf_no || 'voucher').replace(/\//g,'-')}_voucher.pdf`
                   :                       `${(c.challan_no || c.tmp_prf_no || 'challan').replace(/\//g,'-')}.pdf`
    await triggerDownload(url, filename, msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  // One-click: download all applicable documents per business rules
  async function downloadAll(c) {
    const isType = c.movement_type === 'INTERNAL'
    const src = branches.find(b => b.name === c.branch_name)
    const isKaSource = src?.region === 'Rest of Karnataka' || src?.region === 'Bangalore'
    const showEwb = isType || isKaSource           // intrastate cases
    const showEinv = !isType && !isKaSource         // interstate Hub→HO

    setDownloadingId(c.id + ':all')
    setToast({ msg: 'Downloading documents…', type: 'info' })
    try {
      // 1. Consignee Report (always)
      await triggerDownload(`/api/generate-consignee-report?id=${c.id}`,
        `GoldConsigneeReport-${c.tmp_prf_no}.jpg`,
        msg => setToast({ msg, type: 'error' }))
      // 2. Challan (EXTERNAL) or Voucher (INTERNAL) — always
      const docUrl  = isType ? `/api/generate-issue-voucher-pdf?id=${c.id}` : `/api/generate-challan-pdf?id=${c.id}`
      const docName = isType ? `${(c.tmp_prf_no || 'voucher').replace(/\//g,'-')}_voucher.pdf`
                             : `${(c.challan_no || c.tmp_prf_no || 'challan').replace(/\//g,'-')}.pdf`
      await triggerDownload(docUrl, docName, msg => setToast({ msg, type: 'error' }))
      // 3. EWB PDF — only intrastate cases AND if generated
      if (showEwb && c.eway_bill_no) {
        await triggerDownload(`/api/eway-bill/pdf?id=${c.id}`,
          `EWB_${c.eway_bill_no}.pdf`,
          msg => setToast({ msg, type: 'error' }))
      }
      // 4. E-Invoice signed copy — only interstate Hub→HO if generated.
      // (We don't have a separate IRP PDF endpoint yet — IRN is stored on the consignment.)
      const summary = []
      summary.push('Report')
      summary.push(isType ? 'Voucher' : 'Challan')
      if (showEwb && c.eway_bill_no) summary.push('EWB')
      if (showEinv && c.irn)        summary.push(`IRN ${String(c.irn).slice(0, 8)}…`)
      const missing = []
      if (showEwb && !c.eway_bill_no) missing.push('EWB not generated')
      if (showEinv && !c.irn)         missing.push('E-Invoice not generated')
      const msg = `Downloaded: ${summary.join(' + ')}` + (missing.length ? ` · ${missing.join(', ')}` : '')
      setToast({ msg, type: missing.length ? 'info' : 'success' })
    } finally { setDownloadingId(null) }
  }

  // ── Active consignments filtering ─────────────────────────────────────────
  const filteredCons = consignments.filter(c => {
    if (filterType   && c.movement_type !== filterType)   return false
    if (filterRegion) {
      const br = branches.find(b => b.name === c.branch_name)
      if (br?.region !== filterRegion) return false
    }
    if (search && !nav) {
      const q = search.toLowerCase()
      if (![c.tmp_prf_no, c.challan_no, c.branch_name, c.dest_branch].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  })

  // KPIs
  const kpiBills    = filteredCons.reduce((s, c) => s + (c.total_bills || 0), 0)
  const kpiNetWt    = filteredCons.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const kpiAmount   = filteredCons.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  // ── BILL PICKER MODE (deep-linked from Branch Stock) ──────────────────────
  const BillPicker = () => {
    const branchInfo = branches.find(b => b.name === nav.branch)
    const rColor     = REGION_COLORS[branchInfo?.region] || t.text3
    const isHub      = !!branchInfo?.is_hub

    // Hub consolidation: group bills by their original branch (transferred-in vs hub's own)
    const sourceCounts = visibleBills.reduce((acc, p) => {
      const origin = p.branch_name
      if (!acc[origin]) acc[origin] = { count: 0, wt: 0 }
      acc[origin].count++
      acc[origin].wt += parseFloat(p.net_weight || 0)
      return acc
    }, {})
    const sourceList = Object.entries(sourceCounts).sort((a, b) => b[1].count - a[1].count)
    const transferredIn = isHub ? sourceList.filter(([n]) => n !== nav.branch) : []

    return (
      <>
        {/* Branch header */}
        <div style={{ ...card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button onClick={() => { setNav(null); setSelected(new Set()) }} style={btnOut}>← Back</button>
          <div style={{ width: '4px', height: '36px', background: rColor, borderRadius: '4px' }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: t.text1 }}>{nav.branch}</span>
              {isHub && <span style={{ fontSize: '10px', color: t.green, background: `${t.green}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 700, letterSpacing: '.05em' }}>HUB</span>}
            </div>
            <div style={{ fontSize: '11px', color: rColor, marginTop: '2px' }}>{branchInfo?.region}</div>
          </div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '11px', color: t.text3 }}>
            <span><span style={{ color: t.text4 }}>Bills:</span> <strong style={{ color: t.text1 }}>{visibleBills.length}</strong></span>
            <span><span style={{ color: t.text4 }}>Selected:</span> <strong style={{ color: t.gold }}>{selected.size}</strong></span>
          </div>
        </div>

        {/* Hub consolidation summary — shows source breakdown */}
        {isHub && transferredIn.length > 0 && (
          <div style={{ ...card, padding: '12px 18px', borderLeft: `3px solid ${t.green}` }}>
            <div style={{ fontSize: '10px', color: t.green, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>
              Hub Consolidation · {visibleBills.length} bills from {sourceList.length} source{sourceList.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {sourceList.map(([origin, stats]) => {
                const isOwn = origin === nav.branch
                return (
                  <div key={origin} style={{ background: isOwn ? `${t.gold}12` : `${t.purple}12`, border: `1px solid ${isOwn ? t.gold + '40' : t.purple + '40'}`, borderRadius: '7px', padding: '6px 10px', fontSize: '11px' }}>
                    <span style={{ color: isOwn ? t.gold : t.purple, fontWeight: 600 }}>{origin}</span>
                    {isOwn && <span style={{ color: t.text4, fontSize: '9px', marginLeft: '4px' }}>(own)</span>}
                    <span style={{ color: t.text3, marginLeft: '8px' }}>{stats.count} bills · {fmtWt(stats.wt)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, app ID..."
              style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px 8px 30px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
            <option value="date_desc">Latest First</option>
            <option value="oldest">Oldest First</option>
            <option value="weight_desc">Heaviest First</option>
            <option value="amount_desc">Highest Amount</option>
          </select>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div style={{ background: `${t.gold}0d`, border: `1px solid ${t.gold}30`, borderRadius: '10px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: t.gold, fontWeight: 700 }}>{selected.size} selected</span>
            <span style={{ fontSize: '12px', color: t.text3 }}>{fmtWt(totalSelWt)}</span>
            <span style={{ fontSize: '12px', color: t.text3 }}>₹{fmt(Math.round(totalSelAmt))}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button onClick={() => { setShowModal(true); fetchPreviewNumbers() }} style={btnGold}>
                Create Consignment →
              </button>
              <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th style={{ padding: '10px 14px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: t.gold }} />
                  </th>
                  {['Date', ...(isHub ? ['Origin'] : []), 'Customer','App ID','Net Wt','Amount','Age','Type'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Net Wt' || h === 'Amount' ? 'right' : 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBills.length === 0 ? (
                  <tr><td colSpan={isHub ? 9 : 8} style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No bills available at this branch</td></tr>
                ) : visibleBills.map(row => {
                  const isSel    = selected.has(row.id)
                  const days     = daysSince(row.purchase_date)
                  const fromOther = isHub && row.branch_name !== nav.branch
                  return (
                    <tr key={row.id} onClick={() => toggleRow(row.id)}
                      style={{ borderBottom: `1px solid ${t.border}15`, background: isSel ? `${t.gold}08` : 'transparent', cursor: 'pointer' }}
                      onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = `${t.gold}04` }}
                      onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} style={{ cursor: 'pointer', accentColor: t.gold }} />
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                      {isHub && (
                        <td style={{ padding: '10px 14px' }}>
                          {fromOther ? (
                            <span title="Transferred in from this branch" style={{ background: `${t.purple}18`, color: t.purple, borderRadius: '5px', padding: '2px 8px', fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}>↩ {row.branch_name}</span>
                          ) : (
                            <span style={{ color: t.text4, fontSize: '11px' }}>own</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text1, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: '11px', color: t.text4, fontFamily: 'monospace' }}>{row.application_id}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(row.net_weight)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(row.final_amount_crm))}</td>
                      <td style={{ padding: '10px 14px' }}><AgeBadge days={days} t={t} /></td>
                      <td style={{ padding: '10px 14px' }}>
                        <Badge label={row.transaction_type} color={row.transaction_type === 'TAKEOVER' ? 'purple' : 'green'} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )
  }

  // ── ACTIVE CONSIGNMENTS LIST ─────────────────────────────────────────────
  const ConsignmentsList = () => (
    <>
      {/* Filters */}
      <div style={{ ...card, padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search TMP PRF, Challan, Branch…"
            style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px 7px 28px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="">All Types</option>
          <option value="EXTERNAL">Direct → HO</option>
          <option value="INTERNAL">Via Hub</option>
        </select>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="">All Regions</option>
          {[...new Set(branches.map(b => b.region).filter(Boolean))].sort().map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {(filterType || filterRegion || search) && (
          <button onClick={() => { setFilterType(''); setFilterRegion(''); setSearch('') }} style={btnOut}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: t.text4 }}>{filteredCons.length} of {consignments.length}</div>
      </div>

      {/* Table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {['TMP PRF', 'Type', 'Source → Destination', 'Bills', 'Net Wt', 'Value', 'Created', 'Document', 'E-Way Bill', 'E-Invoice', 'All'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Bills' || h === 'Net Wt' || h === 'Value' ? 'right' : 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCons.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: '64px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
                  {consignments.length === 0
                    ? 'No active consignments. Use Branch Stock → Move to create one.'
                    : 'No consignments match the filters'}
                </td></tr>
              ) : filteredCons.map(c => {
                const isType = c.movement_type === 'INTERNAL'
                const tColor = isType ? t.purple : t.orange
                const isNew  = lastConsignment?.id === c.id
                // Document applicability per business rules:
                //   Intrastate KA Branch → HO       : EWB ✓ + Challan,  NO E-Invoice
                //   Intrastate non-KA Branch → Hub  : EWB ✓ + Voucher,  NO E-Invoice
                //   Interstate Hub → HO (non-KA src): NO EWB + Challan, E-Invoice ✓
                const sourceBranchInfo = branches.find(b => b.name === c.branch_name)
                const isKaSource       = sourceBranchInfo?.region === 'Rest of Karnataka' || sourceBranchInfo?.region === 'Bangalore'
                const showEwb          = isType || isKaSource          // intrastate cases only
                const showEinvoice     = !isType && !isKaSource        // interstate Hub → HO only
                return (
                  <tr key={c.id}
                    style={{ borderBottom: `1px solid ${t.border}15`, background: isNew ? `${t.green}08` : 'transparent', transition: 'background .1s' }}
                    onMouseEnter={e => { if (!isNew) e.currentTarget.style.background = `${t.gold}04` }}
                    onMouseLeave={e => { if (!isNew) e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {c.tmp_prf_no}
                      {isNew && <span style={{ marginLeft: 6, fontSize: 9, color: t.green, background: `${t.green}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>NEW</span>}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: '10px', color: tColor, background: `${tColor}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                        {isType ? 'Via Hub' : 'Direct → HO'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }}>
                      <strong style={{ color: t.text1 }}>{c.branch_name}</strong>
                      <span style={{ color: t.text4, margin: '0 6px' }}>→</span>
                      <span>{isType ? (c.dest_branch || '?') : 'Head Office'}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtWt(c.total_net_wt)}</td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>₹{fmt(Math.round(c.total_amount))}</td>
                    <td style={{ padding: '11px 14px', fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtTS(c.created_at)}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <button onClick={() => downloadDoc(c, isType ? 'voucher' : 'challan')} disabled={!!downloadingId}
                        title={isType ? 'Issue Voucher' : 'Delivery Challan'}
                        style={{ ...btnGold, padding: '4px 10px', fontSize: '10px' }}>
                        {downloadingId === c.id + ':' + (isType ? 'voucher' : 'challan') ? '⏳' : (isType ? '📄 Voucher' : '📄 Challan')}
                      </button>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {!showEwb ? (
                        <span title="Interstate Hub→HO uses E-Invoice instead — no separate EWB needed" style={{ fontSize: '10px', color: t.text4 }}>n/a</span>
                      ) : c.eway_bill_no ? (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: t.green, background: `${t.green}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, fontFamily: 'monospace' }}>{c.eway_bill_no}</span>
                          <button onClick={() => downloadEwbPdf(c)} disabled={!!downloadingId}
                            style={{ background: t.blue, color: '#fff', border: 'none', borderRadius: '5px', padding: '3px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', opacity: downloadingId === c.id + ':ewb' ? 0.6 : 1 }}>
                            {downloadingId === c.id + ':ewb' ? '⏳' : '📄 PDF'}
                          </button>
                          <button onClick={() => cancelEwb(c)} disabled={!!ewbActionId}
                            title="Cancel E-Way Bill (within 24h)"
                            style={{ background: 'transparent', border: `1px solid ${t.red}40`, borderRadius: '5px', padding: '3px 8px', fontSize: '10px', color: t.red, cursor: 'pointer', opacity: ewbActionId === c.id + ':cancel' ? 0.6 : 1 }}>
                            {ewbActionId === c.id + ':cancel' ? '…' : '✕'}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => generateEwb(c)} disabled={!!ewbActionId}
                          style={{ background: 'transparent', border: `1px solid ${t.green}50`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.green, fontWeight: 600, cursor: 'pointer', opacity: ewbActionId === c.id + ':gen' ? 0.6 : 1 }}>
                          {ewbActionId === c.id + ':gen' ? '⏳ Generating…' : '⚡ Generate EWB'}
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {!showEinvoice ? (
                        <span title={isType ? 'Branch → Hub uses Issue Voucher only — no E-Invoice' : 'Intrastate KA Branch → HO uses EWB only — no E-Invoice'} style={{ fontSize: '10px', color: t.text4 }}>n/a</span>
                      ) : c.irn ? (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span title={c.irn} style={{ fontSize: '10px', color: t.purple, background: `${t.purple}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, fontFamily: 'monospace' }}>
                            IRN: {String(c.irn).slice(0, 8)}…
                          </span>
                          <button onClick={() => cancelEinv(c)} disabled={!!ewbActionId}
                            title="Cancel E-Invoice (within 24h)"
                            style={{ background: 'transparent', border: `1px solid ${t.red}40`, borderRadius: '5px', padding: '3px 8px', fontSize: '10px', color: t.red, cursor: 'pointer', opacity: ewbActionId === c.id + ':einv-cancel' ? 0.6 : 1 }}>
                            {ewbActionId === c.id + ':einv-cancel' ? '…' : '✕'}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => generateEinv(c)} disabled={!!ewbActionId}
                          style={{ background: 'transparent', border: `1px solid ${t.purple}50`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer', opacity: ewbActionId === c.id + ':einv' ? 0.6 : 1 }}>
                          {ewbActionId === c.id + ':einv' ? '⏳ Generating…' : '⚡ Generate IRN'}
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <button onClick={() => downloadAll(c)} disabled={downloadingId === c.id + ':all'}
                        title="Download Consignee Report + Document + EWB (if available) in one click"
                        style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '6px', padding: '5px 11px', fontSize: '10px', fontWeight: 700, cursor: downloadingId === c.id + ':all' ? 'not-allowed' : 'pointer', opacity: downloadingId === c.id + ':all' ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                        {downloadingId === c.id + ':all' ? '⏳…' : '📦 All'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const fmtINR = (n) => {
    if (n == null) return '—'
    const v = Number(n)
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
    return `₹${Math.round(v).toLocaleString('en-IN')}`
  }
  const kpis = [
    { label: 'Consignments In Transit', value: filteredCons.length, sub: 'in flight',          color: t.orange },
    { label: 'Bills In Transit',        value: kpiBills,            sub: 'across consignments', color: t.gold   },
    { label: 'Net Weight',              value: fmtWt(kpiNetWt),     sub: '',                    color: t.blue   },
    { label: 'Total Value',             value: fmtINR(kpiAmount),   sub: '',                    color: t.green  },
  ]

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
            {nav?.branch ? 'Create Consignment' : 'Consignment Data'}
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            {nav?.branch
              ? `Select bills to dispatch from ${nav.branch}`
              : `${consignments.length} active consignment${consignments.length !== 1 ? 's' : ''} · branch movements in flight`}
          </div>
        </div>
        <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* KPIs (only on list view) */}
      {!nav && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background: t.card, padding: '15px 18px' }}>
              <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '7px', fontWeight: 600 }}>{k.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 300, color: k.color, lineHeight: 1, fontFamily: 'monospace' }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px' }}>{k.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ padding: '64px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
      ) : nav?.branch ? (
        <BillPicker />
      ) : (
        <ConsignmentsList />
      )}

      {/* Confirm modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: '16px', padding: '28px', width: '480px', maxWidth: '92vw', boxShadow: '0 24px 64px rgba(0,0,0,.4)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: t.text1, marginBottom: '6px' }}>Confirm Consignment</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '22px' }}>Review and confirm before creating.</div>

            {(() => {
              // Any outside-Bangalore branch can act as a hub for this specific consignment.
              // No pre-marking required — user picks freely each time.
              const candidateHubs = branches.filter(b => b.name !== nav?.branch)
              const filteredHubs  = destSearch
                ? candidateHubs.filter(b => b.name.toLowerCase().includes(destSearch.toLowerCase()) || (b.region || '').toLowerCase().includes(destSearch.toLowerCase()))
                : candidateHubs

              return (
                <>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', padding: '4px', background: t.card2, borderRadius: '9px' }}>
                    <button type="button" onClick={() => setMoveType('EXTERNAL')}
                      style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '7px', cursor: 'pointer',
                        background: moveType === 'EXTERNAL' ? t.card : 'transparent',
                        color: moveType === 'EXTERNAL' ? t.gold : t.text3, fontWeight: moveType === 'EXTERNAL' ? 700 : 500, fontSize: '11px',
                        boxShadow: moveType === 'EXTERNAL' ? '0 1px 4px rgba(0,0,0,.2)' : 'none' }}>
                      Direct → HO
                    </button>
                    <button type="button" onClick={() => setMoveType('INTERNAL')} disabled={candidateHubs.length === 0}
                      title={candidateHubs.length === 0 ? 'No other branches available' : ''}
                      style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '7px',
                        cursor: candidateHubs.length === 0 ? 'not-allowed' : 'pointer',
                        opacity: candidateHubs.length === 0 ? 0.4 : 1,
                        background: moveType === 'INTERNAL' ? t.card : 'transparent',
                        color: moveType === 'INTERNAL' ? t.purple : t.text3, fontWeight: moveType === 'INTERNAL' ? 700 : 500, fontSize: '11px',
                        boxShadow: moveType === 'INTERNAL' ? '0 1px 4px rgba(0,0,0,.2)' : 'none' }}>
                      Via Hub → HO
                    </button>
                  </div>

                  {moveType === 'INTERNAL' && (
                    <div style={{ marginBottom: '14px', position: 'relative' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '5px', fontWeight: 600 }}>Destination Hub</div>
                      <input
                        value={destBranch && !destOpen ? destBranch : destSearch}
                        onFocus={() => { setDestOpen(true); setDestSearch('') }}
                        onChange={e => { setDestSearch(e.target.value); setDestBranch(''); setDestOpen(true) }}
                        placeholder="Type to search any branch…"
                        style={{ width: '100%', background: t.card2, border: `1px solid ${destBranch ? t.purple + '60' : t.border2}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
                      {destOpen && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: t.card, border: `1px solid ${t.border2}`, borderRadius: '8px', maxHeight: '240px', overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                          {filteredHubs.length === 0 ? (
                            <div style={{ padding: '14px', fontSize: '12px', color: t.text4, textAlign: 'center' }}>No branches match</div>
                          ) : filteredHubs.map(b => (
                            <div key={b.id}
                              onClick={() => { setDestBranch(b.name); setDestSearch(''); setDestOpen(false) }}
                              style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '12px', color: t.text1, borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              onMouseEnter={e => e.currentTarget.style.background = `${t.purple}10`}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <span style={{ fontWeight: 500 }}>{b.name}</span>
                              <span style={{ fontSize: '10px', color: t.text4 }}>{b.region}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '14px' }}>
                    {[
                      ['Source',      nav?.branch],
                      ['Destination', moveType === 'INTERNAL' ? (destBranch || '— select hub —') : 'Head Office'],
                      ['Bills',       `${selected.size}`],
                      ['Net Weight',  fmtWt(totalSelWt)],
                      ['Amount',      `₹${fmt(Math.round(totalSelAmt))}`],
                      ['Document',    moveType === 'EXTERNAL' ? 'Delivery Challan' : 'Issue Voucher'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: t.card2, borderRadius: '7px' }}>
                        <span style={{ fontSize: '11px', color: t.text3 }}>{label}</span>
                        <span style={{ fontSize: '11px', color: t.text1, fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {moveType === 'EXTERNAL' && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '5px', fontWeight: 600 }}>E-Way Bill No <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></div>
                      <input value={ewayBillNo} onChange={e => setEwayBillNo(e.target.value)} placeholder="Enter E-Way Bill number"
                        style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '9px 12px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  )}
                </>
              )
            })()}

            {loadingPreview ? (
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '14px', padding: '11px 14px', background: `${t.gold}08`, borderRadius: '8px', border: `1px solid ${t.gold}20`, textAlign: 'center' }}>Generating preview numbers…</div>
            ) : previewNumbers && (
              <div style={{ marginBottom: '14px', display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1, padding: '10px 14px', background: `${t.gold}10`, borderRadius: '8px', border: `1px solid ${t.gold}30` }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>TMP PRF No</div>
                  <div style={{ fontSize: '13px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>{previewNumbers.tmp_prf_no}</div>
                </div>
                <div style={{ flex: 1, padding: '10px 14px', background: `${t.blue}10`, borderRadius: '8px', border: `1px solid ${t.blue}30` }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>{moveType === 'INTERNAL' ? 'Voucher No' : 'Challan No'}</div>
                  <div style={{ fontSize: '11px', color: t.blue, fontWeight: 600, fontFamily: 'monospace' }}>{previewNumbers.challan_no}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnOut}>Cancel</button>
              <button onClick={handleCreate} disabled={creating}
                style={{ ...btnGold, padding: '9px 22px', fontSize: '13px', opacity: creating ? .7 : 1 }}>
                {creating ? 'Creating…' : 'Confirm & Create →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}
