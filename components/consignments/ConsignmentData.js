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

const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
}

export default function ConsignmentData() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [view,             setView]             = useState('stock')
  const [purchases,        setPurchases]        = useState([])
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
  const [creating,         setCreating]         = useState(false)
  const [moveType,         setMoveType]         = useState('EXTERNAL')
  const [showModal,        setShowModal]        = useState(false)
  const [lastConsignment,  setLastConsignment]  = useState(null)
  const [expandedRegions,  setExpandedRegions]  = useState({})
  const [dismissedWarning, setDismissedWarning] = useState(false)

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
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Filtered purchases
  const filtered = purchases.filter(p => {
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

  const selectedRows      = filtered.filter(p => selected.has(p.id))
  const allSelected       = filtered.length > 0 && filtered.every(p => selected.has(p.id))
  const totalSelWt        = selectedRows.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalSelAmt       = selectedRows.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const selectedBranches  = [...new Set(selectedRows.map(p => p.branch_name))]

  function toggleAll() {
    if (allSelected) { const n = new Set(selected); filtered.forEach(p => n.delete(p.id)); setSelected(n) }
    else { const n = new Set(selected); filtered.forEach(p => n.add(p.id)); setSelected(n) }
  }

  function toggleRow(id) {
    const n = new Set(selected)
    n.has(id) ? n.delete(id) : n.add(id)
    setSelected(n)
  }

  async function handleCreate() {
    if (!selected.size) return
    if (selectedBranches.length > 1) { alert('Select bills from ONE branch only.'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/consignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:        'create_consignment',
          purchase_ids:  [...selected],
          branch_name:   selectedBranches[0],
          movement_type: moveType,
        })
      })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); return }
      setLastConsignment(result.data)
      setSelected(new Set())
      setShowModal(false)
      await fetchAll()
    } finally { setCreating(false) }
  }

  // Group summary by region
  const regionGroups = branchSummary.reduce((acc, b) => {
    const region = b.region || 'Other'
    if (!acc[region]) acc[region] = []
    acc[region].push(b)
    return acc
  }, {})

  // Summary totals
  const totalAtBranch     = branchSummary.reduce((s, b) => s + b.at_branch, 0)
  const totalInConsign    = branchSummary.reduce((s, b) => s + b.in_consignment, 0)
  const totalAtBranchWt   = branchSummary.reduce((s, b) => s + b.at_branch_wt, 0)
  const totalInConsignWt  = branchSummary.reduce((s, b) => s + b.in_consignment_wt, 0)

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  const regions = [...new Set(branches.map(b => b.region))].sort()

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Stock in Branch</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>
            Outside Bangalore · {purchases.length} bills pending consignment
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setView('summary')} style={{ ...btnOut, color: view === 'summary' ? t.gold : t.text3, borderColor: view === 'summary' ? t.gold : t.border }}>📊 Branch View</button>
          <button onClick={() => setView('stock')}   style={{ ...btnOut, color: view === 'stock'   ? t.gold : t.text3, borderColor: view === 'stock'   ? t.gold : t.border }}>📋 Stock List</button>
          <button onClick={fetchAll} style={btnOut}>⟳</button>
        </div>
      </div>

      {/* Unknown branches warning */}
      {unknownBranches.length > 0 && !dismissedWarning && (
        <div style={{ ...card, padding: '12px 16px', background: `${t.red}10`, border: `1px solid ${t.red}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>⚠ Unknown Branches Detected</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
              These branches appear in purchase data but are not in Branch Management. Please add them:&nbsp;
              <span style={{ color: t.orange, fontWeight: 600 }}>{unknownBranches.join(', ')}</span>
            </div>
          </div>
          <button onClick={() => setDismissedWarning(true)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px', marginLeft: '12px', flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Success banner */}
      {lastConsignment && (
        <div style={{ ...card, padding: '12px 18px', background: `${t.green}12`, border: `1px solid ${t.green}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', color: t.green, fontWeight: 600 }}>✓ Consignment Created Successfully</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '3px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span>TMP PRF: <strong style={{ color: t.gold }}>{lastConsignment.tmp_prf_no}</strong></span>
              <span>Challan: <strong style={{ color: t.blue }}>{lastConsignment.challan_no}</strong></span>
              <span>{lastConsignment.total_bills} bills · {fmtWt(lastConsignment.total_net_wt)}</span>
            </div>
          </div>
          <button onClick={() => setLastConsignment(null)} style={{ ...btnOut, padding: '3px 8px', fontSize: '11px' }}>✕</button>
        </div>
      )}

      {/* ── SUMMARY VIEW ── */}
      {view === 'summary' && (
        <>
          {/* KPI bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' }}>
            {[
              { label: 'At Branch',         value: totalAtBranch,    sub: fmtWt(totalAtBranchWt),  color: t.gold },
              { label: 'In Consignment',    value: totalInConsign,   sub: fmtWt(totalInConsignWt), color: t.orange },
              { label: 'Active Branches',   value: branchSummary.filter(b => b.at_branch > 0).length, sub: 'with stock', color: t.blue },
              { label: 'Total Regions',     value: Object.keys(regionGroups).length, sub: 'outside BLR', color: t.green },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 18px' }}>
                <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '6px' }}>{k.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 300, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Region → Branch drilldown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(regionGroups).sort().map(([region, brs]) => {
              const regionColor    = REGION_COLORS[region] || t.text3
              const regionBranch   = brs.reduce((s, b) => s + b.at_branch, 0)
              const regionConsign  = brs.reduce((s, b) => s + b.in_consignment, 0)
              const isExpanded     = expandedRegions[region]

              return (
                <div key={region} style={card}>
                  <div onClick={() => setExpandedRegions(p => ({ ...p, [region]: !p[region] }))}
                    style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${regionColor}06`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: regionColor, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: regionColor }}>{region}</div>
                      <div style={{ fontSize: '11px', color: t.text4, marginTop: '1px' }}>{brs.length} branches</div>
                    </div>
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: t.text4 }}>At Branch</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: t.gold, fontFamily: 'monospace' }}>{regionBranch}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: t.text4 }}>In Consignment</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: t.orange, fontFamily: 'monospace' }}>{regionConsign}</div>
                      </div>
                      <div style={{ fontSize: '11px', color: t.text4, width: '16px', textAlign: 'center' }}>{isExpanded ? '▲' : '▼'}</div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${t.border}` }}>
                      {brs.filter(b => b.at_branch > 0 || b.in_consignment > 0).map(b => (
                        <div key={b.branch}
                          style={{ padding: '9px 16px 9px 36px', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${t.border}10` }}
                          onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ flex: 1, fontSize: '12px', color: t.text2 }}>{b.branch}</div>
                          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                            <div style={{ textAlign: 'right', minWidth: '60px' }}>
                              <div style={{ fontSize: '10px', color: t.text4 }}>At Branch</div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: t.gold }}>{b.at_branch}</div>
                              <div style={{ fontSize: '10px', color: t.text4 }}>{fmtWt(b.at_branch_wt)}</div>
                            </div>
                            <div style={{ textAlign: 'right', minWidth: '80px' }}>
                              <div style={{ fontSize: '10px', color: t.text4 }}>In Consignment</div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: t.orange }}>{b.in_consignment}</div>
                              <div style={{ fontSize: '10px', color: t.text4 }}>{fmtWt(b.in_consignment_wt)}</div>
                            </div>
                            <button onClick={() => { setFilterBranch(b.branch); setView('stock') }}
                              style={{ ...btnOut, padding: '3px 10px', fontSize: '11px' }}>View Bills →</button>
                          </div>
                        </div>
                      ))}
                      {brs.filter(b => b.at_branch > 0 || b.in_consignment > 0).length === 0 && (
                        <div style={{ padding: '12px 36px', fontSize: '12px', color: t.text4 }}>No stock in this region</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── STOCK LIST VIEW ── */}
      {view === 'stock' && (
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

          {/* Selection action bar */}
          {selected.size > 0 && (
            <div style={{ ...card, padding: '10px 16px', background: `${t.gold}10`, border: `1px solid ${t.gold}30`, display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{selected.size} bills selected</div>
              <div style={{ fontSize: '12px', color: t.text3 }}>{fmtWt(totalSelWt)} · ₹{fmt(Math.round(totalSelAmt))}</div>
              {selectedBranches.length === 1
                ? <div style={{ fontSize: '12px', color: t.text3 }}>Branch: <strong style={{ color: t.text1 }}>{selectedBranches[0]}</strong></div>
                : <div style={{ fontSize: '12px', color: t.red }}>⚠ {selectedBranches.length} branches selected — pick one branch only</div>
              }
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select value={moveType} onChange={e => setMoveType(e.target.value)}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text2, outline: 'none' }}>
                  <option value="EXTERNAL">External (Branch → HO)</option>
                  <option value="INTERNAL">Internal (Branch → Hub)</option>
                </select>
                <button onClick={() => setShowModal(true)} disabled={selectedBranches.length !== 1}
                  style={{ ...btnGold, opacity: selectedBranches.length !== 1 ? .5 : 1, cursor: selectedBranches.length !== 1 ? 'not-allowed' : 'pointer' }}>
                  Create Consignment
                </button>
                <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
              </div>
            </div>
          )}

          {/* Table */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '9px 12px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} />
                    </th>
                    {['Date','Branch','Customer','Phone','App ID','Grs Wt','Net Wt','Purity','Amount','Type'].map(h => (
                      <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>Loading...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={11} style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>No stock in branch{filterBranch ? ` for ${filterBranch}` : ''}</td></tr>
                  ) : filtered.map(row => {
                    const isSelected = selected.has(row.id)
                    const br         = branches.find(b => b.name === row.branch_name)
                    const rColor     = REGION_COLORS[br?.region] || t.text3
                    return (
                      <tr key={row.id}
                        onClick={() => toggleRow(row.id)}
                        style={{ borderBottom: `1px solid ${t.border}15`, background: isSelected ? `${t.gold}08` : 'transparent', cursor: 'pointer' }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${t.gold}05` }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}>
                        <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ background: `${rColor}20`, color: rColor, borderRadius: '4px', padding: '2px 7px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.branch_name}</span>
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text1, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, fontFamily: 'monospace' }}>{row.phone_number}</td>
                        <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text4, fontFamily: 'monospace' }}>{row.application_id}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(row.gross_weight)}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(row.net_weight)}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, textAlign: 'right' }}>{row.purity}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>₹{fmt(Math.round(row.final_amount_crm))}</td>
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

      {/* Confirm modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px', width: '440px', maxWidth: '90vw' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: t.text1, marginBottom: '16px' }}>Create Consignment</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
              {[
                ['Branch',        selectedBranches[0]],
                ['Bills',         `${selected.size} bills`],
                ['Net Weight',    fmtWt(totalSelWt)],
                ['Amount',        `₹${fmt(Math.round(totalSelAmt))}`],
                ['Movement Type', moveType === 'EXTERNAL' ? 'External (Branch → HO)' : 'Internal (Branch → Hub)'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: t.card2, borderRadius: '6px' }}>
                  <span style={{ fontSize: '12px', color: t.text3 }}>{label}</span>
                  <span style={{ fontSize: '12px', color: t.text1, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: t.text4, marginBottom: '16px', padding: '10px 12px', background: `${t.gold}08`, borderRadius: '6px', border: `1px solid ${t.gold}20` }}>
              ℹ TMP PRF No and Challan No will be auto-generated
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