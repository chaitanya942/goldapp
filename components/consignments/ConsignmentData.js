'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null

const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
}

// Aging badge
function AgeBadge({ days, t }) {
  if (days === null) return null
  const color = days > 14 ? t.red : days > 7 ? t.orange : t.green
  return (
    <span style={{ fontSize: '10px', color, background: `${color}18`, borderRadius: '4px', padding: '1px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {days}d
    </span>
  )
}

export default function ConsignmentData() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [tab,              setTab]              = useState('at_branch')  // at_branch | in_consignment
  const [view,             setView]             = useState('summary')    // summary | list
  const [purchases,        setPurchases]        = useState([])
  const [inConsignment,    setInConsignment]    = useState([])
  const [branches,         setBranches]         = useState([])
  const [branchSummary,    setBranchSummary]    = useState([])
  const [unknownBranches,  setUnknownBranches]  = useState([])
  const [loading,          setLoading]          = useState(true)
  const [selected,         setSelected]         = useState(new Set())
  const [filterBranch,     setFilterBranch]     = useState('')
  const [filterRegion,     setFilterRegion]     = useState('')
  const [filterDateFrom,   setFilterDateFrom]   = useState('')
  const [filterDateTo,     setFilterDateTo]     = useState('')
  const [search,           setSearch]           = useState('')
  const [sortBy,           setSortBy]           = useState('date_desc')
  const [creating,         setCreating]         = useState(false)
  const [moveType,         setMoveType]         = useState('EXTERNAL')
  const [showModal,        setShowModal]        = useState(false)
  const [lastConsignment,  setLastConsignment]  = useState(null)
  const [expandedRegions,  setExpandedRegions]  = useState({})
  const [dismissedWarning, setDismissedWarning] = useState(false)
  const [expandedBranches, setExpandedBranches] = useState({})

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [p, b, s, u] = await Promise.all([
      fetch('/api/consignments?action=stock_in_branch').then(r => r.json()),
      fetch('/api/consignments?action=branches').then(r => r.json()),
      fetch('/api/consignments?action=branch_summary').then(r => r.json()),
      fetch('/api/consignments?action=unknown_branches').then(r => r.json()),
    ])
    setPurchases(p.data || [])
    setBranches(b.data || [])
    setBranchSummary(s.data || [])
    setUnknownBranches(u.data || [])

    // Also fetch in_consignment for the second tab
    const ic = await fetch('/api/consignments?action=consignments&status=draft').then(r => r.json())
    setInConsignment(ic.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Filtered + sorted purchases ───────────────────────────────────────────
  let filtered = purchases.filter(p => {
    if (filterBranch && p.branch_name !== filterBranch) return false
    if (filterRegion) {
      const br = branches.find(b => b.name === p.branch_name)
      if (!br || br.region !== filterRegion) return false
    }
    if (filterDateFrom && p.purchase_date < filterDateFrom) return false
    if (filterDateTo   && p.purchase_date > filterDateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      if (!p.customer_name?.toLowerCase().includes(q) &&
          !p.phone_number?.includes(q) &&
          !p.application_id?.toLowerCase().includes(q) &&
          !p.branch_name?.toLowerCase().includes(q)) return false
    }
    return true
  })

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'date_desc')   return new Date(b.purchase_date) - new Date(a.purchase_date)
    if (sortBy === 'date_asc')    return new Date(a.purchase_date) - new Date(b.purchase_date)
    if (sortBy === 'weight_desc') return parseFloat(b.net_weight || 0) - parseFloat(a.net_weight || 0)
    if (sortBy === 'weight_asc')  return parseFloat(a.net_weight || 0) - parseFloat(b.net_weight || 0)
    if (sortBy === 'amount_desc') return parseFloat(b.final_amount_crm || 0) - parseFloat(a.final_amount_crm || 0)
    if (sortBy === 'oldest')      return new Date(a.purchase_date) - new Date(b.purchase_date)
    return 0
  })

  const selectedRows     = filtered.filter(p => selected.has(p.id))
  const allSelected      = filtered.length > 0 && filtered.every(p => selected.has(p.id))
  const totalSelWt       = selectedRows.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalSelAmt      = selectedRows.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const selectedBranches = [...new Set(selectedRows.map(p => p.branch_name))]

  // ── Insights ──────────────────────────────────────────────────────────────
  const totalAtBranch    = branchSummary.reduce((s, b) => s + b.at_branch, 0)
  const totalInConsign   = branchSummary.reduce((s, b) => s + b.in_consignment, 0)
  const totalAtBrWt      = branchSummary.reduce((s, b) => s + b.at_branch_wt, 0)
  const totalInConWt     = branchSummary.reduce((s, b) => s + b.in_consignment_wt, 0)

  const oldestBill = purchases.reduce((oldest, p) => {
    if (!oldest) return p
    return new Date(p.purchase_date) < new Date(oldest.purchase_date) ? p : oldest
  }, null)

  const oldestDays = oldestBill ? daysSince(oldestBill.purchase_date) : 0

  const heaviestBranch = branchSummary.reduce((h, b) => {
    if (!h) return b
    return b.at_branch_wt > h.at_branch_wt ? b : h
  }, null)

  const regionGroups = branchSummary.reduce((acc, b) => {
    const r = b.region || 'Other'
    if (!acc[r]) acc[r] = []
    acc[r].push(b)
    return acc
  }, {})

  // In-consignment grouped by branch
  const consignByBranch = inConsignment.reduce((acc, c) => {
    if (!acc[c.branch_name]) acc[c.branch_name] = []
    acc[c.branch_name].push(c)
    return acc
  }, {})

  function toggleAll() {
    if (allSelected) { const n = new Set(selected); filtered.forEach(p => n.delete(p.id)); setSelected(n) }
    else { const n = new Set(selected); filtered.forEach(p => n.add(p.id)); setSelected(n) }
  }

  function toggleRow(id) { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }

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
      await fetchAll()
    } finally { setCreating(false) }
  }

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }
  const regions = [...new Set(branches.map(b => b.region))].sort()

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Stock in Branch</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>Outside Bangalore · {purchases.length} bills pending consignment</div>
        </div>
        <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* Unknown branch warning */}
      {unknownBranches.length > 0 && !dismissedWarning && (
        <div style={{ ...card, padding: '11px 16px', background: `${t.red}10`, border: `1px solid ${t.red}35`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <div>
              <div style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>Unknown branches in purchase data</div>
              <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>
                Not in Branch Management: <span style={{ color: t.orange }}>{unknownBranches.join(', ')}</span>
              </div>
            </div>
          </div>
          <button onClick={() => setDismissedWarning(true)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px' }}>✕</button>
        </div>
      )}

      {/* Success banner */}
      {lastConsignment && (
        <div style={{ ...card, padding: '11px 16px', background: `${t.green}10`, border: `1px solid ${t.green}35`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', color: t.green, fontWeight: 600 }}>✓ Consignment Created</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px', display: 'flex', gap: '14px' }}>
              <span>TMP PRF: <strong style={{ color: t.gold, fontFamily: 'monospace' }}>{lastConsignment.tmp_prf_no}</strong></span>
              <span>Challan: <strong style={{ color: t.blue, fontFamily: 'monospace' }}>{lastConsignment.challan_no}</strong></span>
              <span>{lastConsignment.total_bills} bills · {fmtWt(lastConsignment.total_net_wt)}</span>
            </div>
          </div>
          <button onClick={() => setLastConsignment(null)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px' }}>✕</button>
        </div>
      )}

      {/* ── TABS ── */}
      <div style={{ display: 'flex', gap: '0', background: t.card2, borderRadius: '10px', padding: '4px', border: `1px solid ${t.border}` }}>
        {[
          { key: 'at_branch',      label: `At Branch`,      count: totalAtBranch,  color: t.gold },
          { key: 'in_consignment', label: `In Consignment`, count: totalInConsign, color: t.orange },
        ].map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{
            flex: 1, padding: '8px 16px', border: 'none', borderRadius: '7px', cursor: 'pointer', transition: 'all .15s',
            background: tab === tb.key ? t.card : 'transparent',
            boxShadow: tab === tb.key ? `0 1px 4px rgba(0,0,0,.3)` : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: tab === tb.key ? tb.color : t.text4 }}>{tb.label}</span>
            <span style={{ fontSize: '11px', background: tab === tb.key ? `${tb.color}20` : t.border, color: tab === tb.key ? tb.color : t.text4, borderRadius: '20px', padding: '1px 8px', fontWeight: 700 }}>{tb.count}</span>
          </button>
        ))}
      </div>

      {/* ── AT BRANCH TAB ── */}
      {tab === 'at_branch' && (
        <>
          {/* KPI bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {[
              { label: 'Bills At Branch',    value: totalAtBranch,    sub: fmtWt(totalAtBrWt),                         color: t.gold,   icon: '📦' },
              { label: 'Active Branches',    value: branchSummary.filter(b => b.at_branch > 0).length, sub: 'with pending stock', color: t.blue,   icon: '🏪' },
              { label: 'Oldest Bill',        value: `${oldestDays}d`, sub: oldestBill ? `${oldestBill.branch_name} · ${fmtDate(oldestBill.purchase_date)}` : '—', color: oldestDays > 14 ? t.red : t.green, icon: '⏰' },
              { label: 'Heaviest Branch',    value: heaviestBranch?.branch || '—', sub: fmtWt(heaviestBranch?.at_branch_wt), color: t.purple, icon: '⚖️' },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ fontSize: '20px', lineHeight: 1, marginTop: '2px' }}>{k.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '4px' }}>{k.label}</div>
                  <div style={{ fontSize: '18px', fontWeight: 300, color: k.color, lineHeight: 1.2 }}>{k.value}</div>
                  <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setView('summary')} style={{ ...btnOut, fontSize: '11px', color: view === 'summary' ? t.gold : t.text3, borderColor: view === 'summary' ? t.gold : t.border }}>📊 By Region</button>
            <button onClick={() => setView('list')}    style={{ ...btnOut, fontSize: '11px', color: view === 'list'    ? t.gold : t.text3, borderColor: view === 'list'    ? t.gold : t.border }}>📋 Bill List</button>
            {view === 'list' && (
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text2, outline: 'none', marginLeft: '4px' }}>
                <option value="date_desc">Latest First</option>
                <option value="oldest">Oldest First</option>
                <option value="weight_desc">Heaviest First</option>
                <option value="weight_asc">Lightest First</option>
                <option value="amount_desc">Highest Amount</option>
              </select>
            )}
          </div>

          {/* ── SUMMARY (Region → Branch drilldown) ── */}
          {view === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(regionGroups).sort().map(([region, brs]) => {
                const rColor   = REGION_COLORS[region] || t.text3
                const rBranch  = brs.reduce((s, b) => s + b.at_branch, 0)
                const rWt      = brs.reduce((s, b) => s + b.at_branch_wt, 0)
                const activeBrs = brs.filter(b => b.at_branch > 0)
                if (activeBrs.length === 0) return null

                return (
                  <div key={region} style={card}>
                    <div onClick={() => setExpandedRegions(p => ({ ...p, [region]: !p[region] }))}
                      style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = `${rColor}06`}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: rColor, flexShrink: 0, boxShadow: `0 0 8px ${rColor}60` }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: rColor }}>{region}</div>
                        <div style={{ fontSize: '11px', color: t.text4 }}>{activeBrs.length} branches with stock</div>
                      </div>
                      <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '10px', color: t.text4, marginBottom: '2px' }}>Bills</div>
                          <div style={{ fontSize: '18px', fontWeight: 300, color: t.gold, fontFamily: 'monospace' }}>{rBranch}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '10px', color: t.text4, marginBottom: '2px' }}>Net Weight</div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: t.text2, fontFamily: 'monospace' }}>{fmtWt(rWt)}</div>
                        </div>
                        <div style={{ fontSize: '11px', color: t.text4, width: '16px' }}>{expandedRegions[region] ? '▲' : '▼'}</div>
                      </div>
                    </div>

                    {expandedRegions[region] && (
                      <div style={{ borderTop: `1px solid ${t.border}` }}>
                        {activeBrs.sort((a, b) => b.at_branch - a.at_branch).map(b => {
                          const billsInBranch = purchases.filter(p => p.branch_name === b.branch)
                          const oldest        = billsInBranch.reduce((o, p) => !o || new Date(p.purchase_date) < new Date(o.purchase_date) ? p : o, null)
                          const oldD          = oldest ? daysSince(oldest.purchase_date) : 0
                          const isExpBr       = expandedBranches[b.branch]

                          return (
                            <div key={b.branch} style={{ borderBottom: `1px solid ${t.border}10` }}>
                              <div style={{ padding: '10px 16px 10px 38px', display: 'flex', alignItems: 'center', gap: '12px' }}
                                onMouseEnter={e => e.currentTarget.style.background = `${t.gold}05`}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: '12px', color: t.text2, fontWeight: 500 }}>{b.branch}</div>
                                  <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px', display: 'flex', gap: '8px' }}>
                                    <span>Oldest: {fmtDate(oldest?.purchase_date)}</span>
                                    <AgeBadge days={oldD} t={t} />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '10px', color: t.text4 }}>Bills</div>
                                    <div style={{ fontSize: '15px', fontWeight: 600, color: t.gold }}>{b.at_branch}</div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '10px', color: t.text4 }}>Net Wt</div>
                                    <div style={{ fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{fmtWt(b.at_branch_wt)}</div>
                                  </div>
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => { setFilterBranch(b.branch); setView('list') }}
                                      style={{ ...btnGold, padding: '4px 10px', fontSize: '11px' }}>Select Bills</button>
                                    <button onClick={() => setExpandedBranches(p => ({ ...p, [b.branch]: !p[b.branch] }))}
                                      style={{ ...btnOut, padding: '4px 8px', fontSize: '11px' }}>{isExpBr ? '▲' : '▼'}</button>
                                  </div>
                                </div>
                              </div>

                              {/* Inline bill preview */}
                              {isExpBr && (
                                <div style={{ margin: '0 16px 10px 38px', background: t.card2, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr>
                                        {['Date', 'Customer', 'Net Wt', 'Amount', 'Age'].map(h => (
                                          <th key={h} style={{ padding: '6px 10px', fontSize: '9px', color: t.text4, textAlign: 'left', borderBottom: `1px solid ${t.border}`, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {billsInBranch.sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date)).map(p => (
                                        <tr key={p.id} style={{ borderBottom: `1px solid ${t.border}10` }}>
                                          <td style={{ padding: '5px 10px', fontSize: '11px', color: t.text3 }}>{fmtDate(p.purchase_date)}</td>
                                          <td style={{ padding: '5px 10px', fontSize: '11px', color: t.text2 }}>{p.customer_name}</td>
                                          <td style={{ padding: '5px 10px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{fmtWt(p.net_weight)}</td>
                                          <td style={{ padding: '5px 10px', fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>₹{fmt(Math.round(p.final_amount_crm))}</td>
                                          <td style={{ padding: '5px 10px' }}><AgeBadge days={daysSince(p.purchase_date)} t={t} /></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── BILL LIST VIEW ── */}
          {view === 'list' && (
            <>
              {/* Filters */}
              <div style={{ ...card, padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, app ID..."
                  style={{ flex: 1, minWidth: '180px', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text1, outline: 'none' }} />
                <select value={filterRegion} onChange={e => { setFilterRegion(e.target.value); setFilterBranch('') }}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
                  <option value="">All Regions</option>
                  {regions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none', minWidth: '160px' }}>
                  <option value="">All Branches</option>
                  {branches.filter(b => !filterRegion || b.region === filterRegion).map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
                {(filterBranch || filterRegion || filterDateFrom || filterDateTo || search) && (
                  <button onClick={() => { setFilterBranch(''); setFilterRegion(''); setFilterDateFrom(''); setFilterDateTo(''); setSearch('') }}
                    style={{ ...btnOut, fontSize: '11px', padding: '5px 10px' }}>✕ Clear</button>
                )}
                <div style={{ marginLeft: 'auto', fontSize: '11px', color: t.text4 }}>{filtered.length} bills</div>
              </div>

              {/* Selection bar */}
              {selected.size > 0 && (
                <div style={{ ...card, padding: '10px 16px', background: `${t.gold}10`, border: `1px solid ${t.gold}30`, display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{selected.size} bills selected</div>
                  <div style={{ fontSize: '12px', color: t.text3 }}>{fmtWt(totalSelWt)} · ₹{fmt(Math.round(totalSelAmt))}</div>
                  {selectedBranches.length === 1
                    ? <div style={{ fontSize: '12px', color: t.text3 }}>Branch: <strong style={{ color: t.text1 }}>{selectedBranches[0]}</strong></div>
                    : <div style={{ fontSize: '12px', color: t.red }}>⚠ {selectedBranches.length} branches — select one only</div>
                  }
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select value={moveType} onChange={e => setMoveType(e.target.value)}
                      style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text2, outline: 'none' }}>
                      <option value="EXTERNAL">External (Branch → HO)</option>
                      <option value="INTERNAL">Internal (Branch → Hub)</option>
                    </select>
                    <button onClick={() => setShowModal(true)} disabled={selectedBranches.length !== 1}
                      style={{ ...btnGold, opacity: selectedBranches.length !== 1 ? .5 : 1 }}>Create Consignment</button>
                    <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
                  </div>
                </div>
              )}

              {/* Table */}
              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 400px)', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th style={{ padding: '9px 12px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} />
                        </th>
                        {['Date','Branch','Customer','Phone','App ID','Net Wt','Amount','Age','Type'].map(h => (
                          <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>Loading...</td></tr>
                      ) : filtered.length === 0 ? (
                        <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>No stock in branch</td></tr>
                      ) : filtered.map(row => {
                        const isSel  = selected.has(row.id)
                        const br     = branches.find(b => b.name === row.branch_name)
                        const rColor = REGION_COLORS[br?.region] || t.text3
                        const days   = daysSince(row.purchase_date)
                        return (
                          <tr key={row.id} onClick={() => toggleRow(row.id)}
                            style={{ borderBottom: `1px solid ${t.border}15`, background: isSel ? `${t.gold}08` : 'transparent', cursor: 'pointer' }}
                            onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = `${t.gold}05` }}
                            onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                            <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} style={{ cursor: 'pointer' }} />
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ background: `${rColor}20`, color: rColor, borderRadius: '4px', padding: '2px 7px', fontSize: '11px', fontWeight: 600 }}>{row.branch_name}</span>
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text1, maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
                            <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, fontFamily: 'monospace' }}>{row.phone_number}</td>
                            <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text4, fontFamily: 'monospace' }}>{row.application_id}</td>
                            <td style={{ padding: '8px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(row.net_weight)}</td>
                            <td style={{ padding: '8px 12px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(row.final_amount_crm))}</td>
                            <td style={{ padding: '8px 12px' }}><AgeBadge days={days} t={t} /></td>
                            <td style={{ padding: '8px 12px' }}>
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
          )}
        </>
      )}

      {/* ── IN CONSIGNMENT TAB ── */}
      {tab === 'in_consignment' && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {[
              { label: 'Bills In Transit',  value: totalInConsign, sub: fmtWt(totalInConWt),                   color: t.orange, icon: '🚚' },
              { label: 'Active Regions',    value: Object.keys(regionGroups).filter(r => regionGroups[r].some(b => b.in_consignment > 0)).length, sub: 'with in-transit stock', color: t.blue, icon: '🗺️' },
              { label: 'Consignments',      value: inConsignment.length, sub: 'draft / pending dispatch',      color: t.purple, icon: '📋' },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ fontSize: '20px', lineHeight: 1, marginTop: '2px' }}>{k.icon}</div>
                <div>
                  <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '4px' }}>{k.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 300, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Region drilldown for in_consignment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(regionGroups).sort().map(([region, brs]) => {
              const rColor  = REGION_COLORS[region] || t.text3
              const rConsign = brs.reduce((s, b) => s + b.in_consignment, 0)
              const rWt     = brs.reduce((s, b) => s + b.in_consignment_wt, 0)
              const activeBrs = brs.filter(b => b.in_consignment > 0)
              if (activeBrs.length === 0) return null

              return (
                <div key={region} style={card}>
                  <div onClick={() => setExpandedRegions(p => ({ ...p, [`ic_${region}`]: !p[`ic_${region}`] }))}
                    style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${rColor}06`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: rColor, flexShrink: 0, boxShadow: `0 0 8px ${rColor}60` }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: rColor }}>{region}</div>
                      <div style={{ fontSize: '11px', color: t.text4 }}>{activeBrs.length} branches in transit</div>
                    </div>
                    <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: t.text4, marginBottom: '2px' }}>Bills</div>
                        <div style={{ fontSize: '18px', fontWeight: 300, color: t.orange, fontFamily: 'monospace' }}>{rConsign}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: t.text4, marginBottom: '2px' }}>Net Weight</div>
                        <div style={{ fontSize: '14px', fontWeight: 500, color: t.text2, fontFamily: 'monospace' }}>{fmtWt(rWt)}</div>
                      </div>
                      <div style={{ fontSize: '11px', color: t.text4, width: '16px' }}>{expandedRegions[`ic_${region}`] ? '▲' : '▼'}</div>
                    </div>
                  </div>

                  {expandedRegions[`ic_${region}`] && (
                    <div style={{ borderTop: `1px solid ${t.border}` }}>
                      {activeBrs.sort((a, b) => b.in_consignment - a.in_consignment).map(b => {
                        const brConsignments = consignByBranch[b.branch] || []
                        return (
                          <div key={b.branch} style={{ padding: '10px 16px 10px 38px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${t.border}10` }}
                            onMouseEnter={e => e.currentTarget.style.background = `${t.gold}05`}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '12px', color: t.text2, fontWeight: 500 }}>{b.branch}</div>
                              <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                                {brConsignments.length} consignment{brConsignments.length !== 1 ? 's' : ''} in transit
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '10px', color: t.text4 }}>Bills</div>
                                <div style={{ fontSize: '15px', fontWeight: 600, color: t.orange }}>{b.in_consignment}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '10px', color: t.text4 }}>Net Wt</div>
                                <div style={{ fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{fmtWt(b.in_consignment_wt)}</div>
                              </div>
                              {brConsignments.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {brConsignments.map(c => (
                                    <div key={c.id} style={{ fontSize: '10px', color: t.blue, fontFamily: 'monospace', background: `${t.blue}12`, borderRadius: '4px', padding: '2px 7px' }}>
                                      {c.tmp_prf_no}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Confirm modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px', width: '440px', maxWidth: '90vw' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: t.text1, marginBottom: '16px' }}>Confirm Consignment</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
              {[
                ['Branch',       selectedBranches[0]],
                ['Bills',        `${selected.size} bills`],
                ['Net Weight',   fmtWt(totalSelWt)],
                ['Amount',       `₹${fmt(Math.round(totalSelAmt))}`],
                ['Movement',     moveType === 'EXTERNAL' ? 'External (Branch → HO)' : 'Internal (Branch → Hub)'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: t.card2, borderRadius: '6px' }}>
                  <span style={{ fontSize: '12px', color: t.text3 }}>{label}</span>
                  <span style={{ fontSize: '12px', color: t.text1, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: t.text4, marginBottom: '16px', padding: '10px 12px', background: `${t.gold}08`, borderRadius: '6px', border: `1px solid ${t.gold}20` }}>
              ℹ TMP PRF No and Challan No will be auto-generated on confirmation
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={btnOut}>Cancel</button>
              <button onClick={handleCreate} disabled={creating} style={{ ...btnGold, opacity: creating ? .7 : 1 }}>
                {creating ? 'Creating...' : 'Confirm & Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}