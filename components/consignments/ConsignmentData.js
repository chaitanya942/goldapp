'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8', shadow: '0 1px 3px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a', shadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06)' },
}

const STATUS_META = {
  created:     { label: 'Created',     color: '#3a8fbf' },
  in_transit:  { label: 'In Transit',  color: '#c9981f' },
  received:    { label: 'Received',    color: '#3aaa6a' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTime = (t) => {
  if (!t) return ''
  try {
    const [h, m] = t.split(':')
    const hr = parseInt(h)
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
  } catch { return t }
}

function genConsignmentNo() {
  const now = new Date()
  const y = now.getFullYear().toString().slice(-2)
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `CSN-${y}${m}${d}-${rand}`
}

export default function ConsignmentData() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme]

  const canManage = ['super_admin', 'founders_office', 'admin'].includes(userProfile?.role)

  // ── Views: 'bills' | 'consignments'
  const [view, setView] = useState('bills')

  // ── Bills state
  const [bills, setBills] = useState([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filterBranch, setFilterBranch] = useState('')
  const [filterState, setFilterState] = useState('')
  const [allBranches, setAllBranches] = useState([])
  const [allStates, setAllStates] = useState([])
  const [billsPage, setBillsPage] = useState(0)
  const [billsTotal, setBillsTotal] = useState(0)
  const BILLS_PAGE_SIZE = 100

  // ── Consignments state
  const [consignments, setConsignments] = useState([])
  const [consLoading, setConsLoading] = useState(false)
  const [filterConsStatus, setFilterConsStatus] = useState('')

  // ── Create consignment modal
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    consignment_no:   genConsignmentNo(),
    expected_arrival: '',
    vehicle_details:  '',
    notes:            '',
  })

  // ── Mark in transit modal
  const [transitCon, setTransitCon] = useState(null)
  const [marking, setMarking] = useState(false)

  // ── Summary of selected bills
  const selectedBills   = bills.filter(b => selectedIds.has(b.id))
  const selectedNetWt   = selectedBills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)
  const selectedBranches = [...new Set(selectedBills.map(b => b.branch_name).filter(Boolean))]

  useEffect(() => {
    loadBranches()
    loadBills(0)
    loadConsignments()
  }, [])

  useEffect(() => {
    loadBills(0)
    setBillsPage(0)
  }, [filterBranch, filterState])

  useEffect(() => {
    loadBills(billsPage)
  }, [billsPage])

  const loadBranches = async () => {
    const { data: branches } = await supabase
      .from('branches').select('name, state').eq('is_active', true).order('name')
    if (branches) {
      setAllBranches(branches.map(b => b.name))
      setAllStates([...new Set(branches.map(b => b.state).filter(Boolean))].sort())
    }
  }

  const loadBills = async (pageNum) => {
    setBillsLoading(true)
    let q = supabase
      .from('purchases')
      .select('id, application_id, purchase_date, transaction_time, customer_name, branch_name, net_weight, purity, total_amount, transaction_type, stock_status', { count: 'exact' })
      .eq('stock_status', 'at_branch')
      .is('is_deleted', false)
      .order('purchase_date', { ascending: false })

    if (filterBranch) q = q.eq('branch_name', filterBranch)
    if (filterState) {
      const { data: stateBranches } = await supabase
        .from('branches').select('name').eq('state', filterState).eq('is_active', true)
      const names = (stateBranches || []).map(b => b.name)
      if (names.length) q = q.in('branch_name', names)
      else { setBills([]); setBillsTotal(0); setBillsLoading(false); return }
    }

    const from = pageNum * BILLS_PAGE_SIZE
    const { data, count } = await q.range(from, from + BILLS_PAGE_SIZE - 1)
    if (data) setBills(data)
    if (count !== null) setBillsTotal(count)
    setSelectedIds(new Set())
    setBillsLoading(false)
  }

  const loadConsignments = async () => {
    setConsLoading(true)
    let q = supabase
      .from('consignments')
      .select('*')
      .order('created_at', { ascending: false })
    if (filterConsStatus) q = q.eq('status', filterConsStatus)
    const { data } = await q
    if (data) setConsignments(data)
    setConsLoading(false)
  }

  useEffect(() => { loadConsignments() }, [filterConsStatus])

  const toggleBill = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const toggleAllBills = () => {
    if (bills.length > 0 && bills.every(b => selectedIds.has(b.id)))
      setSelectedIds(new Set())
    else
      setSelectedIds(new Set(bills.map(b => b.id)))
  }

  const handleCreateConsignment = async () => {
    if (selectedIds.size === 0) return
    setCreating(true)

    const billIds = [...selectedIds]
    const totalNetWt = selectedBills.reduce((s, b) => s + (parseFloat(b.net_weight) || 0), 0)
    const branchNames = [...new Set(selectedBills.map(b => b.branch_name).filter(Boolean))]

    // Insert consignment record
    const { error: consError } = await supabase.from('consignments').insert({
      consignment_no:   form.consignment_no,
      created_by:       userProfile?.id,
      expected_arrival: form.expected_arrival || null,
      vehicle_details:  form.vehicle_details || null,
      notes:            form.notes || null,
      status:           'created',
      total_bills:      billIds.length,
      total_net_weight: totalNetWt,
      branch_names:     branchNames,
      bill_ids:         billIds,
    })

    if (consError) {
      alert('Error creating consignment: ' + consError.message)
      setCreating(false)
      return
    }

    // Update purchases stock_status to in_consignment
    const BATCH = 100
    for (let i = 0; i < billIds.length; i += BATCH) {
      await supabase
        .from('purchases')
        .update({ stock_status: 'in_consignment' })
        .in('id', billIds.slice(i, i + BATCH))
    }

    setShowCreate(false)
    setCreating(false)
    setForm({ consignment_no: genConsignmentNo(), expected_arrival: '', vehicle_details: '', notes: '' })
    loadBills(0)
    loadConsignments()
  }

  const handleMarkInTransit = async (con) => {
    setMarking(true)
    await supabase
      .from('consignments')
      .update({ status: 'in_transit' })
      .eq('id', con.id)
    setTransitCon(null)
    setMarking(false)
    loadConsignments()
  }

  // ── Styles
  const s = {
    wrap:       { padding: '32px', maxWidth: '100%' },
    card:       { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px', marginBottom: '20px' },
    th:         { padding: '10px 14px', fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 600, whiteSpace: 'nowrap' },
    td:         { padding: '10px 14px', fontSize: '13px', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    tblWrap:    { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    select:     { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '13px', cursor: 'pointer' },
    input:      { background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 14px', color: t.text1, fontSize: '13px', outline: 'none', width: '100%' },
    btnGold:    { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '12px', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnOutline: { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '9px 20px', fontSize: '12px', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' },
    btnBlue:    { background: t.blue, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' },
    checkbox:   { width: '15px', height: '15px', accentColor: t.gold, cursor: 'pointer' },
    label:      { fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px', display: 'block' },
  }

  const totalBillsPages = Math.ceil(billsTotal / BILLS_PAGE_SIZE)

  return (
    <div style={s.wrap}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Consignment Data</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Group bills into consignments and track shipments to HO</div>
        </div>
        {canManage && view === 'bills' && selectedIds.size > 0 && (
          <button style={s.btnGold} onClick={() => setShowCreate(true)}>
            + Create Consignment ({selectedIds.size} bills)
          </button>
        )}
      </div>

      {/* ── TAB SWITCHER ── */}
      <div style={{ display: 'flex', gap: '4px', padding: '4px', background: t.card, borderRadius: '10px', border: `1px solid ${t.border}`, width: 'fit-content', marginBottom: '24px' }}>
        {[
          { key: 'bills', label: `Bills at Branch${billsTotal > 0 ? ` (${billsTotal.toLocaleString('en-IN')})` : ''}` },
          { key: 'consignments', label: `Consignments${consignments.length > 0 ? ` (${consignments.length})` : ''}` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)} style={{
            padding: '7px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer',
            background: view === tab.key ? `linear-gradient(135deg, ${t.gold}, ${t.gold}cc)` : 'transparent',
            color: view === tab.key ? '#0a0a0a' : t.text3,
            fontSize: '12px', fontWeight: view === tab.key ? 700 : 500,
            letterSpacing: '.04em', transition: 'all .2s ease',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* BILLS VIEW                                     */}
      {/* ══════════════════════════════════════════════ */}
      {view === 'bills' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select style={s.select} value={filterState} onChange={e => { setFilterState(e.target.value); setFilterBranch('') }}>
              <option value="">All States</option>
              {allStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={s.select} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
              <option value="">All Branches</option>
              {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            {(filterBranch || filterState) && (
              <button style={s.btnOutline} onClick={() => { setFilterBranch(''); setFilterState('') }}>Clear</button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: t.text3 }}>
              {selectedIds.size > 0 && (
                <span style={{ color: t.gold, marginRight: '16px' }}>
                  {selectedIds.size} selected · {fmt(selectedNetWt)}g net weight
                </span>
              )}
              <span>
                {billsTotal === 0 ? '0' : billsPage * BILLS_PAGE_SIZE + 1}–{Math.min((billsPage + 1) * BILLS_PAGE_SIZE, billsTotal).toLocaleString('en-IN')} of {billsTotal.toLocaleString('en-IN')} bills
              </span>
              <button onClick={() => setBillsPage(p => Math.max(0, p - 1))} disabled={billsPage === 0}
                style={{ marginLeft: '10px', background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: billsPage === 0 ? t.text4 : t.text2, cursor: billsPage === 0 ? 'not-allowed' : 'pointer', fontSize: '12px' }}>←</button>
              <span style={{ margin: '0 6px', fontSize: '12px', color: t.text3 }}>Page {billsPage + 1} of {totalBillsPages || 1}</span>
              <button onClick={() => setBillsPage(p => Math.min(totalBillsPages - 1, p + 1))} disabled={billsPage >= totalBillsPages - 1}
                style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: billsPage >= totalBillsPages - 1 ? t.text4 : t.text2, cursor: billsPage >= totalBillsPages - 1 ? 'not-allowed' : 'pointer', fontSize: '12px' }}>→</button>
            </div>
          </div>

          {/* Selected summary bar */}
          {selectedIds.size > 0 && (
            <div style={{ background: `${t.gold}12`, border: `1px solid ${t.gold}30`, borderRadius: '10px', padding: '12px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{selectedIds.size} bills selected</div>
              <div style={{ fontSize: '13px', color: t.text2 }}>Net Weight: <span style={{ color: t.gold }}>{fmt(selectedNetWt)}g</span></div>
              <div style={{ fontSize: '13px', color: t.text2 }}>Branches: <span style={{ color: t.text1 }}>{selectedBranches.join(', ')}</span></div>
              {canManage && (
                <button style={{ ...s.btnGold, marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
                  + Create Consignment
                </button>
              )}
            </div>
          )}

          {billsLoading ? (
            <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
          ) : bills.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
              <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '12px' }}>📦</div>
              <div style={{ fontSize: '14px', color: t.text3 }}>No bills at branch</div>
              <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>All bills have been dispatched or there are no purchases with at_branch status</div>
            </div>
          ) : (
            <div style={s.tblWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {canManage && (
                      <th style={{ ...s.th, width: '40px', textAlign: 'center' }}>
                        <input type="checkbox" style={s.checkbox}
                          checked={bills.length > 0 && bills.every(b => selectedIds.has(b.id))}
                          onChange={toggleAllBills} />
                      </th>
                    )}
                    {['App ID', 'Date', 'Time', 'Customer', 'Branch', 'Net Wt', 'Purity', 'Gross Value', 'Type'].map(h =>
                      <th key={h} style={s.th}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {bills.map(bill => (
                    <tr key={bill.id} style={{ background: selectedIds.has(bill.id) ? `${t.gold}10` : 'transparent', transition: 'background .1s' }}>
                      {canManage && (
                        <td style={{ ...s.td, textAlign: 'center', padding: '10px 8px' }}>
                          <input type="checkbox" style={s.checkbox} checked={selectedIds.has(bill.id)} onChange={() => toggleBill(bill.id)} />
                        </td>
                      )}
                      <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{bill.application_id}</td>
                      <td style={s.td}>{fmtDate(bill.purchase_date)}</td>
                      <td style={{ ...s.td, color: t.text3 }}>{fmtTime(bill.transaction_time) || '—'}</td>
                      <td style={s.td}>{bill.customer_name}</td>
                      <td style={{ ...s.td, color: t.text2 }}>{bill.branch_name}</td>
                      <td style={{ ...s.td, color: t.gold }}>{fmt(bill.net_weight)}g</td>
                      <td style={s.td}>{bill.purity ? `${Number(bill.purity).toFixed(2)}%` : '—'}</td>
                      <td style={s.td}>₹{fmt(bill.total_amount)}</td>
                      <td style={{ ...s.td, fontSize: '11px' }}>
                        <span style={{ color: bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange, background: `${bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange}18`, border: `1px solid ${bill.transaction_type === 'PHYSICAL' ? t.gold : t.orange}40`, borderRadius: '4px', padding: '2px 7px' }}>
                          {bill.transaction_type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* CONSIGNMENTS VIEW                              */}
      {/* ══════════════════════════════════════════════ */}
      {view === 'consignments' && (
        <>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center' }}>
            <select style={s.select} value={filterConsStatus} onChange={e => setFilterConsStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {consLoading ? (
            <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
          ) : consignments.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
              <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '12px' }}>🚚</div>
              <div style={{ fontSize: '14px', color: t.text3 }}>No consignments yet</div>
              <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>Select bills from the Bills tab and create a consignment</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {consignments.map(con => {
                const meta = STATUS_META[con.status] || { label: con.status, color: t.text3 }
                return (
                  <div key={con.id} style={{ ...s.card, marginBottom: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      {/* Left */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                          <div style={{ fontSize: '1rem', fontWeight: 600, color: t.gold, letterSpacing: '.04em' }}>{con.consignment_no}</div>
                          <span style={{ fontSize: '11px', color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: '4px', padding: '2px 8px', fontWeight: 600 }}>{meta.label}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '2px' }}>Created</div>
                            <div style={{ fontSize: '13px', color: t.text2 }}>{fmtDate(con.created_at)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '2px' }}>Bills</div>
                            <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>{con.total_bills}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '2px' }}>Net Weight</div>
                            <div style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{fmt(con.total_net_weight)}g</div>
                          </div>
                          {con.expected_arrival && (
                            <div>
                              <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '2px' }}>Expected Arrival</div>
                              <div style={{ fontSize: '13px', color: t.text2 }}>{fmtDate(con.expected_arrival)}</div>
                            </div>
                          )}
                          {con.vehicle_details && (
                            <div>
                              <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '2px' }}>Vehicle</div>
                              <div style={{ fontSize: '13px', color: t.text2 }}>{con.vehicle_details}</div>
                            </div>
                          )}
                        </div>
                        {con.branch_names?.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {con.branch_names.map(b => (
                              <span key={b} style={{ fontSize: '11px', color: t.text3, background: t.card2, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '2px 8px' }}>{b}</span>
                            ))}
                          </div>
                        )}
                        {con.notes && (
                          <div style={{ marginTop: '10px', fontSize: '12px', color: t.text3, fontStyle: 'italic' }}>Note: {con.notes}</div>
                        )}
                      </div>

                      {/* Actions */}
                      {canManage && con.status === 'created' && (
                        <button style={s.btnBlue} onClick={() => setTransitCon(con)}>
                          🚚 Mark In Transit
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* CREATE CONSIGNMENT MODAL                       */}
      {/* ══════════════════════════════════════════════ */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '36px', maxWidth: '520px', width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: '1.1rem', color: t.text1, fontWeight: 400, marginBottom: '6px' }}>Create Consignment</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '28px' }}>{selectedIds.size} bills · {fmt(selectedNetWt)}g net weight · {selectedBranches.length} {selectedBranches.length === 1 ? 'branch' : 'branches'}</div>

            {/* Consignment No */}
            <div style={{ marginBottom: '18px' }}>
              <label style={s.label}>Consignment Number</label>
              <input style={s.input} value={form.consignment_no} onChange={e => setForm(f => ({ ...f, consignment_no: e.target.value }))} />
            </div>

            {/* Expected Arrival */}
            <div style={{ marginBottom: '18px' }}>
              <label style={s.label}>Expected Arrival Date</label>
              <input type="date" style={s.input} value={form.expected_arrival} onChange={e => setForm(f => ({ ...f, expected_arrival: e.target.value }))} />
            </div>

            {/* Vehicle Details */}
            <div style={{ marginBottom: '18px' }}>
              <label style={s.label}>Vehicle / Courier Details</label>
              <input style={s.input} placeholder="e.g. KA-01-AB-1234 or BlueDart AWB no." value={form.vehicle_details} onChange={e => setForm(f => ({ ...f, vehicle_details: e.target.value }))} />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '28px' }}>
              <label style={s.label}>Notes / Remarks</label>
              <textarea style={{ ...s.input, height: '80px', resize: 'vertical', fontFamily: 'inherit' }} placeholder="Any additional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Branches included */}
            <div style={{ marginBottom: '28px', padding: '14px 16px', background: t.card2, borderRadius: '8px', border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '8px' }}>Branches Included</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {selectedBranches.map(b => (
                  <span key={b} style={{ fontSize: '11px', color: t.text2, background: t.card, border: `1px solid ${t.border}`, borderRadius: '4px', padding: '2px 8px' }}>{b}</span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnOutline} onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
              <button style={s.btnGold} onClick={handleCreateConsignment} disabled={creating}>
                {creating ? 'Creating...' : `Create Consignment`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* MARK IN TRANSIT MODAL                          */}
      {/* ══════════════════════════════════════════════ */}
      {transitCon && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '36px', maxWidth: '420px', width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,.6)', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '16px' }}>🚚</div>
            <div style={{ fontSize: '1rem', color: t.text1, fontWeight: 400, marginBottom: '8px' }}>Mark as In Transit?</div>
            <div style={{ fontSize: '13px', color: t.text2, marginBottom: '6px' }}>{transitCon.consignment_no}</div>
            <div style={{ fontSize: '12px', color: t.text3, marginBottom: '28px', lineHeight: 1.6 }}>
              This will mark the consignment as in transit.<br />The {transitCon.total_bills} bills in this consignment will remain in <span style={{ color: t.orange }}>in_consignment</span> status.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button style={s.btnOutline} onClick={() => setTransitCon(null)} disabled={marking}>Cancel</button>
              <button style={s.btnBlue} onClick={() => handleMarkInTransit(transitCon)} disabled={marking}>
                {marking ? 'Marking...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}