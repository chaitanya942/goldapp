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

export default function ConsignmentData() {
  const { theme, consignmentDeepLink, setConsignmentDeepLink } = useApp()
  const t = THEMES[theme]

  const [nav,                  setNav]                  = useState(null)
  const [tab,                  setTab]                  = useState('at_branch')
  const [purchases,            setPurchases]            = useState([])
  const [inConsignment,        setInConsignment]        = useState([])
  const [branchConsignments,   setBranchConsignments]   = useState([])
  const [loadingBranchCons,    setLoadingBranchCons]    = useState(false)
  const [branches,             setBranches]             = useState([])
  const [branchSummary,        setBranchSummary]        = useState([])
  const [unknownBranches,      setUnknownBranches]      = useState([])
  const [loading,              setLoading]              = useState(true)
  const [selected,             setSelected]             = useState(new Set())
  const [sortBy,               setSortBy]               = useState('date_desc')
  const [search,               setSearch]               = useState('')
  const [creating,             setCreating]             = useState(false)
  const [moveType,             setMoveType]             = useState('EXTERNAL')
  const [destBranch,           setDestBranch]           = useState('')
  const [destSearch,           setDestSearch]           = useState('')
  const [destOpen,             setDestOpen]             = useState(false)
  const [ewayBillNo,           setEwayBillNo]           = useState('')
  const [showModal,            setShowModal]            = useState(false)
  const [lastConsignment,      setLastConsignment]      = useState(null)
  const [dismissWarning,       setDismissWarning]       = useState(false)
  const [previewNumbers,       setPreviewNumbers]       = useState(null)
  const [loadingPreview,       setLoadingPreview]       = useState(false)
  const [toast,                setToast]                = useState(null)
  const [updatingConsignment,  setUpdatingConsignment]  = useState(null)
  const [downloadingId,        setDownloadingId]        = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [p, b, s, u, ic] = await Promise.all([
      fetch('/api/consignments?action=stock_in_branch').then(r => r.json()),
      fetch('/api/consignments?action=branches').then(r => r.json()),
      fetch('/api/consignments?action=branch_summary').then(r => r.json()),
      fetch('/api/consignments?action=unknown_branches').then(r => r.json()),
      fetch('/api/consignments?action=consignments').then(r => r.json()),
    ])
    setPurchases(p.data || [])
    setBranches(b.data || [])
    setBranchSummary(s.data || [])
    setUnknownBranches(u.data || [])
    setInConsignment((ic.data || []).filter(c => c.status !== 'received'))
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Deep-link from Branch Stock Overview
  useEffect(() => {
    if (consignmentDeepLink) {
      setNav({ type: 'branch', branch: consignmentDeepLink.branch, fromRegion: consignmentDeepLink.region })
      setConsignmentDeepLink(null)
    }
  }, [consignmentDeepLink])

  // Default move type when source branch changes — hubs always go Direct → HO.
  // For non-hubs we leave it as EXTERNAL by default; user picks hub manually if needed.
  useEffect(() => {
    if (selectedBranches.length !== 1) { setDestBranch(''); setDestSearch(''); return }
    const src = branches.find(b => b.name === selectedBranches[0])
    if (src?.is_hub) {
      setMoveType('EXTERNAL')
      setDestBranch('')
      setDestSearch('')
    }
  }, [selectedBranches[0], branches])

  // Fetch branch-specific consignments when drilling into a branch on In Consignment tab
  useEffect(() => {
    if (tab === 'in_consignment' && nav?.type === 'branch') {
      fetchBranchConsignments(nav.branch)
    }
  }, [tab, nav?.branch, nav?.type])

  async function fetchBranchConsignments(branch) {
    setLoadingBranchCons(true)
    try {
      const res = await fetch(`/api/consignments?action=consignments&branch=${encodeURIComponent(branch)}`)
      const { data } = await res.json()
      setBranchConsignments((data || []).filter(c => c.status !== 'received' && c.status !== 'seed'))
    } finally {
      setLoadingBranchCons(false)
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const regionGroups = branchSummary.reduce((acc, b) => {
    const r = b.region || 'Other'
    if (!acc[r]) acc[r] = []
    acc[r].push(b)
    return acc
  }, {})

  const totalAtBranch  = branchSummary.reduce((s, b) => s + b.at_branch, 0)
  const totalInConsign = branchSummary.reduce((s, b) => s + b.in_consignment, 0)
  const totalAtBrWt    = branchSummary.reduce((s, b) => s + b.at_branch_wt, 0)
  const totalInConWt   = branchSummary.reduce((s, b) => s + b.in_consignment_wt, 0)
  const oldestBill     = purchases.reduce((o, p) => !o || new Date(p.purchase_date) < new Date(o.purchase_date) ? p : o, null)
  const heaviestBranch = branchSummary.reduce((h, b) => !h || b.at_branch_wt > h.at_branch_wt ? b : h, null)
  const heaviestTransit = branchSummary.reduce((m, b) => !m || b.in_consignment_wt > m.in_consignment_wt ? b : m, null)

  // ── Bills for current nav ─────────────────────────────────────────────────
  function getBillsForNav() {
    let bills = purchases
    if (nav?.type === 'region') {
      const branchesInRegion = branches.filter(b => b.region === nav.region).map(b => b.name)
      bills = bills.filter(p => branchesInRegion.includes(p.branch_name))
    }
    if (nav?.type === 'branch') bills = bills.filter(p => p.branch_name === nav.branch)
    if (search) {
      const q = search.toLowerCase()
      bills = bills.filter(p =>
        p.customer_name?.toLowerCase().includes(q) ||
        p.phone_number?.includes(q) ||
        p.application_id?.toLowerCase().includes(q)
      )
    }
    return [...bills].sort((a, b) => {
      if (sortBy === 'date_desc')   return new Date(b.purchase_date) - new Date(a.purchase_date)
      if (sortBy === 'oldest')      return new Date(a.purchase_date) - new Date(b.purchase_date)
      if (sortBy === 'weight_desc') return parseFloat(b.net_weight || 0) - parseFloat(a.net_weight || 0)
      if (sortBy === 'amount_desc') return parseFloat(b.final_amount_crm || 0) - parseFloat(a.final_amount_crm || 0)
      return 0
    })
  }

  const visibleBills     = getBillsForNav()
  const selectedRows     = visibleBills.filter(p => selected.has(p.id))
  const allSelected      = visibleBills.length > 0 && visibleBills.every(p => selected.has(p.id))
  const totalSelWt       = selectedRows.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalSelAmt      = selectedRows.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const selectedBranches = [...new Set(selectedRows.map(p => p.branch_name))]

  function toggleAll() {
    if (allSelected) { const n = new Set(selected); visibleBills.forEach(p => n.delete(p.id)); setSelected(n) }
    else { const n = new Set(selected); visibleBills.forEach(p => n.add(p.id)); setSelected(n) }
  }
  function toggleRow(id) { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }

  async function fetchPreviewNumbers() {
    if (selectedBranches.length !== 1) return
    setLoadingPreview(true)
    try {
      const res  = await fetch(`/api/consignments-preview?branch=${encodeURIComponent(selectedBranches[0])}&movement_type=${moveType}`)
      const data = await res.json()
      if (!data.error) setPreviewNumbers(data)
    } catch {}
    finally { setLoadingPreview(false) }
  }

  async function handleCreate() {
    if (!selected.size || selectedBranches.length !== 1) return
    if (moveType === 'INTERNAL' && !destBranch) {
      setToast({ msg: 'Select a destination hub before creating', type: 'error' })
      return
    }
    const branchName = selectedBranches[0]
    const branchInfo = branchSummary.find(b => b.branch === branchName)
    setCreating(true)
    try {
      const res = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_consignment',
          purchase_ids: [...selected],
          branch_name: branchName,
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
      setDestBranch('')
      setEwayBillNo('')
      await fetchAll()
      setTab('in_consignment')
      setNav({ type: 'branch', branch: branchName, fromRegion: branchInfo?.region })
    } finally { setCreating(false) }
  }

  async function updateConsignmentStatus(id, action) {
    setUpdatingConsignment(id)
    try {
      const res  = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      const data = await res.json()
      if (data.error) { setToast({ msg: data.error, type: 'error' }); return }
      setToast({ msg: `Marked as ${action === 'dispatch' ? 'dispatched' : 'received'}`, type: 'success' })
      await fetchAll()
      if (nav?.branch) await fetchBranchConsignments(nav.branch)
    } finally { setUpdatingConsignment(null) }
  }

  async function downloadChallan(c) {
    setDownloadingId(c.id)
    await triggerDownload(`/api/generate-challan-pdf?id=${c.id}`, `${c.challan_no?.replace(/\//g, '-')}.pdf`, msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  function drillRegion(region) { setNav({ type: 'region', region }); setSearch(''); setSelected(new Set()) }
  function drillBranch(branch, fromRegion) { setNav({ type: 'branch', branch, fromRegion }); setSearch(''); setSelected(new Set()) }
  function goBack() {
    if (nav?.type === 'branch') setNav(prev => prev.fromRegion ? { type: 'region', region: prev.fromRegion } : null)
    else setNav(null)
    setSearch('')
    setSelected(new Set())
  }

  const isAtBranch = tab === 'at_branch'
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  const Breadcrumb = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
      <span onClick={() => setNav(null)} style={{ color: nav ? t.text3 : t.text1, cursor: nav ? 'pointer' : 'default', fontWeight: nav ? 400 : 600 }}
        onMouseEnter={e => { if (nav) e.target.style.color = t.gold }}
        onMouseLeave={e => { if (nav) e.target.style.color = t.text3 }}>All Regions</span>
      {nav?.type === 'region' && <><span style={{ color: t.text4 }}>›</span><span style={{ color: t.text1, fontWeight: 600 }}>{nav.region}</span></>}
      {nav?.type === 'branch' && <>
        <span style={{ color: t.text4 }}>›</span>
        <span onClick={() => nav.fromRegion && setNav({ type: 'region', region: nav.fromRegion })}
          style={{ color: nav.fromRegion ? t.text3 : t.text4, cursor: nav.fromRegion ? 'pointer' : 'default' }}
          onMouseEnter={e => { if (nav.fromRegion) e.target.style.color = t.gold }}
          onMouseLeave={e => { if (nav.fromRegion) e.target.style.color = t.text3 }}>
          {nav.fromRegion || 'Region'}
        </span>
        <span style={{ color: t.text4 }}>›</span>
        <span style={{ color: t.text1, fontWeight: 600 }}>{nav.branch}</span>
      </>}
    </div>
  )

  // ── REGION LIST ───────────────────────────────────────────────────────────
  const RegionList = ({ statusKey, wtKey, color }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Object.entries(regionGroups).sort().map(([region, brs]) => {
        const rColor    = REGION_COLORS[region] || t.text3
        const rCount    = brs.reduce((s, b) => s + (b[statusKey] || 0), 0)
        const rWt       = brs.reduce((s, b) => s + (b[wtKey] || 0), 0)
        const activeBrs = brs.filter(b => (b[statusKey] || 0) > 0).length
        if (rCount === 0) return null

        return (
          <div key={region} onClick={() => drillRegion(region)}
            style={{ ...card, cursor: 'pointer', transition: 'all .15s', padding: '18px 22px' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = rColor + '50'; e.currentTarget.style.background = `${rColor}06` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = t.card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: `${rColor}15`, border: `1px solid ${rColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: rColor, boxShadow: `0 0 8px ${rColor}60` }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: rColor, marginBottom: '3px' }}>{region}</div>
                <div style={{ fontSize: '11px', color: t.text4 }}>{activeBrs} branch{activeBrs !== 1 ? 'es' : ''} with stock</div>
              </div>
              <div style={{ display: 'flex', gap: '36px', alignItems: 'center' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Bills</div>
                  <div style={{ fontSize: '28px', fontWeight: 200, color, fontFamily: 'monospace', lineHeight: 1 }}>{rCount}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Net Weight</div>
                  <div style={{ fontSize: '16px', fontWeight: 500, color: t.text2, fontFamily: 'monospace' }}>{fmtWt(rWt)}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.text4} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  // ── BRANCH LIST ───────────────────────────────────────────────────────────
  const BranchList = ({ statusKey, wtKey, color }) => {
    const brs = nav?.region
      ? branchSummary.filter(b => b.region === nav.region && (b[statusKey] || 0) > 0)
      : branchSummary.filter(b => (b[statusKey] || 0) > 0)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {brs.sort((a, b) => (b[statusKey] || 0) - (a[statusKey] || 0)).map(b => {
          const rColor    = REGION_COLORS[b.region] || t.text3
          const billsHere = purchases.filter(p => p.branch_name === b.branch)
          const oldest    = billsHere.reduce((o, p) => !o || new Date(p.purchase_date) < new Date(o.purchase_date) ? p : o, null)
          const oldD      = oldest ? daysSince(oldest.purchase_date) : 0
          const consigns  = inConsignment.filter(c => c.branch_name === b.branch && c.status !== 'received')

          return (
            <div key={b.branch} onClick={() => drillBranch(b.branch, nav?.region)}
              style={{ ...card, cursor: 'pointer', transition: 'all .15s', padding: '16px 20px' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = rColor + '50'; e.currentTarget.style.background = `${rColor}05` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = t.card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '4px', alignSelf: 'stretch', borderRadius: '4px', background: rColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: t.text1 }}>{b.branch}</span>
                    <span style={{ fontSize: '10px', color: rColor, background: `${rColor}15`, borderRadius: '4px', padding: '1px 7px', fontWeight: 500 }}>{b.region}</span>
                    {oldest && <AgeBadge days={oldD} t={t} />}
                  </div>
                  {statusKey === 'in_consignment' && consigns.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {consigns.map(c => (
                        <span key={c.id} style={{ fontSize: '10px', color: t.blue, background: `${t.blue}12`, borderRadius: '4px', padding: '2px 8px', fontFamily: 'monospace', fontWeight: 500 }}>
                          {c.tmp_prf_no} · {c.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '28px', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Bills</div>
                    <div style={{ fontSize: '24px', fontWeight: 200, color, fontFamily: 'monospace', lineHeight: 1 }}>{b[statusKey]}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Net Wt</div>
                    <div style={{ fontSize: '14px', fontWeight: 500, color: t.text2, fontFamily: 'monospace' }}>{fmtWt(b[wtKey])}</div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.text4} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── CONSIGNMENT LIST (In Consignment branch level) ────────────────────────
  const ConsignmentList = () => {
    if (loadingBranchCons) return <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
    if (branchConsignments.length === 0) return (
      <div style={{ ...card, padding: '48px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', opacity: .15, marginBottom: '12px' }}>◈</div>
        <div style={{ fontSize: '13px', color: t.text3 }}>No active consignments for this branch</div>
        <button onClick={() => setTab('at_branch')} style={{ ...btnGold, marginTop: '16px', fontSize: '11px', padding: '7px 18px' }}>
          View At Branch →
        </button>
      </div>
    )

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {branchConsignments.map(c => {
          const statusColor = c.status === 'dispatched' ? t.blue : t.orange
          const isNew = lastConsignment?.id === c.id
          const isUpdating = updatingConsignment === c.id
          const isDownloading = downloadingId === c.id

          return (
            <div key={c.id} style={{ ...card, padding: '20px 24px', borderColor: isNew ? `${t.green}40` : t.border, background: isNew ? `${t.green}06` : t.card, transition: 'all .2s' }}>
              {isNew && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', fontSize: '11px', color: t.green, fontWeight: 600 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.green, display: 'inline-block' }} />
                  Just created
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Numbers row */}
                  <div style={{ display: 'flex', gap: '20px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '2px' }}>TMP PRF</div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: t.gold, fontFamily: 'monospace' }}>{c.tmp_prf_no}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '2px' }}>Challan</div>
                      <div style={{ fontSize: '12px', color: t.blue, fontFamily: 'monospace', fontWeight: 500 }}>{c.challan_no}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '2px' }}>Status</div>
                      <span style={{ fontSize: '11px', color: statusColor, background: `${statusColor}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600, textTransform: 'capitalize' }}>{c.status}</span>
                    </div>
                  </div>
                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: '24px', fontSize: '12px', color: t.text3 }}>
                    <span><span style={{ color: t.text4 }}>Bills</span> <span style={{ color: t.text2, fontWeight: 600 }}>{c.total_bills}</span></span>
                    <span><span style={{ color: t.text4 }}>Net Wt</span> <span style={{ color: t.gold, fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(c.total_net_wt)}</span></span>
                    <span><span style={{ color: t.text4 }}>Amount</span> <span style={{ color: t.text2, fontFamily: 'monospace' }}>₹{fmt(Math.round(c.total_amount))}</span></span>
                    <span><span style={{ color: t.text4 }}>Created</span> <span style={{ color: t.text3 }}>{fmtTS(c.created_at)}</span></span>
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', flexShrink: 0 }}>
                  <button onClick={() => downloadChallan(c)} disabled={isDownloading}
                    style={{ ...btnGold, fontSize: '11px', padding: '6px 14px', opacity: isDownloading ? .6 : 1 }}>
                    {isDownloading ? '⏳ PDF…' : '📄 Challan PDF'}
                  </button>
                  {c.status === 'draft' && (
                    <button onClick={() => updateConsignmentStatus(c.id, 'dispatch')} disabled={isUpdating}
                      style={{ background: t.blue, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '11px', fontWeight: 600, cursor: isUpdating ? 'not-allowed' : 'pointer', opacity: isUpdating ? .6 : 1 }}>
                      {isUpdating ? '…' : '↑ Mark Dispatched'}
                    </button>
                  )}
                  {c.status === 'dispatched' && (
                    <button onClick={() => updateConsignmentStatus(c.id, 'receive')} disabled={isUpdating}
                      style={{ background: t.green, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '11px', fontWeight: 600, cursor: isUpdating ? 'not-allowed' : 'pointer', opacity: isUpdating ? .6 : 1 }}>
                      {isUpdating ? '…' : '✓ Mark Received'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── BILL LIST ─────────────────────────────────────────────────────────────
  const BillList = () => (
    <>
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
        <div style={{ fontSize: '11px', color: t.text4, marginLeft: 'auto' }}>{visibleBills.length} bills</div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div style={{ background: `${t.gold}0d`, border: `1px solid ${t.gold}30`, borderRadius: '10px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', align: 'center', gap: '10px', flex: 1 }}>
            <span style={{ fontSize: '13px', color: t.gold, fontWeight: 700 }}>{selected.size} selected</span>
            <span style={{ fontSize: '12px', color: t.text3 }}>{fmtWt(totalSelWt)}</span>
            <span style={{ fontSize: '12px', color: t.text3 }}>₹{fmt(Math.round(totalSelAmt))}</span>
            {selectedBranches.length > 1 && <span style={{ fontSize: '11px', color: t.red, fontWeight: 600 }}>⚠ Must select from one branch only</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={moveType} onChange={e => setMoveType(e.target.value)}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '6px 10px', fontSize: '11px', color: t.text2, outline: 'none' }}>
              <option value="EXTERNAL">External — Branch → HO</option>
              <option value="INTERNAL">Internal — Branch → Hub</option>
            </select>
            <button onClick={() => { setShowModal(true); fetchPreviewNumbers() }} disabled={selectedBranches.length !== 1}
              style={{ ...btnGold, opacity: selectedBranches.length !== 1 ? .5 : 1 }}>
              Create Consignment →
            </button>
            <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 440px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ padding: '10px 14px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: t.gold }} />
                </th>
                {['Date','Branch','Customer','App ID','Net Wt','Amount','Age','Type'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Net Wt' || h === 'Amount' ? 'right' : 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div></td></tr>
              ) : visibleBills.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No bills found</td></tr>
              ) : visibleBills.map(row => {
                const isSel  = selected.has(row.id)
                const br     = branches.find(b => b.name === row.branch_name)
                const rColor = REGION_COLORS[br?.region] || t.text3
                const days   = daysSince(row.purchase_date)
                return (
                  <tr key={row.id} onClick={() => toggleRow(row.id)}
                    style={{ borderBottom: `1px solid ${t.border}15`, background: isSel ? `${t.gold}08` : 'transparent', cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = `${t.gold}04` }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} style={{ cursor: 'pointer', accentColor: t.gold }} />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: `${rColor}18`, color: rColor, borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.branch_name}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text1, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
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

  // ── What to render in content area ────────────────────────────────────────
  const renderContent = () => {
    if (loading) return <div style={{ padding: '64px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>

    if (nav?.type === 'branch') {
      if (!isAtBranch) return <ConsignmentList />
      return <BillList />
    }
    if (nav?.type === 'region') {
      return <BranchList statusKey={isAtBranch ? 'at_branch' : 'in_consignment'} wtKey={isAtBranch ? 'at_branch_wt' : 'in_consignment_wt'} color={isAtBranch ? t.gold : t.orange} />
    }
    return <RegionList statusKey={isAtBranch ? 'at_branch' : 'in_consignment'} wtKey={isAtBranch ? 'at_branch_wt' : 'in_consignment_wt'} color={isAtBranch ? t.gold : t.orange} />
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = isAtBranch ? [
    { label: 'Bills At Branch',  value: totalAtBranch,    sub: fmtWt(totalAtBrWt),  color: t.gold },
    { label: 'Active Branches',  value: branchSummary.filter(b => b.at_branch > 0).length, sub: 'branches with stock', color: t.blue },
    { label: 'Oldest Bill',      value: `${daysSince(oldestBill?.purchase_date)}d`, sub: oldestBill ? `${oldestBill.branch_name} · ${fmtDate(oldestBill?.purchase_date)}` : '—', color: daysSince(oldestBill?.purchase_date) > 7 ? t.red : t.orange },
    { label: 'Heaviest Branch',  value: heaviestBranch?.branch || '—', sub: fmtWt(heaviestBranch?.at_branch_wt), color: t.purple },
  ] : [
    { label: 'Bills In Transit', value: totalInConsign,   sub: fmtWt(totalInConWt), color: t.orange },
    { label: 'Draft Consignments', value: inConsignment.filter(c => c.status === 'draft').length, sub: 'awaiting dispatch', color: t.blue },
    { label: 'Dispatched',      value: inConsignment.filter(c => c.status === 'dispatched').length, sub: 'en route to HO', color: t.green },
    { label: 'Heaviest Transit', value: heaviestTransit?.branch || '—', sub: fmtWt(heaviestTransit?.in_consignment_wt), color: t.gold },
  ]

  return (
    <div style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>Stock in Branch</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>Outside Bangalore · {purchases.length} bills pending consignment</div>
        </div>
        <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* Unknown branch warning */}
      {unknownBranches.length > 0 && !dismissWarning && (
        <div style={{ padding: '12px 16px', background: `${t.red}0c`, border: `1px solid ${t.red}30`, borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span>
            <div>
              <div style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>Unknown branches not in Branch Management</div>
              <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>{unknownBranches.join(' · ')}</div>
            </div>
          </div>
          <button onClick={() => setDismissWarning(true)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px', flexShrink: 0, marginLeft: '12px' }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: t.card2, borderRadius: '11px', padding: '4px', border: `1px solid ${t.border}`, gap: '4px' }}>
        {[
          { key: 'at_branch',      label: 'At Branch',      count: totalAtBranch,  color: t.gold },
          { key: 'in_consignment', label: 'In Consignment', count: totalInConsign, color: t.orange },
        ].map(tb => (
          <button key={tb.key} onClick={() => { setTab(tb.key); setNav(null); setSelected(new Set()) }}
            style={{ flex: 1, padding: '10px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'all .15s',
              background: tab === tb.key ? t.card : 'transparent',
              boxShadow: tab === tb.key ? '0 1px 8px rgba(0,0,0,.2)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: tab === tb.key ? tb.color : t.text4 }}>{tb.label}</span>
            <span style={{ fontSize: '11px', background: tab === tb.key ? `${tb.color}22` : 'transparent', color: tab === tb.key ? tb.color : t.text4, borderRadius: '20px', padding: '1px 10px', fontWeight: 700, border: `1px solid ${tab === tb.key ? tb.color + '40' : t.border}`, transition: 'all .15s' }}>{tb.count}</span>
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: t.card, padding: '15px 18px' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '7px', fontWeight: 600 }}>{k.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 300, color: k.color, lineHeight: 1, fontFamily: 'monospace' }}>{k.value}</div>
            {k.sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Breadcrumb + Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {nav && (
          <button onClick={goBack} style={{ ...btnOut, padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            ← Back
          </button>
        )}
        <Breadcrumb />
      </div>

      {/* Content */}
      {renderContent()}

      {/* Confirm modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: '16px', padding: '28px', width: '460px', maxWidth: '92vw', boxShadow: '0 24px 64px rgba(0,0,0,.4)' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: t.text1, marginBottom: '6px' }}>Confirm Consignment</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '22px' }}>Review and confirm before creating.</div>

            {(() => {
              const src      = branches.find(b => b.name === selectedBranches[0])
              const isHub    = !!src?.is_hub
              const allHubs  = branches.filter(b => b.is_hub && b.name !== selectedBranches[0])
              const filteredHubs = destSearch
                ? allHubs.filter(b =>
                    b.name.toLowerCase().includes(destSearch.toLowerCase()) ||
                    (b.region || '').toLowerCase().includes(destSearch.toLowerCase()))
                : allHubs

              return (
                <>
                  {/* Movement type selector — disabled when source is a hub */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', padding: '4px', background: t.card2, borderRadius: '9px' }}>
                    <button type="button" onClick={() => setMoveType('EXTERNAL')}
                      style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '7px', cursor: 'pointer',
                        background: moveType === 'EXTERNAL' ? t.card : 'transparent',
                        color: moveType === 'EXTERNAL' ? t.gold : t.text3, fontWeight: moveType === 'EXTERNAL' ? 700 : 500, fontSize: '11px',
                        boxShadow: moveType === 'EXTERNAL' ? '0 1px 4px rgba(0,0,0,.2)' : 'none' }}>
                      Direct → HO
                    </button>
                    <button type="button" onClick={() => setMoveType('INTERNAL')} disabled={isHub || allHubs.length === 0}
                      title={isHub ? 'Hubs ship directly to HO' : allHubs.length === 0 ? 'No hubs configured yet — mark a branch as hub in Branch Management' : ''}
                      style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '7px',
                        cursor: isHub || allHubs.length === 0 ? 'not-allowed' : 'pointer',
                        opacity: isHub || allHubs.length === 0 ? 0.4 : 1,
                        background: moveType === 'INTERNAL' ? t.card : 'transparent',
                        color: moveType === 'INTERNAL' ? t.purple : t.text3, fontWeight: moveType === 'INTERNAL' ? 700 : 500, fontSize: '11px',
                        boxShadow: moveType === 'INTERNAL' ? '0 1px 4px rgba(0,0,0,.2)' : 'none' }}>
                      Via Hub → HO
                    </button>
                  </div>

                  {/* Hub typeahead (INTERNAL only) */}
                  {moveType === 'INTERNAL' && (
                    <div style={{ marginBottom: '14px', position: 'relative' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '5px', fontWeight: 600 }}>Destination Hub</div>
                      <input
                        value={destBranch && !destOpen ? destBranch : destSearch}
                        onFocus={() => { setDestOpen(true); setDestSearch('') }}
                        onChange={e => { setDestSearch(e.target.value); setDestBranch(''); setDestOpen(true) }}
                        placeholder="Type to search hubs…"
                        style={{ width: '100%', background: t.card2, border: `1px solid ${destBranch ? t.purple + '60' : t.border2}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
                      {destOpen && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: t.card, border: `1px solid ${t.border2}`, borderRadius: '8px', maxHeight: '200px', overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                          {filteredHubs.length === 0 ? (
                            <div style={{ padding: '14px', fontSize: '12px', color: t.text4, textAlign: 'center' }}>No hubs match</div>
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
                      <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>Pick any hub. On receive, bills move to that hub. Issue Voucher will be generated.</div>
                    </div>
                  )}

                  {/* Summary rows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                    {[
                      ['Source',       selectedBranches[0]],
                      moveType === 'INTERNAL' ? ['Destination', destBranch || '— select above —'] : ['Destination', 'Head Office'],
                      ['Bills',        `${selected.size}`],
                      ['Net Weight',   fmtWt(totalSelWt)],
                      ['Amount',       `₹${fmt(Math.round(totalSelAmt))}`],
                      ['Document',     moveType === 'EXTERNAL' ? 'Delivery Challan' : 'Issue Voucher'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: t.card2, borderRadius: '8px' }}>
                        <span style={{ fontSize: '12px', color: t.text3 }}>{label}</span>
                        <span style={{ fontSize: '12px', color: t.text1, fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* E-Way Bill (optional) — only for EXTERNAL */}
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
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '18px', padding: '11px 14px', background: `${t.gold}08`, borderRadius: '8px', border: `1px solid ${t.gold}20`, textAlign: 'center' }}>Generating preview numbers…</div>
            ) : previewNumbers ? (
              <div style={{ marginBottom: '18px', display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1, padding: '10px 14px', background: `${t.gold}10`, borderRadius: '8px', border: `1px solid ${t.gold}30` }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>TMP PRF No</div>
                  <div style={{ fontSize: '13px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>{previewNumbers.tmp_prf_no}</div>
                </div>
                <div style={{ flex: 1, padding: '10px 14px', background: `${t.blue}10`, borderRadius: '8px', border: `1px solid ${t.blue}30` }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Challan No</div>
                  <div style={{ fontSize: '11px', color: t.blue, fontWeight: 600, fontFamily: 'monospace' }}>{previewNumbers.challan_no}</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '18px', padding: '11px 14px', background: `${t.gold}08`, borderRadius: '8px', border: `1px solid ${t.gold}20` }}>
                Numbers will be auto-generated on creation.
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
