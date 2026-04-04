'use client'

import { useState, useEffect, useCallback } from 'react'
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
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt       = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt     = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate   = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0

const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
}

function AgeBadge({ days, t }) {
  const color = days > 14 ? t.red : days > 7 ? t.orange : t.green
  return <span style={{ fontSize: '10px', color, background: `${color}18`, borderRadius: '4px', padding: '2px 6px', fontWeight: 700 }}>{days}d</span>
}

function Kpi({ icon, label, value, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '10px', color: '#6a5a3a', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>{icon}</span>{label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 300, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#6a5a3a', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )
}

export default function ConsignmentData() {
  const { theme } = useApp()
  const t = THEMES[theme]

  // Navigation stack: null = top, {type:'region', region} = region level, {type:'branch', branch} = branch level
  const [nav,             setNav]             = useState(null)
  const [tab,             setTab]             = useState('at_branch')
  const [purchases,       setPurchases]       = useState([])
  const [inConsignment,   setInConsignment]   = useState([])
  const [branches,        setBranches]        = useState([])
  const [branchSummary,   setBranchSummary]   = useState([])
  const [unknownBranches, setUnknownBranches] = useState([])
  const [loading,         setLoading]         = useState(true)
  const [selected,        setSelected]        = useState(new Set())
  const [sortBy,          setSortBy]          = useState('date_desc')
  const [search,          setSearch]          = useState('')
  const [creating,        setCreating]        = useState(false)
  const [moveType,        setMoveType]        = useState('EXTERNAL')
  const [showModal,       setShowModal]       = useState(false)
  const [lastConsignment, setLastConsignment] = useState(null)
  const [dismissWarning,  setDismissWarning]  = useState(false)
  const [previewNumbers,  setPreviewNumbers]  = useState(null)
  const [loadingPreview,  setLoadingPreview]  = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [p, b, s, u, ic] = await Promise.all([
      fetch('/api/consignments?action=stock_in_branch').then(r => r.json()),
      fetch('/api/consignments?action=branches').then(r => r.json()),
      fetch('/api/consignments?action=branch_summary').then(r => r.json()),
      fetch('/api/consignments?action=unknown_branches').then(r => r.json()),
      fetch('/api/consignments?action=consignments&status=draft').then(r => r.json()),
    ])
    setPurchases(p.data || [])
    setBranches(b.data || [])
    setBranchSummary(s.data || [])
    setUnknownBranches(u.data || [])
    setInConsignment(ic.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

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

  const oldestBill = purchases.reduce((o, p) => !o || new Date(p.purchase_date) < new Date(o.purchase_date) ? p : o, null)
  const heaviestBranch = branchSummary.reduce((h, b) => !h || b.at_branch_wt > h.at_branch_wt ? b : h, null)

  // ── Bills for current nav context ─────────────────────────────────────────
  function getBillsForNav() {
    let bills = purchases
    if (nav?.type === 'region') {
      const branchesInRegion = branches.filter(b => b.region === nav.region).map(b => b.name)
      bills = bills.filter(p => branchesInRegion.includes(p.branch_name))
    }
    if (nav?.type === 'branch') {
      bills = bills.filter(p => p.branch_name === nav.branch)
    }
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
      const res = await fetch(`/api/consignments-preview?branch=${encodeURIComponent(selectedBranches[0])}&movement_type=${moveType}`)
      const data = await res.json()
      if (!data.error) setPreviewNumbers(data)
    } catch (err) {
      console.error('Preview error:', err)
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleCreate() {
    if (!selected.size || selectedBranches.length !== 1) return
    setCreating(true)
    try {
      const res = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_consignment', purchase_ids: [...selected], branch_name: selectedBranches[0], movement_type: moveType })
      })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); return }
      setLastConsignment(result.data)
      setSelected(new Set())
      setShowModal(false)
      setNav(null)
      await fetchAll()
    } finally { setCreating(false) }
  }

  // ── Nav helpers ───────────────────────────────────────────────────────────
  function drillRegion(region) { setNav({ type: 'region', region }); setSearch(''); setSelected(new Set()) }
  function drillBranch(branch, fromRegion) { setNav({ type: 'branch', branch, fromRegion }); setSearch(''); setSelected(new Set()) }
  function goBack() {
    if (nav?.type === 'branch') setNav(prev => prev.fromRegion ? { type: 'region', region: prev.fromRegion } : null)
    else setNav(null)
    setSearch('')
    setSelected(new Set())
  }

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', overflow: 'hidden' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  const Breadcrumb = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
      <span onClick={() => setNav(null)} style={{ color: nav ? t.text3 : t.text1, cursor: nav ? 'pointer' : 'default', fontWeight: nav ? 400 : 600 }}
        onMouseEnter={e => { if (nav) e.target.style.color = t.gold }}
        onMouseLeave={e => { if (nav) e.target.style.color = t.text3 }}>
        All Regions
      </span>
      {nav?.type === 'region' && <>
        <span style={{ color: t.text4 }}>›</span>
        <span style={{ color: t.text1, fontWeight: 600 }}>{nav.region}</span>
      </>}
      {nav?.type === 'branch' && <>
        <span style={{ color: t.text4 }}>›</span>
        <span onClick={() => nav.fromRegion && setNav({ type: 'region', region: nav.fromRegion })}
          style={{ color: nav.fromRegion ? t.text3 : t.text4, cursor: nav.fromRegion ? 'pointer' : 'default' }}>
          {nav.fromRegion || 'Region'}
        </span>
        <span style={{ color: t.text4 }}>›</span>
        <span style={{ color: t.text1, fontWeight: 600 }}>{nav.branch}</span>
      </>}
    </div>
  )

  // ── REGION LEVEL ──────────────────────────────────────────────────────────
  const RegionList = ({ statusKey, wtKey, color }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Object.entries(regionGroups).sort().map(([region, brs]) => {
        const rColor   = REGION_COLORS[region] || t.text3
        const rCount   = brs.reduce((s, b) => s + (b[statusKey] || 0), 0)
        const rWt      = brs.reduce((s, b) => s + (b[wtKey] || 0), 0)
        const activeBrs = brs.filter(b => (b[statusKey] || 0) > 0).length
        if (rCount === 0) return null

        return (
          <div key={region} onClick={() => drillRegion(region)}
            style={{ ...card, cursor: 'pointer', transition: 'border-color .15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = rColor + '60'}
            onMouseLeave={e => e.currentTarget.style.borderColor = t.border}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: `${rColor}20`, border: `2px solid ${rColor}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: rColor }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: rColor }}>{region}</div>
                <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>{activeBrs} branch{activeBrs !== 1 ? 'es' : ''} with stock</div>
              </div>
              <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: t.text4, marginBottom: '3px' }}>BILLS</div>
                  <div style={{ fontSize: '22px', fontWeight: 300, color, fontFamily: 'monospace' }}>{rCount}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: t.text4, marginBottom: '3px' }}>NET WEIGHT</div>
                  <div style={{ fontSize: '15px', fontWeight: 500, color: t.text2, fontFamily: 'monospace' }}>{fmtWt(rWt)}</div>
                </div>
                <div style={{ color: t.text4, fontSize: '18px' }}>›</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  // ── BRANCH LEVEL ──────────────────────────────────────────────────────────
  const BranchList = ({ statusKey, wtKey, color }) => {
    const brs = nav?.region
      ? branchSummary.filter(b => b.region === nav.region && (b[statusKey] || 0) > 0)
      : branchSummary.filter(b => (b[statusKey] || 0) > 0)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {brs.sort((a, b) => (b[statusKey] || 0) - (a[statusKey] || 0)).map(b => {
          const billsHere = purchases.filter(p => p.branch_name === b.branch)
          const oldest    = billsHere.reduce((o, p) => !o || new Date(p.purchase_date) < new Date(o.purchase_date) ? p : o, null)
          const oldD      = oldest ? daysSince(oldest.purchase_date) : 0
          const rColor    = REGION_COLORS[b.region] || t.text3
          const consigns  = inConsignment.filter(c => c.branch_name === b.branch)

          return (
            <div key={b.branch} onClick={() => drillBranch(b.branch, nav?.region)}
              style={{ ...card, cursor: 'pointer', transition: 'border-color .15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = rColor + '60'}
              onMouseLeave={e => e.currentTarget.style.borderColor = t.border}>
              <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: t.text1 }}>{b.branch}</span>
                    <span style={{ fontSize: '10px', color: rColor, background: `${rColor}15`, borderRadius: '4px', padding: '1px 6px' }}>{b.region}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: t.text4, marginTop: '4px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {oldest && <span>Oldest: {fmtDate(oldest.purchase_date)}</span>}
                    <AgeBadge days={oldD} t={t} />
                    {consigns.length > 0 && statusKey === 'in_consignment' && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {consigns.map(c => (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: `${t.blue}15`, borderRadius: '6px', padding: '3px 8px' }}>
                            <span style={{ color: t.blue, fontSize: '11px', fontWeight: 600 }}>{c.tmp_prf_no}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                triggerDownload(`/api/generate-challan-pdf?id=${c.id}`, `${c.challan_no?.replace(/\//g,'-')}.pdf`)
                              }}
                              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '9px', fontWeight: 700, cursor: 'pointer', letterSpacing: '.03em' }}
                            >
                              PDF
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: t.text4, marginBottom: '3px' }}>BILLS</div>
                    <div style={{ fontSize: '22px', fontWeight: 300, color, fontFamily: 'monospace' }}>{b[statusKey]}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: t.text4, marginBottom: '3px' }}>NET WEIGHT</div>
                    <div style={{ fontSize: '14px', fontWeight: 500, color: t.text2, fontFamily: 'monospace' }}>{fmtWt(b[wtKey])}</div>
                  </div>
                  <div style={{ color: t.text4, fontSize: '18px' }}>›</div>
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
      {/* Controls bar */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, app ID..."
          style={{ flex: 1, minWidth: '200px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 12px', fontSize: '12px', color: t.text1, outline: 'none' }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="date_desc">Latest First</option>
          <option value="oldest">Oldest First</option>
          <option value="weight_desc">Heaviest First</option>
          <option value="amount_desc">Highest Amount</option>
        </select>
        <div style={{ fontSize: '11px', color: t.text4 }}>{visibleBills.length} bills</div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div style={{ ...card, padding: '10px 16px', background: `${t.gold}10`, border: `1px solid ${t.gold}35`, display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{selected.size} selected</div>
          <div style={{ fontSize: '12px', color: t.text3 }}>{fmtWt(totalSelWt)} · ₹{fmt(Math.round(totalSelAmt))}</div>
          {selectedBranches.length > 1 && <div style={{ fontSize: '12px', color: t.red }}>⚠ Select one branch only</div>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <select value={moveType} onChange={e => setMoveType(e.target.value)}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text2, outline: 'none' }}>
              <option value="EXTERNAL">External (Branch → HO)</option>
              <option value="INTERNAL">Internal (Branch → Hub)</option>
            </select>
            <button onClick={() => { setShowModal(true); fetchPreviewNumbers() }} disabled={selectedBranches.length !== 1} style={{ ...btnGold, opacity: selectedBranches.length !== 1 ? .5 : 1 }}>
              Create Consignment
            </button>
            <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ ...card }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ padding: '10px 14px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: t.gold }} />
                </th>
                {['Date','Branch','Customer','App ID','Net Wt','Amount','Age','Type'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div></td></tr>
              ) : visibleBills.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: t.text4 }}>No bills found</td></tr>
              ) : visibleBills.map(row => {
                const isSel  = selected.has(row.id)
                const br     = branches.find(b => b.name === row.branch_name)
                const rColor = REGION_COLORS[br?.region] || t.text3
                const days   = daysSince(row.purchase_date)
                return (
                  <tr key={row.id} onClick={() => toggleRow(row.id)}
                    style={{ borderBottom: `1px solid ${t.border}15`, background: isSel ? `${t.gold}08` : 'transparent', cursor: 'pointer' }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = `${t.gold}05` }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} style={{ cursor: 'pointer', accentColor: t.gold }} />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: `${rColor}18`, color: rColor, borderRadius: '5px', padding: '3px 8px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.branch_name}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text1, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
                    <td style={{ padding: '10px 14px', fontSize: '11px', color: t.text4, fontFamily: 'monospace' }}>{row.application_id}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(row.net_weight)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(row.final_amount_crm))}</td>
                    <td style={{ padding: '10px 14px' }}><AgeBadge days={days} t={t} /></td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: '10px', color: row.transaction_type === 'TAKEOVER' ? t.purple : t.green, background: row.transaction_type === 'TAKEOVER' ? `${t.purple}15` : `${t.green}15`, borderRadius: '4px', padding: '2px 6px' }}>{row.transaction_type}</span>
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

  const isAtBranch = tab === 'at_branch'

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Stock in Branch</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '3px' }}>Outside Bangalore · {purchases.length} bills pending consignment</div>
        </div>
        <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* Unknown branch warning */}
      {unknownBranches.length > 0 && !dismissWarning && (
        <div style={{ padding: '11px 16px', background: `${t.red}10`, border: `1px solid ${t.red}35`, borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span>⚠️</span>
            <div>
              <div style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>Unknown branches in purchase data — not in Branch Management</div>
              <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>{unknownBranches.join(' · ')}</div>
            </div>
          </div>
          <button onClick={() => setDismissWarning(true)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px', flexShrink: 0, marginLeft: '12px' }}>✕</button>
        </div>
      )}

      {/* Success banner */}
      {lastConsignment && (
        <div style={{ padding: '11px 16px', background: `${t.green}10`, border: `1px solid ${t.green}35`, borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', color: t.green, fontWeight: 600 }}>✓ Consignment Created Successfully</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px', display: 'flex', gap: '16px' }}>
              <span>TMP PRF: <strong style={{ color: t.gold, fontFamily: 'monospace' }}>{lastConsignment.tmp_prf_no}</strong></span>
              <span>Challan: <strong style={{ color: t.blue, fontFamily: 'monospace' }}>{lastConsignment.challan_no}</strong></span>
              <span>{lastConsignment.total_bills} bills · {fmtWt(lastConsignment.total_net_wt)}</span>
            </div>
          </div>
          <button onClick={() => setLastConsignment(null)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px' }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', background: t.card2, borderRadius: '10px', padding: '4px', border: `1px solid ${t.border}` }}>
        {[
          { key: 'at_branch',      label: 'At Branch',      count: totalAtBranch,  color: t.gold },
          { key: 'in_consignment', label: 'In Consignment', count: totalInConsign, color: t.orange },
        ].map(tb => (
          <button key={tb.key} onClick={() => { setTab(tb.key); setNav(null); setSelected(new Set()) }} style={{
            flex: 1, padding: '9px 16px', border: 'none', borderRadius: '7px', cursor: 'pointer', transition: 'all .15s',
            background: tab === tb.key ? t.card : 'transparent',
            boxShadow: tab === tb.key ? `0 1px 6px rgba(0,0,0,.25)` : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: tab === tb.key ? tb.color : t.text4 }}>{tb.label}</span>
            <span style={{ fontSize: '11px', background: tab === tb.key ? `${tb.color}22` : 'transparent', color: tab === tb.key ? tb.color : t.text4, borderRadius: '20px', padding: '1px 9px', fontWeight: 700, border: `1px solid ${tab === tb.key ? tb.color + '40' : t.border}` }}>{tb.count}</span>
          </button>
        ))}
      </div>

      {/* KPI strip */}
      {(() => {
        const heaviestTransit = branchSummary.reduce((m, b) => !m || b.in_consignment_wt > m.in_consignment_wt ? b : m, null)
        const kpis = isAtBranch ? [
          { icon: '📦', label: 'Bills At Branch',  value: totalAtBranch,    sub: fmtWt(totalAtBrWt),  color: t.gold },
          { icon: '🏪', label: 'Active Branches',  value: branchSummary.filter(b => b.at_branch > 0).length, sub: 'branches with stock', color: t.blue },
          { icon: '⏰', label: 'Oldest Bill',       value: `${daysSince(oldestBill?.purchase_date)}d`, sub: oldestBill ? `${oldestBill.branch_name} · ${fmtDate(oldestBill?.purchase_date)}` : '—', color: daysSince(oldestBill?.purchase_date) > 14 ? t.red : t.green },
          { icon: '⚖️', label: 'Heaviest Branch',  value: heaviestBranch?.branch || '—', sub: fmtWt(heaviestBranch?.at_branch_wt), color: t.purple },
        ] : [
          { icon: '🚚', label: 'Bills In Transit', value: totalInConsign,   sub: fmtWt(totalInConWt), color: t.orange },
          { icon: '📋', label: 'Consignments',     value: inConsignment.length, sub: 'draft / pending dispatch', color: t.blue },
          { icon: '🗺️', label: 'Active Regions',  value: Object.keys(regionGroups).filter(r => regionGroups[r].some(b => b.in_consignment > 0)).length, sub: 'with in-transit stock', color: t.purple },
          { icon: '⚖️', label: 'Heaviest Transit', value: heaviestTransit?.branch || '—', sub: fmtWt(heaviestTransit?.in_consignment_wt), color: t.gold },
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: t.border, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
            {kpis.map(k => (
              <div key={k.label} style={{ background: t.card, padding: '14px 18px' }}>
                <Kpi {...k} />
              </div>
            ))}
          </div>
        )
      })()}

      {/* Breadcrumb + Back */}
      {nav && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={goBack} style={{ ...btnOut, padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            ← Back
          </button>
          <Breadcrumb />
        </div>
      )}
      {!nav && <Breadcrumb />}

      {/* Content */}
      {loading ? (
        <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
      ) : nav?.type === 'branch' ? (
        <BillList />
      ) : nav?.type === 'region' ? (
        <BranchList statusKey={isAtBranch ? 'at_branch' : 'in_consignment'} wtKey={isAtBranch ? 'at_branch_wt' : 'in_consignment_wt'} color={isAtBranch ? t.gold : t.orange} />
      ) : (
        <RegionList statusKey={isAtBranch ? 'at_branch' : 'in_consignment'} wtKey={isAtBranch ? 'at_branch_wt' : 'in_consignment_wt'} color={isAtBranch ? t.gold : t.orange} />
      )}

      {/* Confirm modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '28px', width: '440px', maxWidth: '90vw' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: t.text1, marginBottom: '20px' }}>Confirm Consignment</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {[
                ['Branch',       selectedBranches[0]],
                ['Bills',        `${selected.size} bills`],
                ['Net Weight',   fmtWt(totalSelWt)],
                ['Amount',       `₹${fmt(Math.round(totalSelAmt))}`],
                ['Movement',     moveType === 'EXTERNAL' ? 'External (Branch → HO)' : 'Internal (Branch → Hub)'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: t.card2, borderRadius: '7px' }}>
                  <span style={{ fontSize: '12px', color: t.text3 }}>{label}</span>
                  <span style={{ fontSize: '12px', color: t.text1, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
            {/* Preview Numbers */}
            {loadingPreview ? (
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '18px', padding: '10px 14px', background: `${t.gold}08`, borderRadius: '7px', border: `1px solid ${t.gold}20`, textAlign: 'center' }}>
                Loading preview...
              </div>
            ) : previewNumbers ? (
              <div style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: `${t.gold}10`, borderRadius: '7px', border: `1px solid ${t.gold}30` }}>
                  <span style={{ fontSize: '11px', color: t.text3, fontWeight: 600 }}>TMP PRF No</span>
                  <span style={{ fontSize: '12px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>{previewNumbers.tmp_prf_no}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: `${t.blue}10`, borderRadius: '7px', border: `1px solid ${t.blue}30` }}>
                  <span style={{ fontSize: '11px', color: t.text3, fontWeight: 600 }}>Challan No</span>
                  <span style={{ fontSize: '11px', color: t.blue, fontWeight: 600, fontFamily: 'monospace' }}>{previewNumbers.challan_no}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '18px', padding: '10px 14px', background: `${t.gold}08`, borderRadius: '7px', border: `1px solid ${t.gold}20` }}>
                ℹ TMP PRF No and Challan No will be auto-generated
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnOut}>Cancel</button>
              <button onClick={handleCreate} disabled={creating} style={{ ...btnGold, padding: '8px 20px', opacity: creating ? .7 : 1 }}>
                {creating ? 'Creating...' : 'Confirm & Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}