'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const STATE_COLORS = { KA: '#c9a84c', AP: '#3a8fbf', TS: '#8c5ac8', KL: '#3aaa6a' }

export default function ConsignmentData() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [view, setView]               = useState('stock')      // stock | create | summary
  const [purchases, setPurchases]     = useState([])
  const [branches, setBranches]       = useState([])
  const [branchSummary, setBranchSummary] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState(new Set())
  const [filterBranch, setFilterBranch] = useState('')
  const [filterState, setFilterState]   = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo]     = useState('')
  const [search, setSearch]           = useState('')
  const [creating, setCreating]       = useState(false)
  const [moveType, setMoveType]       = useState('EXTERNAL')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [lastConsignment, setLastConsignment] = useState(null)
  const [expandedStates, setExpandedStates]   = useState({})
  const [expandedBranches, setExpandedBranches] = useState({})

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [p, b, s] = await Promise.all([
      fetch('/api/consignments?action=stock_in_branch').then(r => r.json()),
      fetch('/api/consignments?action=branches').then(r => r.json()),
      fetch('/api/consignments?action=branch_summary').then(r => r.json()),
    ])
    setPurchases(p.data || [])
    setBranches(b.data || [])
    setBranchSummary(s.data || [])
    setLoading(false)
  }

  // Filter purchases
  const filtered = purchases.filter(p => {
    if (filterBranch && p.branch_name !== filterBranch) return false
    if (filterState) {
      const br = branches.find(b => b.branch_name === p.branch_name)
      if (!br || br.state_code !== filterState) return false
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

  const allSelected    = filtered.length > 0 && filtered.every(p => selected.has(p.id))
  const selectedRows   = filtered.filter(p => selected.has(p.id))
  const totalSelWt     = selectedRows.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalSelAmt    = selectedRows.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  // Get unique branches for selected items
  const selectedBranches = [...new Set(selectedRows.map(p => p.branch_name))]

  function toggleAll() {
    if (allSelected) { const n = new Set(selected); filtered.forEach(p => n.delete(p.id)); setSelected(n) }
    else { const n = new Set(selected); filtered.forEach(p => n.add(p.id)); setSelected(n) }
  }

  async function handleCreateConsignment() {
    if (!selected.size) return
    if (selectedBranches.length > 1) { alert('Please select bills from only ONE branch at a time to create a consignment.'); return }

    setCreating(true)
    try {
      const branchName = selectedBranches[0]
      const branch     = branches.find(b => b.branch_name === branchName)
      if (!branch) { alert('Branch not found in master list.'); return }

      const res = await fetch('/api/consignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:       'create_consignment',
          purchase_ids: [...selected],
          branch_name:  branchName,
          branch_code:  branch.branch_code,
          state_code:   branch.state_code,
          movement_type: moveType,
        })
      })
      const result = await res.json()
      if (result.error) { alert('Error: ' + result.error); return }

      setLastConsignment(result.data)
      setSelected(new Set())
      setShowCreateModal(false)
      await fetchAll()
    } finally { setCreating(false) }
  }

  // Group branches by state for summary view
  const stateGroups = branchSummary.reduce((acc, b) => {
    const br = branches.find(x => x.branch_name === b.branch)
    const state = br?.state_code || 'OTHER'
    if (!acc[state]) acc[state] = []
    acc[state].push({ ...b, state_name: br?.state_name })
    return acc
  }, {})

  const card   = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Stock in Branch</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>
            Outside Bangalore gold pending consignment · {purchases.length} bills
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setView('summary')} style={{ ...btnOut, color: view === 'summary' ? t.gold : t.text3, borderColor: view === 'summary' ? t.gold : t.border }}>
            📊 Branch View
          </button>
          <button onClick={() => setView('stock')} style={{ ...btnOut, color: view === 'stock' ? t.gold : t.text3, borderColor: view === 'stock' ? t.gold : t.border }}>
            📋 Stock List
          </button>
          <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
        </div>
      </div>

      {/* Success banner */}
      {lastConsignment && (
        <div style={{ ...card, padding: '12px 18px', background: `${t.green}15`, border: `1px solid ${t.green}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', color: t.green, fontWeight: 600 }}>✓ Consignment Created</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>
              TMP PRF: <span style={{ color: t.gold, fontWeight: 600 }}>{lastConsignment.tmp_prf_no}</span>
              &nbsp;·&nbsp; Challan: <span style={{ color: t.blue }}>{lastConsignment.challan_no}</span>
              &nbsp;·&nbsp; {lastConsignment.total_bills} bills · {fmtWt(lastConsignment.total_net_wt)}
            </div>
          </div>
          <button onClick={() => setLastConsignment(null)} style={{ ...btnOut, padding: '4px 10px', fontSize: '11px' }}>✕</button>
        </div>
      )}

      {/* ── SUMMARY VIEW ── */}
      {view === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.entries(stateGroups).map(([stateCode, brs]) => {
            const stateTotal    = brs.reduce((s, b) => s + b.in_branch + b.in_transit, 0)
            const stateInBranch = brs.reduce((s, b) => s + b.in_branch, 0)
            const stateTransit  = brs.reduce((s, b) => s + b.in_transit, 0)
            const stateColor    = STATE_COLORS[stateCode] || t.text3
            const isExpanded    = expandedStates[stateCode]

            return (
              <div key={stateCode} style={card}>
                {/* State header */}
                <div onClick={() => setExpandedStates(p => ({ ...p, [stateCode]: !p[stateCode] }))}
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: stateColor }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: stateColor }}>{stateCode} — {brs[0]?.state_name}</div>
                    <div style={{ fontSize: '11px', color: t.text4 }}>{brs.length} branches · {stateTotal} bills total</div>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: t.text4 }}>In Branch</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: t.gold }}>{stateInBranch}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: t.text4 }}>In Transit</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: t.orange }}>{stateTransit}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: t.text4 }}>{isExpanded ? '▲' : '▼'}</div>
                  </div>
                </div>

                {/* Branch rows */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${t.border}` }}>
                    {brs.map(b => (
                      <div key={b.branch} style={{ borderBottom: `1px solid ${t.border}15` }}>
                        <div onClick={() => setExpandedBranches(p => ({ ...p, [b.branch]: !p[b.branch] }))}
                          style={{ padding: '10px 16px 10px 32px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ flex: 1, fontSize: '12px', color: t.text2 }}>{b.branch}</div>
                          <div style={{ display: 'flex', gap: '24px' }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '10px', color: t.text4 }}>In Branch</div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: t.gold }}>{b.in_branch}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '10px', color: t.text4 }}>In Transit</div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: t.orange }}>{b.in_transit}</div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setFilterBranch(b.branch); setView('stock') }}
                              style={{ ...btnOut, padding: '3px 8px', fontSize: '10px' }}>View Bills</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {Object.keys(stateGroups).length === 0 && (
            <div style={{ ...card, padding: '40px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              No stock data available
            </div>
          )}
        </div>
      )}

      {/* ── STOCK LIST VIEW ── */}
      {view === 'stock' && (
        <>
          {/* Filters */}
          <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, app ID..."
              style={{ flex: 1, minWidth: '180px', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text1, outline: 'none' }} />

            <select value={filterState} onChange={e => { setFilterState(e.target.value); setFilterBranch('') }}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
              <option value="">All States</option>
              {['KA','AP','TS','KL'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none', minWidth: '160px' }}>
              <option value="">All Branches</option>
              {branches.filter(b => !filterState || b.state_code === filterState).map(b => (
                <option key={b.branch_code} value={b.branch_name}>{b.branch_name}</option>
              ))}
            </select>

            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text2, outline: 'none' }} />

            {(filterBranch || filterState || filterDateFrom || filterDateTo || search) && (
              <button onClick={() => { setFilterBranch(''); setFilterState(''); setFilterDateFrom(''); setFilterDateTo(''); setSearch('') }} style={{ ...btnOut, fontSize: '11px', padding: '5px 10px' }}>✕ Clear</button>
            )}

            <div style={{ marginLeft: 'auto', fontSize: '11px', color: t.text4 }}>{filtered.length} bills</div>
          </div>

          {/* Selection bar */}
          {selected.size > 0 && (
            <div style={{ ...card, padding: '10px 16px', background: `${t.gold}10`, border: `1px solid ${t.gold}30`, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ fontSize: '12px', color: t.gold, fontWeight: 600 }}>{selected.size} bills selected</div>
              <div style={{ fontSize: '12px', color: t.text3 }}>
                {fmtWt(totalSelWt)} · ₹{fmt(Math.round(totalSelAmt))}
              </div>
              {selectedBranches.length === 1 && (
                <div style={{ fontSize: '12px', color: t.text3 }}>Branch: <span style={{ color: t.text1, fontWeight: 600 }}>{selectedBranches[0]}</span></div>
              )}
              {selectedBranches.length > 1 && (
                <div style={{ fontSize: '12px', color: t.red }}>⚠ Multiple branches selected — select one branch only</div>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select value={moveType} onChange={e => setMoveType(e.target.value)}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text2, outline: 'none' }}>
                  <option value="EXTERNAL">External (Branch → HO)</option>
                  <option value="INTERNAL">Internal (Branch → Hub)</option>
                </select>
                <button onClick={() => setShowCreateModal(true)} disabled={selectedBranches.length !== 1} style={{ ...btnGold, opacity: selectedBranches.length !== 1 ? .5 : 1 }}>
                  Create Consignment
                </button>
                <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
              </div>
            </div>
          )}

          {/* Table */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '9px 12px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} />
                    </th>
                    {['Date', 'Branch', 'Cust Name', 'Phone', 'App ID', 'Grs Wt', 'Net Wt', 'Purity', 'Gross Amt', 'Final Amt', 'Type'].map(h => (
                      <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={12} style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>Loading...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={12} style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No stock in branch{filterBranch ? ` for ${filterBranch}` : ''}</td></tr>
                  ) : filtered.map(row => {
                    const isSelected = selected.has(row.id)
                    const br = branches.find(b => b.branch_name === row.branch_name)
                    const stateColor = STATE_COLORS[br?.state_code] || t.text3
                    return (
                      <tr key={row.id}
                        style={{ borderBottom: `1px solid ${t.border}15`, background: isSelected ? `${t.gold}08` : 'transparent', cursor: 'pointer' }}
                        onClick={() => { const n = new Set(selected); isSelected ? n.delete(row.id) : n.add(row.id); setSelected(n) }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${t.gold}05` }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}>
                        <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => { const n = new Set(selected); isSelected ? n.delete(row.id) : n.add(row.id); setSelected(n) }} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          <span style={{ background: `${stateColor}20`, color: stateColor, borderRadius: '4px', padding: '2px 6px', fontSize: '11px', fontWeight: 600 }}>{row.branch_name}</span>
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text1, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, fontFamily: 'monospace' }}>{row.phone_number}</td>
                        <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text4, fontFamily: 'monospace' }}>{row.application_id}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(row.gross_weight)}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(row.net_weight)}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text3, textAlign: 'right' }}>{row.purity}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(row.total_amount))}</td>
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

      {/* Create Consignment Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px', width: '460px', maxWidth: '90vw' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: t.text1, marginBottom: '16px' }}>Create Consignment</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {[
                { label: 'Branch', value: selectedBranches[0] },
                { label: 'Bills Selected', value: `${selected.size} bills` },
                { label: 'Total Net Weight', value: fmtWt(totalSelWt) },
                { label: 'Total Amount', value: `₹${fmt(Math.round(totalSelAmt))}` },
                { label: 'Movement Type', value: moveType === 'EXTERNAL' ? 'External (Branch → HO)' : 'Internal (Branch → Hub)' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: t.card2, borderRadius: '6px' }}>
                  <span style={{ fontSize: '12px', color: t.text3 }}>{item.label}</span>
                  <span style={{ fontSize: '12px', color: t.text1, fontWeight: 600 }}>{item.value}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: '11px', color: t.text4, marginBottom: '16px', padding: '10px 12px', background: `${t.gold}08`, borderRadius: '6px', border: `1px solid ${t.gold}20` }}>
              ℹ TMP PRF No and Challan No will be auto-generated on creation
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateModal(false)} style={btnOut}>Cancel</button>
              <button onClick={handleCreateConsignment} disabled={creating} style={{ ...btnGold, opacity: creating ? .7 : 1 }}>
                {creating ? 'Creating...' : 'Confirm & Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}