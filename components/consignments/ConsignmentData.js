'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8', shadow: '0 1px 3px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a', shadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06)' },
}

const STATUS_META = {
  created:    { label: 'Created',    color: '#3a8fbf' },
  in_transit: { label: 'In Transit', color: '#c9981f' },
  received:   { label: 'Received',   color: '#3aaa6a' },
}

const STATE_COLORS = {
  'Karnataka':       '#c9a84c',
  'Kerala':          '#3aaa6a',
  'Andhra Pradesh':  '#3a8fbf',
  'Telangana':       '#8c5ac8',
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtVal  = (n) => { if (n == null) return '—'; const cr = Number(n) / 1e7; return cr >= 1 ? `₹${cr.toFixed(2)} Cr` : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTime = (t) => { if (!t) return ''; try { const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` } catch { return t } }
const dayAge  = (dateStr) => { if (!dateStr) return null; return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000) }

function genConsignmentNo() {
  const now = new Date()
  const y = now.getFullYear().toString().slice(-2)
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `CSN-${y}${m}${d}-${Math.floor(1000 + Math.random() * 9000)}`
}

export default function ConsignmentData() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme]
  const canManage = ['super_admin', 'founders_office', 'admin'].includes(userProfile?.role)

  const [mainView,       setMainView]       = useState('bills')
  const [selectedState,  setSelectedState]  = useState(null)
  const [selectedBranch, setSelectedBranch] = useState(null)

  const [stateSummaries,  setStateSummaries]  = useState([])
  const [statesLoading,   setStatesLoading]   = useState(false)
  const [branchSummaries, setBranchSummaries] = useState([])
  const [branchesLoading, setBranchesLoading] = useState(false)

  const [bills,        setBills]        = useState([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [billsTotal,   setBillsTotal]   = useState(0)
  const [billsPage,    setBillsPage]    = useState(0)
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const PAGE_SIZE = 100

  const [consignments,      setConsignments]      = useState([])
  const [consLoading,       setConsLoading]       = useState(false)
  const [filterConsStatus,  setFilterConsStatus]  = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [form, setForm] = useState({ consignment_no: genConsignmentNo(), expected_arrival: '', vehicle_details: '', notes: '' })

  const [transitCon, setTransitCon] = useState(null)
  const [marking,    setMarking]    = useState(false)

  const [validBranches, setValidBranches] = useState(null)

  const selectedBills     = bills.filter(b => selectedIds.has(b.id))
  const selectedNetWt     = selectedBills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)

  useEffect(() => { loadValidBranches(); loadConsignments() }, [])
  useEffect(() => { if (validBranches !== null) loadStateSummaries() }, [validBranches])
  useEffect(() => { if (selectedState && validBranches !== null) loadBranchSummaries(selectedState) }, [selectedState, validBranches])
  useEffect(() => { if (selectedBranch) { loadBills(0); setBillsPage(0) } }, [selectedBranch])
  useEffect(() => { if (selectedBranch) loadBills(billsPage) }, [billsPage])
  useEffect(() => { loadConsignments() }, [filterConsStatus])

  const loadValidBranches = async () => {
    const { data } = await supabase.from('branches').select('name, state, model_type').eq('is_active', true).neq('model_type', 'bangalore')
    setValidBranches(data || [])
  }

  const loadStateSummaries = async () => {
    setStatesLoading(true)
    const names = (validBranches || []).map(b => b.name)
    if (!names.length) { setStateSummaries([]); setStatesLoading(false); return }

    const { data } = await supabase
      .from('purchases')
      .select('branch_name, net_weight, total_amount, purchase_date')
      .eq('stock_status', 'at_branch')
      .is('is_deleted', false)
      .in('branch_name', names)

    if (!data) { setStatesLoading(false); return }

    const branchStateMap = {}
    ;(validBranches || []).forEach(b => { branchStateMap[b.name] = b.state })

    const stateMap = {}
    data.forEach(row => {
      const state = branchStateMap[row.branch_name] || 'Unknown'
      if (!stateMap[state]) stateMap[state] = { bills: 0, netWeight: 0, value: 0, oldestDate: null }
      stateMap[state].bills++
      stateMap[state].netWeight += parseFloat(row.net_weight) || 0
      stateMap[state].value     += parseFloat(row.total_amount) || 0
      const d = row.purchase_date
      if (d && (!stateMap[state].oldestDate || d < stateMap[state].oldestDate)) stateMap[state].oldestDate = d
    })

    setStateSummaries(Object.entries(stateMap).map(([state, v]) => ({ state, ...v, age: dayAge(v.oldestDate) })).sort((a, b) => b.netWeight - a.netWeight))
    setStatesLoading(false)
  }

  const loadBranchSummaries = async (state) => {
    setBranchesLoading(true)
    const names = (validBranches || []).filter(b => b.state === state).map(b => b.name)
    if (!names.length) { setBranchSummaries([]); setBranchesLoading(false); return }

    const { data } = await supabase
      .from('purchases')
      .select('branch_name, net_weight, total_amount, purchase_date')
      .eq('stock_status', 'at_branch')
      .is('is_deleted', false)
      .in('branch_name', names)

    if (!data) { setBranchesLoading(false); return }

    const branchMap = {}
    data.forEach(row => {
      const b = row.branch_name || 'Unknown'
      if (!branchMap[b]) branchMap[b] = { bills: 0, netWeight: 0, value: 0, oldestDate: null }
      branchMap[b].bills++
      branchMap[b].netWeight += parseFloat(row.net_weight) || 0
      branchMap[b].value     += parseFloat(row.total_amount) || 0
      const d = row.purchase_date
      if (d && (!branchMap[b].oldestDate || d < branchMap[b].oldestDate)) branchMap[b].oldestDate = d
    })

    setBranchSummaries(Object.entries(branchMap).map(([branch, v]) => ({ branch, ...v, age: dayAge(v.oldestDate) })).sort((a, b) => b.netWeight - a.netWeight))
    setBranchesLoading(false)
  }

  const loadBills = async (pageNum) => {
    if (!selectedBranch) return
    setBillsLoading(true)
    const from = pageNum * PAGE_SIZE
    const { data, count } = await supabase
      .from('purchases')
      .select('id, application_id, purchase_date, transaction_time, customer_name, branch_name, net_weight, purity, total_amount, transaction_type', { count: 'exact' })
      .eq('stock_status', 'at_branch')
      .eq('branch_name', selectedBranch)
      .is('is_deleted', false)
      .order('purchase_date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (data) setBills(data)
    if (count !== null) setBillsTotal(count)
    setSelectedIds(new Set())
    setBillsLoading(false)
  }

  const loadConsignments = async () => {
    setConsLoading(true)
    let q = supabase.from('consignments').select('*').order('created_at', { ascending: false })
    if (filterConsStatus) q = q.eq('status', filterConsStatus)
    const { data } = await q
    if (data) setConsignments(data)
    setConsLoading(false)
  }

  const toggleBill = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll  = () => {
    if (bills.length > 0 && bills.every(b => selectedIds.has(b.id))) setSelectedIds(new Set())
    else setSelectedIds(new Set(bills.map(b => b.id)))
  }

  const handleCreateConsignment = async () => {
    if (!selectedIds.size) return
    setCreating(true)
    const billIds     = [...selectedIds]
    const totalNetWt  = selectedBills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)
    const branchNames = [...new Set(selectedBills.map(b => b.branch_name).filter(Boolean))]

    const { error } = await supabase.from('consignments').insert({
      consignment_no:   form.consignment_no,
      created_by:       userProfile?.id,
      expected_arrival: form.expected_arrival || null,
      vehicle_details:  form.vehicle_details  || null,
      notes:            form.notes            || null,
      status:           'created',
      total_bills:      billIds.length,
      total_net_weight: totalNetWt,
      branch_names:     branchNames,
      bill_ids:         billIds,
    })
    if (error) { alert('Error: ' + error.message); setCreating(false); return }

    for (let i = 0; i < billIds.length; i += 100)
      await supabase.from('purchases').update({ stock_status: 'in_consignment' }).in('id', billIds.slice(i, i + 100))

    setShowCreate(false)
    setCreating(false)
    setForm({ consignment_no: genConsignmentNo(), expected_arrival: '', vehicle_details: '', notes: '' })
    setSelectedIds(new Set())
    loadBills(0)
    loadBranchSummaries(selectedState)
    loadStateSummaries()
    loadConsignments()
  }

  const handleMarkInTransit = async (con) => {
    setMarking(true)
    await supabase.from('consignments').update({ status: 'in_transit' }).eq('id', con.id)
    setTransitCon(null); setMarking(false); loadConsignments()
  }

  const s = {
    wrap:       { padding: '32px', maxWidth: '100%' },
    card:       { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px', marginBottom: '20px' },
    th:         { padding: '10px 14px', fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 600, whiteSpace: 'nowrap' },
    td:         { padding: '10px 14px', fontSize: '13px', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    tblWrap:    { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    select:     { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '13px', cursor: 'pointer' },
    input:      { background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 14px', color: t.text1, fontSize: '13px', outline: 'none', width: '100%' },
    btnGold:    { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '12px', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnOutline: { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '9px 20px', fontSize: '12px', cursor: 'pointer' },
    btnBlue:    { background: t.blue, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
    checkbox:   { width: '15px', height: '15px', accentColor: t.gold, cursor: 'pointer' },
    label:      { fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px', display: 'block' },
  }

  const AgeBadge = ({ age }) => {
    if (age == null) return null
    const color = age > 90 ? t.red : age > 30 ? t.orange : t.green
    return <span style={{ fontSize: '11px', color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>🕐 {age}d old</span>
  }

  const Breadcrumb = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '24px' }}>
      <span style={{ color: selectedState ? t.gold : t.text1, cursor: selectedState ? 'pointer' : 'default', fontWeight: selectedState ? 400 : 600 }}
        onClick={() => { setSelectedState(null); setSelectedBranch(null) }}>All States</span>
      {selectedState && <>
        <span style={{ color: t.text4 }}>›</span>
        <span style={{ color: selectedBranch ? t.gold : t.text1, cursor: selectedBranch ? 'pointer' : 'default', fontWeight: selectedBranch ? 400 : 600 }}
          onClick={() => setSelectedBranch(null)}>{selectedState}</span>
      </>}
      {selectedBranch && <>
        <span style={{ color: t.text4 }}>›</span>
        <span style={{ color: t.text1, fontWeight: 600 }}>{selectedBranch}</span>
      </>}
    </div>
  )

  const totalBillsPages = Math.ceil(billsTotal / PAGE_SIZE)

  return (
    <div style={s.wrap}>

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Consignment Data</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Group bills into consignments and track shipments to HO</div>
        </div>
        {canManage && mainView === 'bills' && selectedIds.size > 0 && (
          <button style={s.btnGold} onClick={() => setShowCreate(true)}>+ Create Consignment ({selectedIds.size} bills)</button>
        )}
      </div>

      {/* MAIN TABS */}
      <div style={{ display: 'flex', gap: '4px', padding: '4px', background: t.card, borderRadius: '10px', border: `1px solid ${t.border}`, width: 'fit-content', marginBottom: '28px' }}>
        {[{ key: 'bills', label: 'Bills at Branch' }, { key: 'consignments', label: `Consignments${consignments.length > 0 ? ` (${consignments.length})` : ''}` }].map(tab => (
          <button key={tab.key} onClick={() => setMainView(tab.key)} style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: mainView === tab.key ? `linear-gradient(135deg, ${t.gold}, ${t.gold}cc)` : 'transparent', color: mainView === tab.key ? '#0a0a0a' : t.text3, fontSize: '12px', fontWeight: mainView === tab.key ? 700 : 500, transition: 'all .2s ease' }}>{tab.label}</button>
        ))}
      </div>

      {/* ══ BILLS VIEW ══ */}
      {mainView === 'bills' && (
        <>
          <Breadcrumb />

          {/* LEVEL 1 — STATE CARDS */}
          {!selectedState && (
            statesLoading ? <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
            : stateSummaries.length === 0 ? (
              <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
                <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '12px' }}>📦</div>
                <div style={{ fontSize: '14px', color: t.text3 }}>No bills at branch</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {stateSummaries.map(ss => {
                  const color = STATE_COLORS[ss.state] || t.gold
                  return (
                    <div key={ss.state} onClick={() => setSelectedState(ss.state)}
                      style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '24px', cursor: 'pointer', transition: 'all .2s ease', position: 'relative', overflow: 'hidden' }}
                      onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${color}50`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                      onMouseLeave={e => { e.currentTarget.style.border = `1px solid ${t.border}`; e.currentTarget.style.transform = 'translateY(0)' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${color}, ${color}60)` }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div style={{ fontSize: '1rem', fontWeight: 600, color: t.text1 }}>{ss.state}</div>
                        <AgeBadge age={ss.age} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>Bills</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 200, color }}>{ss.bills.toLocaleString('en-IN')}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>Net Weight</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 300, color: t.text1 }}>{fmt(ss.netWeight)}g</div>
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                          <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>Value</div>
                          <div style={{ fontSize: '1rem', color: t.green }}>{fmtVal(ss.value)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: '14px', fontSize: '12px', color: t.text3, textAlign: 'right' }}>View branches <span style={{ color }}>›</span></div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* LEVEL 2 — BRANCH LIST */}
          {selectedState && !selectedBranch && (
            branchesLoading ? <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
            : branchSummaries.length === 0 ? (
              <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
                <div style={{ fontSize: '14px', color: t.text3 }}>No bills at branch for {selectedState}</div>
              </div>
            ) : (
              <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' }}>
                {branchSummaries.map((b, i) => {
                  const color = STATE_COLORS[selectedState] || t.gold
                  return (
                    <div key={b.branch} onClick={() => setSelectedBranch(b.branch)}
                      style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '16px 24px', borderBottom: i < branchSummaries.length - 1 ? `1px solid ${t.border}20` : 'none', cursor: 'pointer', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = `${color}08`}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 500, color: t.text1, marginBottom: '4px' }}>{b.branch}</div>
                        <AgeBadge age={b.age} />
                      </div>
                      <div style={{ textAlign: 'right', minWidth: '70px' }}>
                        <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Bills</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 300, color }}>{b.bills.toLocaleString('en-IN')}</div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: '100px' }}>
                        <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Net Wt</div>
                        <div style={{ fontSize: '13px', color: t.text1 }}>{fmt(b.netWeight)}g</div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: '110px' }}>
                        <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Value</div>
                        <div style={{ fontSize: '13px', color: t.green }}>{fmtVal(b.value)}</div>
                      </div>
                      <div style={{ color: t.text4, fontSize: '1.2rem' }}>›</div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* LEVEL 3 — BILLS TABLE */}
          {selectedBranch && (
            <>
              {/* Branch summary strip */}
              {(() => {
                const bs = branchSummaries.find(b => b.branch === selectedBranch)
                return bs ? (
                  <div style={{ display: 'flex', gap: '28px', padding: '16px 24px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Bills</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 200, color: STATE_COLORS[selectedState] || t.gold }}>{bs.bills.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Net Weight</div>
                      <div style={{ fontSize: '1rem', color: t.text1 }}>{fmt(bs.netWeight)}g</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Value</div>
                      <div style={{ fontSize: '1rem', color: t.green }}>{fmtVal(bs.value)}</div>
                    </div>
                    <AgeBadge age={bs.age} />
                    {selectedIds.size > 0 && canManage && (
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontSize: '13px', color: t.gold }}>{selectedIds.size} selected · {fmt(selectedNetWt)}g</span>
                        <button style={s.btnGold} onClick={() => setShowCreate(true)}>+ Create Consignment</button>
                      </div>
                    )}
                  </div>
                ) : null
              })()}

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginBottom: '12px', fontSize: '12px', color: t.text3 }}>
                {selectedIds.size > 0 && <span style={{ color: t.gold }}>{selectedIds.size} selected</span>}
                <span>{billsTotal === 0 ? 0 : billsPage * PAGE_SIZE + 1}–{Math.min((billsPage + 1) * PAGE_SIZE, billsTotal).toLocaleString('en-IN')} of {billsTotal.toLocaleString('en-IN')}</span>
                <button onClick={() => setBillsPage(p => Math.max(0, p - 1))} disabled={billsPage === 0} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: billsPage === 0 ? t.text4 : t.text2, cursor: billsPage === 0 ? 'not-allowed' : 'pointer' }}>←</button>
                <span>Page {billsPage + 1} of {totalBillsPages || 1}</span>
                <button onClick={() => setBillsPage(p => Math.min(totalBillsPages - 1, p + 1))} disabled={billsPage >= totalBillsPages - 1} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: billsPage >= totalBillsPages - 1 ? t.text4 : t.text2, cursor: billsPage >= totalBillsPages - 1 ? 'not-allowed' : 'pointer' }}>→</button>
              </div>

              {billsLoading ? <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div> : (
                <div style={s.tblWrap}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {canManage && <th style={{ ...s.th, width: '40px', textAlign: 'center' }}><input type="checkbox" style={s.checkbox} checked={bills.length > 0 && bills.every(b => selectedIds.has(b.id))} onChange={toggleAll} /></th>}
                        {['App ID', 'Date', 'Time', 'Customer', 'Net Wt', 'Purity', 'Gross Value', 'Type'].map(h => <th key={h} style={s.th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map(bill => (
                        <tr key={bill.id} style={{ background: selectedIds.has(bill.id) ? `${t.gold}10` : 'transparent' }}>
                          {canManage && <td style={{ ...s.td, textAlign: 'center', padding: '10px 8px' }}><input type="checkbox" style={s.checkbox} checked={selectedIds.has(bill.id)} onChange={() => toggleBill(bill.id)} /></td>}
                          <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{bill.application_id}</td>
                          <td style={s.td}>{fmtDate(bill.purchase_date)}</td>
                          <td style={{ ...s.td, color: t.text3 }}>{fmtTime(bill.transaction_time) || '—'}</td>
                          <td style={s.td}>{bill.customer_name}</td>
                          <td style={{ ...s.td, color: t.gold }}>{fmt(bill.net_weight)}g</td>
                          <td style={s.td}>{bill.purity ? `${Number(bill.purity).toFixed(2)}%` : '—'}</td>
                          <td style={s.td}>₹{fmt(bill.total_amount)}</td>
                          <td style={{ ...s.td, fontSize: '11px' }}>
                            <span style={{ color: bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange, background: `${bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange}18`, border: `1px solid ${bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange}40`, borderRadius: '4px', padding: '2px 7px' }}>{bill.transaction_type}</span>
                          </td>
                        </tr>
                      ))}
                      {bills.length === 0 && <tr><td colSpan={canManage ? 9 : 8} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>No bills at branch</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══ CONSIGNMENTS VIEW ══ */}
      {mainView === 'consignments' && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <select style={s.select} value={filterConsStatus} onChange={e => setFilterConsStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {consLoading ? <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
          : consignments.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
              <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '12px' }}>🚚</div>
              <div style={{ fontSize: '14px', color: t.text3 }}>No consignments yet</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {consignments.map(con => {
                const meta = STATUS_META[con.status] || { label: con.status, color: t.text3 }
                return (
                  <div key={con.id} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                          <div style={{ fontSize: '1rem', fontWeight: 600, color: t.gold }}>{con.consignment_no}</div>
                          <span style={{ fontSize: '11px', color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: '4px', padding: '2px 8px', fontWeight: 600 }}>{meta.label}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
                          {[
                            { label: 'Created', value: fmtDate(con.created_at) },
                            { label: 'Bills',   value: con.total_bills, bold: true },
                            { label: 'Net Wt',  value: `${fmt(con.total_net_weight)}g`, color: t.gold },
                            con.expected_arrival && { label: 'Expected', value: fmtDate(con.expected_arrival) },
                            con.vehicle_details  && { label: 'Vehicle',  value: con.vehicle_details },
                          ].filter(Boolean).map(item => (
                            <div key={item.label}>
                              <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '2px' }}>{item.label}</div>
                              <div style={{ fontSize: '13px', color: item.color || t.text2, fontWeight: item.bold ? 600 : 400 }}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                        {con.branch_names?.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {con.branch_names.map(b => <span key={b} style={{ fontSize: '11px', color: t.text3, background: t.card2, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '2px 8px' }}>{b}</span>)}
                          </div>
                        )}
                        {con.notes && <div style={{ marginTop: '8px', fontSize: '12px', color: t.text3, fontStyle: 'italic' }}>Note: {con.notes}</div>}
                      </div>
                      {canManage && con.status === 'created' && (
                        <button style={s.btnBlue} onClick={() => setTransitCon(con)}>🚚 Mark In Transit</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '36px', maxWidth: '520px', width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: '1.1rem', color: t.text1, marginBottom: '6px' }}>Create Consignment</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '28px' }}>{selectedIds.size} bills · {fmt(selectedNetWt)}g net weight</div>
            {[
              { key: 'consignment_no',   label: 'Consignment Number',      type: 'text' },
              { key: 'expected_arrival', label: 'Expected Arrival Date',   type: 'date' },
              { key: 'vehicle_details',  label: 'Vehicle / Courier Details', type: 'text', placeholder: 'e.g. KA-01-AB-1234' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: '18px' }}>
                <label style={s.label}>{f.label}</label>
                <input type={f.type} style={s.input} placeholder={f.placeholder || ''} value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ marginBottom: '28px' }}>
              <label style={s.label}>Notes / Remarks</label>
              <textarea style={{ ...s.input, height: '80px', resize: 'vertical', fontFamily: 'inherit' }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnOutline} onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
              <button style={s.btnGold} onClick={handleCreateConsignment} disabled={creating}>{creating ? 'Creating...' : 'Create Consignment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* IN TRANSIT MODAL */}
      {transitCon && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '36px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '16px' }}>🚚</div>
            <div style={{ fontSize: '1rem', color: t.text1, marginBottom: '8px' }}>Mark as In Transit?</div>
            <div style={{ fontSize: '13px', color: t.gold, marginBottom: '6px' }}>{transitCon.consignment_no}</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '28px', lineHeight: 1.6 }}>{transitCon.total_bills} bills · {fmt(transitCon.total_net_weight)}g</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button style={s.btnOutline} onClick={() => setTransitCon(null)} disabled={marking}>Cancel</button>
              <button style={s.btnBlue} onClick={() => handleMarkInTransit(transitCon)} disabled={marking}>{marking ? 'Marking...' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}