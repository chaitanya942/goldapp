'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const STATUS_META = {
  created:    { label: 'Created',    color: '#3a8fbf' },
  in_transit: { label: 'In Transit', color: '#c9981f' },
  received:   { label: 'Received',   color: '#3aaa6a' },
}

const SORT_OPTIONS = [
  { key: 'bill_count',  label: 'Bills' },
  { key: 'total_net',   label: 'Net Weight' },
  { key: 'total_value', label: 'Value' },
  { key: 'oldest_date', label: 'Oldest First' },
]

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtCr   = (n) => { if (n == null) return '—'; const cr = Number(n) / 1e7; return cr >= 1 ? `₹${cr.toFixed(2)} Cr` : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTime = (t) => {
  if (!t) return ''
  try { const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` }
  catch { return t }
}
const daysOld  = (d) => { if (!d) return null; return Math.floor((Date.now() - new Date(d).getTime()) / 86400000) }
const ageColor = (days, t) => {
  if (days == null) return t.text4
  if (days > 180) return t.red
  if (days > 90)  return t.orange
  if (days > 30)  return t.gold
  return t.green
}
function genConsignmentNo() {
  const now = new Date()
  const y = now.getFullYear().toString().slice(-2)
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `CSN-${y}${m}${d}-${Math.floor(1000 + Math.random() * 9000)}`
}

function ConBillsList({ billIds, t, s }) {
  const [bills, setBills]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!billIds?.length) { setLoading(false); return }
    supabase.from('purchases')
      .select('id, application_id, purchase_date, customer_name, branch_name, net_weight, total_amount, transaction_type')
      .in('id', billIds)
      .order('branch_name')
      .then(({ data }) => { if (data) setBills(data); setLoading(false) })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', color: t.text3, padding: '24px' }}>Loading bills...</div>
  if (!bills.length) return <div style={{ textAlign: 'center', color: t.text4, padding: '24px' }}>No bills found</div>

  const totalNet   = bills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)
  const totalValue = bills.reduce((s, b) => s + (parseFloat(b.total_amount) || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: '24px', marginBottom: '12px', padding: '10px 14px', background: t.card2, borderRadius: '8px', border: `1px solid ${t.border}` }}>
        <span style={{ fontSize: '12px', color: t.text3 }}>Total: <span style={{ color: t.text1, fontWeight: 600 }}>{bills.length} bills</span></span>
        <span style={{ fontSize: '12px', color: t.text3 }}>Net Wt: <span style={{ color: t.gold, fontWeight: 600 }}>{fmt(totalNet)}g</span></span>
        <span style={{ fontSize: '12px', color: t.text3 }}>Value: <span style={{ color: t.green, fontWeight: 600 }}>{fmtCr(totalValue)}</span></span>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${t.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['App ID', 'Date', 'Customer', 'Branch', 'Net Wt', 'Gross Value', 'Type'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.map(bill => (
              <tr key={bill.id}>
                <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{bill.application_id}</td>
                <td style={s.td}>{fmtDate(bill.purchase_date)}</td>
                <td style={s.td}>{bill.customer_name}</td>
                <td style={{ ...s.td, color: t.text2 }}>{bill.branch_name}</td>
                <td style={{ ...s.td, color: t.gold }}>{fmt(bill.net_weight)}g</td>
                <td style={s.td}>₹{fmt(bill.total_amount)}</td>
                <td style={{ ...s.td, fontSize: '11px' }}>
                  <span style={{ color: bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange, background: `${bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange}18`, border: `1px solid ${bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange}40`, borderRadius: '4px', padding: '2px 7px' }}>{bill.transaction_type}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ConsignmentData() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme]
  const canManage = ['super_admin', 'founders_office', 'admin'].includes(userProfile?.role)
  const fileInputRef = useRef(null)

  const [view, setView]                     = useState('bills')
  const [drillLevel, setDrillLevel]         = useState('states')
  const [selectedState, setSelectedState]   = useState(null)
  const [selectedBranch, setSelectedBranch] = useState(null)
  const [sortBy, setSortBy]                 = useState('bill_count')
  const [expandedCon, setExpandedCon]       = useState(null)

  const [stateSummary, setStateSummary]       = useState([])
  const [statesLoading, setStatesLoading]     = useState(false)
  const [branchSummary, setBranchSummary]     = useState([])
  const [branchesLoading, setBranchesLoading] = useState(false)

  const [bills, setBills]               = useState([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [billsTotal, setBillsTotal]     = useState(0)
  const [billsPage, setBillsPage]       = useState(0)
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const BILLS_PAGE_SIZE = 100

  const [consignments, setConsignments]         = useState([])
  const [consLoading, setConsLoading]           = useState(false)
  const [filterConsStatus, setFilterConsStatus] = useState('')
  const [totalAtBranch, setTotalAtBranch]       = useState(0)

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating]     = useState(false)
  const [form, setForm]             = useState({ expected_arrival: '', vehicle_details: '', notes: '' })
  const [transitCon, setTransitCon] = useState(null)
  const [undoCon, setUndoCon]       = useState(null)
  const [marking, setMarking]       = useState(false)

  const [ocrMode, setOcrMode]               = useState(false)
  const [ocrLoading, setOcrLoading]         = useState(false)
  const [ocrResult, setOcrResult]           = useState(null)
  const [ocrFileName, setOcrFileName]       = useState('')
  const [ocrSelectedIds, setOcrSelectedIds] = useState(new Set())

  const selectedBills    = bills.filter(b => selectedIds.has(b.id))
  const selectedNetWt    = selectedBills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)
  const selectedBranches = [...new Set(selectedBills.map(b => b.branch_name).filter(Boolean))]

  const ocrSelectedRows     = ocrResult?.rows?.filter(r => ocrSelectedIds.has(r.id)) || []
  const ocrSelectedNetWt    = ocrSelectedRows.reduce((s, r) => s + (parseFloat(r.net_weight) || 0), 0)
  const ocrSelectedValue    = ocrSelectedRows.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0)
  const ocrSelectedBranches = [...new Set(ocrSelectedRows.map(r => r.branch_name).filter(Boolean))]

  const sortedStates = [...stateSummary].sort((a, b) => {
    if (sortBy === 'oldest_date') return new Date(a.oldest_date) - new Date(b.oldest_date)
    return Number(b[sortBy] || 0) - Number(a[sortBy] || 0)
  })

  const grandTotal = {
    bills:    stateSummary.reduce((s, r) => s + Number(r.bill_count || 0), 0),
    net:      stateSummary.reduce((s, r) => s + Number(r.total_net || 0), 0),
    value:    stateSummary.reduce((s, r) => s + Number(r.total_value || 0), 0),
    branches: stateSummary.reduce((s, r) => s + Number(r.branch_count || 0), 0),
    avgAge:   stateSummary.length > 0 ? stateSummary.reduce((s, r) => s + Number(r.avg_age_days || 0), 0) / stateSummary.length : 0,
  }

  useEffect(() => { loadStateSummary(); loadConsignments() }, [])
  useEffect(() => { loadConsignments() }, [filterConsStatus])

  const loadStateSummary = async () => {
    setStatesLoading(true)
    const { data } = await supabase.rpc('get_consignment_state_summary')
    if (data) { setStateSummary(data); setTotalAtBranch(data.reduce((s, r) => s + Number(r.bill_count || 0), 0)) }
    setStatesLoading(false)
  }

  const loadBranchSummary = async (state) => {
    setBranchesLoading(true)
    const { data } = await supabase.rpc('get_consignment_branch_summary', { p_state: state })
    if (data) setBranchSummary(data)
    setBranchesLoading(false)
  }

  const loadBills = async (branch, pageNum = 0) => {
    setBillsLoading(true)
    const from = pageNum * BILLS_PAGE_SIZE
    const { data, count } = await supabase
      .from('purchases')
      .select('id, application_id, purchase_date, transaction_time, customer_name, branch_name, net_weight, purity, total_amount, transaction_type', { count: 'exact' })
      .eq('stock_status', 'at_branch')
      .is('is_deleted', false)
      .eq('branch_name', branch)
      .order('purchase_date', { ascending: false })
      .range(from, from + BILLS_PAGE_SIZE - 1)
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

  const handleStateClick  = (state)  => { setSelectedState(state);   setDrillLevel('branches'); loadBranchSummary(state) }
  const handleBranchClick = (branch) => { setSelectedBranch(branch); setDrillLevel('bills');    setBillsPage(0); loadBills(branch, 0) }
  const handleBack = () => {
    if (drillLevel === 'bills')         { setDrillLevel('branches'); setSelectedBranch(null); setBills([]);        setSelectedIds(new Set()) }
    else if (drillLevel === 'branches') { setDrillLevel('states');   setSelectedState(null);  setBranchSummary([]) }
  }

  const toggleBill     = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAllBills = ()   => { if (bills.length > 0 && bills.every(b => selectedIds.has(b.id))) setSelectedIds(new Set()); else setSelectedIds(new Set(bills.map(b => b.id))) }

  const handleOcrUpload = async (file) => {
    if (!file) return
    setOcrFileName(file.name); setOcrLoading(true); setOcrResult(null); setOcrMode(true)
    const fd = new FormData(); fd.append('image', file)
    try {
      const res  = await fetch('/api/ocr-consignment', { method: 'POST', body: fd })
      const data = await res.json()
      if (!data.success) { alert('OCR failed: ' + data.error); setOcrLoading(false); return }
      setOcrResult(data); setOcrSelectedIds(new Set(data.rows.map(r => r.id)))
    } catch (err) { alert('OCR error: ' + err.message) }
    setOcrLoading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const toggleOcrRow = (id) => setOcrSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleCreateFromOcr = async () => {
    if (ocrSelectedIds.size === 0) return
    setCreating(true)
    const billIds = [...ocrSelectedIds]
    const consNo  = genConsignmentNo()
    const { error } = await supabase.from('consignments').insert({
      consignment_no: consNo, created_by: userProfile?.id,
      expected_arrival: null, vehicle_details: null, notes: null,
      status: 'in_transit', total_bills: billIds.length,
      total_net_weight: ocrSelectedNetWt, branch_names: ocrSelectedBranches, bill_ids: billIds,
    })
    if (error) { alert('Error: ' + error.message); setCreating(false); return }
    const BATCH = 100
    for (let i = 0; i < billIds.length; i += BATCH)
      await supabase.from('purchases').update({ stock_status: 'in_consignment' }).in('id', billIds.slice(i, i + BATCH))
    setOcrMode(false); setOcrResult(null); setOcrSelectedIds(new Set()); setCreating(false)
    loadStateSummary(); loadConsignments()
    alert(`✓ Consignment created — ${billIds.length} bills marked In Transit`)
  }

  const handleCreateConsignment = async () => {
    if (selectedIds.size === 0) return
    setCreating(true)
    const billIds     = [...selectedIds]
    const totalNetWt  = selectedBills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)
    const branchNames = [...new Set(selectedBills.map(b => b.branch_name).filter(Boolean))]
    const { error }   = await supabase.from('consignments').insert({
      consignment_no: genConsignmentNo(), created_by: userProfile?.id,
      expected_arrival: form.expected_arrival || null, vehicle_details: form.vehicle_details || null,
      notes: form.notes || null, status: 'created',
      total_bills: billIds.length, total_net_weight: totalNetWt,
      branch_names: branchNames, bill_ids: billIds,
    })
    if (error) { alert('Error: ' + error.message); setCreating(false); return }
    const BATCH = 100
    for (let i = 0; i < billIds.length; i += BATCH)
      await supabase.from('purchases').update({ stock_status: 'in_consignment' }).in('id', billIds.slice(i, i + BATCH))
    setShowCreate(false); setCreating(false)
    setForm({ expected_arrival: '', vehicle_details: '', notes: '' })
    setSelectedIds(new Set())
    loadStateSummary(); loadBranchSummary(selectedState); loadBills(selectedBranch, billsPage); loadConsignments()
  }

  const handleMarkInTransit = async (con) => {
    setMarking(true)
    await supabase.from('consignments').update({ status: 'in_transit' }).eq('id', con.id)
    setTransitCon(null); setMarking(false); loadConsignments()
  }

  const handleUndo = async (con) => {
    setMarking(true)
    const billIds = con.bill_ids || []
    const BATCH = 100
    for (let i = 0; i < billIds.length; i += BATCH)
      await supabase.from('purchases').update({ stock_status: 'at_branch' }).in('id', billIds.slice(i, i + BATCH))
    await supabase.from('consignments').delete().eq('id', con.id)
    setUndoCon(null); setMarking(false)
    loadStateSummary(); loadConsignments()
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
    btnBack:    { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer' },
    btnRed:     { background: 'transparent', color: t.red, border: `1px solid ${t.red}50`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer' },
    checkbox:   { width: '15px', height: '15px', accentColor: t.gold, cursor: 'pointer' },
    lbl:        { fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px', display: 'block' },
  }

  const totalBillsPages = Math.ceil(billsTotal / BILLS_PAGE_SIZE)

  const Breadcrumb = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', fontSize: '13px' }}>
      <span onClick={() => { setDrillLevel('states'); setSelectedState(null); setSelectedBranch(null); setBills([]); setSelectedIds(new Set()) }}
        style={{ color: drillLevel === 'states' ? t.text1 : t.gold, cursor: drillLevel === 'states' ? 'default' : 'pointer', fontWeight: drillLevel === 'states' ? 600 : 400 }}>All States</span>
      {selectedState && (<><span style={{ color: t.text4 }}>›</span>
        <span onClick={() => drillLevel === 'bills' ? (setDrillLevel('branches'), setSelectedBranch(null), setBills([]), setSelectedIds(new Set())) : null}
          style={{ color: drillLevel === 'branches' ? t.text1 : t.gold, cursor: drillLevel === 'bills' ? 'pointer' : 'default', fontWeight: drillLevel === 'branches' ? 600 : 400 }}>{selectedState}</span></>)}
      {selectedBranch && (<><span style={{ color: t.text4 }}>›</span>
        <span style={{ color: t.text1, fontWeight: 600 }}>{selectedBranch}</span></>)}
    </div>
  )

  // OCR PREVIEW
  if (ocrMode) {
    return (
      <div style={s.wrap}>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleOcrUpload(e.target.files[0])} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1 }}>OCR — Movement Report</div>
            <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>{ocrFileName}</div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={s.btnOutline} onClick={() => { setOcrMode(false); setOcrResult(null) }}>← Back</button>
            {ocrResult && ocrSelectedIds.size > 0 && canManage && (
              <button style={s.btnGold} onClick={handleCreateFromOcr} disabled={creating}>
                {creating ? 'Creating...' : `+ Create Consignment (${ocrSelectedIds.size} Bills)`}
              </button>
            )}
          </div>
        </div>

        {ocrLoading && (
          <div style={{ ...s.card, textAlign: 'center', padding: '64px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '16px', display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</div>
            <div style={{ fontSize: '14px', color: t.text2, marginBottom: '8px' }}>Reading movement report...</div>
            <div style={{ fontSize: '12px', color: t.text3 }}>Claude is extracting all rows from the image</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {ocrResult && !ocrLoading && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
              {[
                { label: 'Total Rows Extracted', value: ocrResult.total,       color: t.gold  },
                { label: 'Matched in Supabase',  value: ocrResult.matched,     color: t.green },
                { label: 'Not Found',            value: ocrResult.notFound,    color: ocrResult.notFound > 0 ? t.red : t.text3 },
                { label: 'Wrong Status',         value: ocrResult.wrongStatus, color: ocrResult.wrongStatus > 0 ? t.orange : t.text3 },
              ].map(item => (
                <div key={item.label} style={{ ...s.card, textAlign: 'center', padding: '18px', marginBottom: 0 }}>
                  <div style={{ fontSize: '2rem', fontWeight: 200, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '6px' }}>{item.label}</div>
                </div>
              ))}
            </div>

            {ocrResult.notFoundIds?.length > 0 && (
              <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '10px', padding: '14px 20px', marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', color: t.red, fontWeight: 600, marginBottom: '6px' }}>⚠ {ocrResult.notFoundIds.length} Application IDs not found</div>
                <div style={{ fontSize: '12px', color: t.text3, lineHeight: 1.8 }}>{ocrResult.notFoundIds.join(' · ')}</div>
              </div>
            )}
            {ocrResult.wrongStatusIds?.length > 0 && (
              <div style={{ background: `${t.orange}10`, border: `1px solid ${t.orange}40`, borderRadius: '10px', padding: '14px 20px', marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', color: t.orange, fontWeight: 600, marginBottom: '6px' }}>⚠ {ocrResult.wrongStatusIds.length} bills not at at_branch status</div>
                <div style={{ fontSize: '12px', color: t.text3, lineHeight: 1.8 }}>{ocrResult.wrongStatusIds.map(r => `${r.appId} (${r.status})`).join(' · ')}</div>
              </div>
            )}

            {ocrSelectedIds.size > 0 && (
              <div style={{ background: `${t.gold}12`, border: `1px solid ${t.gold}30`, borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{ocrSelectedIds.size} bills selected</span>
                <span style={{ fontSize: '13px', color: t.text2 }}>Net Wt: <span style={{ color: t.gold, fontWeight: 600 }}>{fmt(ocrSelectedNetWt)}g</span></span>
                <span style={{ fontSize: '13px', color: t.text2 }}>Value: <span style={{ color: t.green, fontWeight: 600 }}>{fmtCr(ocrSelectedValue)}</span></span>
                <span style={{ fontSize: '13px', color: t.text2 }}>Branches: <span style={{ color: t.text1 }}>{ocrSelectedBranches.join(', ')}</span></span>
              </div>
            )}

            {ocrResult.rows?.length > 0 && (
              <div style={s.tblWrap}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...s.th, width: '40px', textAlign: 'center' }}>
                        <input type="checkbox" style={s.checkbox}
                          checked={ocrResult.rows.length > 0 && ocrResult.rows.every(r => ocrSelectedIds.has(r.id))}
                          onChange={() => {
                            if (ocrResult.rows.every(r => ocrSelectedIds.has(r.id))) setOcrSelectedIds(new Set())
                            else setOcrSelectedIds(new Set(ocrResult.rows.map(r => r.id)))
                          }} />
                      </th>
                      {['App ID', 'Date', 'Customer', 'Branch', 'Net Wt', 'Gross Value', 'Status'].map(h => <th key={h} style={s.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ocrResult.rows.map(row => (
                      <tr key={row.id} style={{ background: ocrSelectedIds.has(row.id) ? `${t.gold}10` : 'transparent', transition: 'background .1s' }}>
                        <td style={{ ...s.td, textAlign: 'center', padding: '10px 8px' }}>
                          <input type="checkbox" style={s.checkbox} checked={ocrSelectedIds.has(row.id)} onChange={() => toggleOcrRow(row.id)} />
                        </td>
                        <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{row.application_id}</td>
                        <td style={s.td}>{fmtDate(row.purchase_date)}</td>
                        <td style={s.td}>{row.ocr_row?.customer_name || '—'}</td>
                        <td style={{ ...s.td, color: t.text2 }}>{row.branch_name}</td>
                        <td style={{ ...s.td, color: t.gold }}>{fmt(row.net_weight)}g</td>
                        <td style={s.td}>₹{fmt(row.total_amount)}</td>
                        <td style={s.td}>
                          <span style={{ fontSize: '11px', color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}40`, borderRadius: '4px', padding: '2px 7px' }}>{row.stock_status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div style={s.wrap}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleOcrUpload(e.target.files[0])} />

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Consignment Data</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Group bills into consignments and track shipments to HO</div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {canManage && view === 'bills' && drillLevel === 'states' && (
            <button style={{ ...s.btnOutline, color: t.blue, borderColor: `${t.blue}60` }} onClick={() => fileInputRef.current?.click()}>
              📷 Upload Movement Report
            </button>
          )}
          {canManage && view === 'bills' && drillLevel === 'bills' && selectedIds.size > 0 && (
            <button style={s.btnGold} onClick={() => setShowCreate(true)}>+ Create Consignment ({selectedIds.size} bills)</button>
          )}
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '4px', padding: '4px', background: t.card, borderRadius: '10px', border: `1px solid ${t.border}`, width: 'fit-content', marginBottom: '24px' }}>
        {[
          { key: 'bills',        label: `Bills at Branch${totalAtBranch > 0 ? ` (${totalAtBranch.toLocaleString('en-IN')})` : ''}` },
          { key: 'consignments', label: `Consignments${consignments.length > 0 ? ` (${consignments.length})` : ''}` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)} style={{
            padding: '7px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer',
            background: view === tab.key ? `linear-gradient(135deg, ${t.gold}, ${t.gold}cc)` : 'transparent',
            color: view === tab.key ? '#0a0a0a' : t.text3, fontSize: '12px',
            fontWeight: view === tab.key ? 700 : 500, transition: 'all .2s',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* BILLS VIEW */}
      {view === 'bills' && (
        <>
          <Breadcrumb />

          {/* STATES */}
          {drillLevel === 'states' && (
            <>
              {!statesLoading && stateSummary.length > 0 && (
                <div style={{ background: `linear-gradient(135deg, ${t.card} 0%, ${t.card2} 100%)`, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '18px 28px', marginBottom: '24px', display: 'flex', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${t.gold}, ${t.green}, ${t.blue}, transparent)` }} />
                  {[
                    { label: 'Total Bills',     value: grandTotal.bills.toLocaleString('en-IN'), color: t.gold,  size: '1.6rem' },
                    { label: 'Total Net Wt',    value: `${fmt(grandTotal.net)}g`,               color: t.text1, size: '1.2rem' },
                    { label: 'Total Value',     value: fmtCr(grandTotal.value),                 color: t.green, size: '1.2rem' },
                    { label: 'Active Branches', value: grandTotal.branches,                      color: t.blue,  size: '1.6rem' },
                    { label: 'Avg Bill Age',    value: `${Math.round(grandTotal.avgAge)}d`,      color: ageColor(Math.round(grandTotal.avgAge), t), size: '1.6rem' },
                  ].map((item, i, arr) => (
                    <div key={item.label} style={{ flex: 1, textAlign: 'center', padding: '0 16px', borderRight: i < arr.length - 1 ? `1px solid ${t.border}` : 'none' }}>
                      <div style={{ fontSize: item.size, fontWeight: 200, color: item.color, lineHeight: 1.1, marginBottom: '6px' }}>{item.value}</div>
                      <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em' }}>{item.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {!statesLoading && stateSummary.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '12px', color: t.text4 }}>Sort by:</span>
                  {SORT_OPTIONS.map(opt => (
                    <button key={opt.key} onClick={() => setSortBy(opt.key)} style={{
                      padding: '5px 14px', borderRadius: '20px', border: `1px solid ${sortBy === opt.key ? t.gold : t.border}`,
                      background: sortBy === opt.key ? `${t.gold}18` : 'transparent',
                      color: sortBy === opt.key ? t.gold : t.text3, fontSize: '12px', cursor: 'pointer', transition: 'all .15s',
                    }}>{opt.label}</button>
                  ))}
                </div>
              )}

              {statesLoading ? (
                <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
              ) : stateSummary.length === 0 ? (
                <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
                  <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '12px' }}>📦</div>
                  <div style={{ fontSize: '14px', color: t.text3 }}>No bills at branch</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                  {sortedStates.map(row => {
                    const days   = daysOld(row.oldest_date)
                    const avgAge = Math.round(Number(row.avg_age_days || 0))
                    return (
                      <div key={row.state} onClick={() => handleStateClick(row.state)}
                        style={{ ...s.card, marginBottom: 0, cursor: 'pointer', transition: 'all .2s', position: 'relative', overflow: 'hidden' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = `${t.gold}50`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${t.blue}, transparent)` }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: t.text1 }}>{row.state}</div>
                          {days != null && <span style={{ fontSize: '11px', color: ageColor(days, t), background: `${ageColor(days, t)}18`, border: `1px solid ${ageColor(days, t)}40`, borderRadius: '4px', padding: '2px 8px', fontWeight: 600 }}>⏱ {days}d old</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div><div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '4px' }}>Bills</div>
                            <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.blue }}>{Number(row.bill_count).toLocaleString('en-IN')}</div></div>
                          <div><div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '4px' }}>Net Weight</div>
                            <div style={{ fontSize: '1rem', color: t.text1 }}>{fmt(row.total_net)}g</div></div>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '4px' }}>Value</div>
                          <div style={{ fontSize: '1rem', color: t.green }}>{fmtCr(row.total_value)}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: `1px solid ${t.border}` }}>
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <span style={{ fontSize: '12px', color: t.text3 }}><span style={{ color: t.text2, fontWeight: 600 }}>{Number(row.branch_count)}</span> branches</span>
                            <span style={{ fontSize: '12px', color: t.text3 }}>Avg <span style={{ color: ageColor(avgAge, t), fontWeight: 600 }}>{avgAge}d</span> old</span>
                          </div>
                          <div style={{ fontSize: '12px', color: t.gold }}>View ›</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* BRANCHES */}
          {drillLevel === 'branches' && (
            <>
              <button style={{ ...s.btnBack, marginBottom: '16px' }} onClick={handleBack}>← Back</button>
              {branchesLoading ? <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
              : branchSummary.length === 0 ? (
                <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}><div style={{ fontSize: '14px', color: t.text3 }}>No branches with bills at branch</div></div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                  {branchSummary.map(row => {
                    const days = daysOld(row.oldest_date)
                    return (
                      <div key={row.branch_name} onClick={() => handleBranchClick(row.branch_name)}
                        style={{ ...s.card, marginBottom: 0, cursor: 'pointer', transition: 'all .2s', position: 'relative', overflow: 'hidden' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = `${t.gold}50`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${t.gold}, transparent)` }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: t.text1 }}>{row.branch_name}</div>
                          {days != null && <span style={{ fontSize: '11px', color: ageColor(days, t), background: `${ageColor(days, t)}18`, border: `1px solid ${ageColor(days, t)}40`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>{days}d old</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                          <div><div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>Bills</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.gold }}>{Number(row.bill_count).toLocaleString('en-IN')}</div></div>
                          <div><div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>Net Wt</div>
                            <div style={{ fontSize: '1rem', color: t.text1 }}>{fmt(row.total_net)}g</div></div>
                        </div>
                        <div style={{ marginBottom: '12px' }}><div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>Value</div>
                          <div style={{ fontSize: '13px', color: t.green }}>{fmtCr(row.total_value)}</div></div>
                        <div style={{ fontSize: '12px', color: t.gold, textAlign: 'right' }}>View bills ›</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* BILLS TABLE */}
          {drillLevel === 'bills' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <button style={s.btnBack} onClick={handleBack}>← Back</button>
                {selectedIds.size > 0 && (
                  <div style={{ background: `${t.gold}12`, border: `1px solid ${t.gold}30`, borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{selectedIds.size} selected</span>
                    <span style={{ fontSize: '13px', color: t.text2 }}>Net Wt: <span style={{ color: t.gold }}>{fmt(selectedNetWt)}g</span></span>
                    {canManage && <button style={{ ...s.btnGold, marginLeft: 'auto', padding: '6px 16px' }} onClick={() => setShowCreate(true)}>+ Create Consignment</button>}
                  </div>
                )}
                <div style={{ marginLeft: selectedIds.size > 0 ? 0 : 'auto', fontSize: '12px', color: t.text3, display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                  <span>{billsTotal === 0 ? 0 : billsPage * BILLS_PAGE_SIZE + 1}–{Math.min((billsPage + 1) * BILLS_PAGE_SIZE, billsTotal).toLocaleString('en-IN')} of {billsTotal.toLocaleString('en-IN')}</span>
                  <button onClick={() => { const p = Math.max(0, billsPage - 1); setBillsPage(p); loadBills(selectedBranch, p) }} disabled={billsPage === 0}
                    style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: billsPage === 0 ? t.text4 : t.text2, cursor: billsPage === 0 ? 'not-allowed' : 'pointer', fontSize: '12px' }}>←</button>
                  <span>Page {billsPage + 1} of {totalBillsPages || 1}</span>
                  <button onClick={() => { const p = Math.min(totalBillsPages - 1, billsPage + 1); setBillsPage(p); loadBills(selectedBranch, p) }} disabled={billsPage >= totalBillsPages - 1}
                    style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: billsPage >= totalBillsPages - 1 ? t.text4 : t.text2, cursor: billsPage >= totalBillsPages - 1 ? 'not-allowed' : 'pointer', fontSize: '12px' }}>→</button>
                </div>
              </div>
              {billsLoading ? <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div> : (
                <div style={s.tblWrap}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {canManage && <th style={{ ...s.th, width: '40px', textAlign: 'center' }}><input type="checkbox" style={s.checkbox} checked={bills.length > 0 && bills.every(b => selectedIds.has(b.id))} onChange={toggleAllBills} /></th>}
                        {['App ID', 'Date', 'Time', 'Customer', 'Net Wt', 'Purity', 'Gross Value', 'Type'].map(h => <th key={h} style={s.th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map(bill => (
                        <tr key={bill.id} style={{ background: selectedIds.has(bill.id) ? `${t.gold}10` : 'transparent', transition: 'background .1s' }}>
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
                      {bills.length === 0 && <tr><td colSpan={canManage ? 9 : 8} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>No bills found</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* CONSIGNMENTS VIEW */}
      {view === 'consignments' && (
        <>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
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
                const meta   = STATUS_META[con.status] || { label: con.status, color: t.text3 }
                const isOpen = expandedCon === con.id
                return (
                  <div key={con.id} style={{ ...s.card, marginBottom: 0, cursor: 'pointer' }}
                    onClick={() => setExpandedCon(isOpen ? null : con.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                          <span style={{ fontSize: '11px', color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: '4px', padding: '2px 8px', fontWeight: 600 }}>{meta.label}</span>
                          <span style={{ fontSize: '12px', color: t.text4 }}>{fmtDate(con.created_at)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
                          {[
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
                        {con.notes && <div style={{ marginTop: '10px', fontSize: '12px', color: t.text3, fontStyle: 'italic' }}>Note: {con.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {canManage && con.status === 'created' && (
                          <button style={s.btnBlue} onClick={e => { e.stopPropagation(); setTransitCon(con) }}>🚚 In Transit</button>
                        )}
                        {canManage && (con.status === 'created' || con.status === 'in_transit') && (
                          <button style={s.btnRed} onClick={e => { e.stopPropagation(); setUndoCon(con) }}>↩ Undo</button>
                        )}
                        <span style={{ fontSize: '20px', color: t.text3, transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>⌄</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: '16px', borderTop: `1px solid ${t.border}`, paddingTop: '16px' }}
                        onClick={e => e.stopPropagation()}>
                        <ConBillsList billIds={con.bill_ids} t={t} s={s} />
                      </div>
                    )}
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
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '36px', maxWidth: '480px', width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: '1.1rem', color: t.text1, marginBottom: '6px' }}>Create Consignment</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '28px' }}>{selectedIds.size} bills · {fmt(selectedNetWt)}g · {selectedBranches.length} {selectedBranches.length === 1 ? 'branch' : 'branches'}</div>
            {[
              { label: 'Expected Arrival Date',     key: 'expected_arrival', type: 'date' },
              { label: 'Vehicle / Courier Details', key: 'vehicle_details',  type: 'text', placeholder: 'e.g. KA-01-AB-1234 or BlueDart AWB' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: '18px' }}>
                <label style={s.lbl}>{f.label}</label>
                <input type={f.type} style={s.input} placeholder={f.placeholder || ''} value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ marginBottom: '20px' }}>
              <label style={s.lbl}>Notes / Remarks</label>
              <textarea style={{ ...s.input, height: '72px', resize: 'vertical', fontFamily: 'inherit' }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div style={{ marginBottom: '24px', padding: '12px 16px', background: t.card2, borderRadius: '8px', border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '8px' }}>Branches Included</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {selectedBranches.map(b => <span key={b} style={{ fontSize: '11px', color: t.text2, background: t.card, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '2px 8px' }}>{b}</span>)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnOutline} onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
              <button style={s.btnGold} onClick={handleCreateConsignment} disabled={creating}>{creating ? 'Creating...' : 'Create Consignment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* TRANSIT MODAL */}
      {transitCon && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '36px', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '16px' }}>🚚</div>
            <div style={{ fontSize: '1rem', color: t.text1, marginBottom: '8px' }}>Mark as In Transit?</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '28px', lineHeight: 1.6 }}>{transitCon.total_bills} bills · {fmt(transitCon.total_net_weight)}g<br />This cannot be undone.</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button style={s.btnOutline} onClick={() => setTransitCon(null)} disabled={marking}>Cancel</button>
              <button style={s.btnBlue} onClick={() => handleMarkInTransit(transitCon)} disabled={marking}>{marking ? 'Marking...' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}

      {/* UNDO MODAL */}
      {undoCon && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.red}40`, borderRadius: '16px', padding: '36px', maxWidth: '420px', width: '100%', textAlign: 'center', boxShadow: `0 24px 80px rgba(0,0,0,.6)` }}>
            <div style={{ fontSize: '2rem', marginBottom: '16px' }}>↩</div>
            <div style={{ fontSize: '1rem', color: t.text1, marginBottom: '8px' }}>Undo Consignment?</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '6px', lineHeight: 1.7 }}>
              <span style={{ color: t.text1, fontWeight: 600 }}>{undoCon.total_bills} bills</span> will be moved back to <span style={{ color: t.gold }}>at_branch</span><br />
              The consignment record will be permanently deleted.
            </div>
            <div style={{ fontSize: '12px', color: t.red, marginBottom: '28px' }}>This cannot be undone.</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button style={s.btnOutline} onClick={() => setUndoCon(null)} disabled={marking}>Cancel</button>
              <button style={s.btnRed} onClick={() => handleUndo(undoCon)} disabled={marking}>{marking ? 'Undoing...' : 'Yes, Undo'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}