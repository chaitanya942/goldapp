'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

async function fetchEmployees() {
  const res = await fetch('/api/branch-employees')
  const data = await res.json()
  return data.employees || []
}

const THEMES = {
  dark:  { bg: '#0e0e0e', card: '#141414', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#ede8dc', text1: '#2a1f0a', text2: '#5a4a2a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', green: '#2a8a5a', red: '#cc3333', blue: '#2a6f9f', purple: '#6c3aa8' },
}

export default function BranchEmployees() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [employees, setEmployees]   = useState([])
  const [branches,  setBranches]    = useState([])
  const [loading,   setLoading]     = useState(false)
  const [syncing,   setSyncing]     = useState(false)
  const [syncMsg,   setSyncMsg]     = useState('')
  const [search,    setSearch]      = useState('')
  const [filterBranch,  setFilterBranch]  = useState('')
  const [filterRole,    setFilterRole]    = useState('all')   // all | manager | staff
  const [filterStatus,  setFilterStatus]  = useState('active') // all | active | inactive
  const [selected,  setSelected]    = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [emps, { data: brs }] = await Promise.all([
      fetchEmployees(),
      supabase.from('branches').select('id, name, branch_code').order('name'),
    ])
    setEmployees(emps)
    if (brs) setBranches(brs)
    setLoading(false)
  }

  const syncFromCRM = async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res  = await fetch('/api/sync-branch-employees', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const s = data.summary
        setSyncMsg(`✓ Synced ${s.inserted} employees — ${s.managers} managers, ${s.active} active, ${s.unmatched} unmatched branch`)
        await load()
      } else {
        setSyncMsg(`Error: ${data.error}${data.details ? ` — ${data.details}` : ''}`)
      }
    } catch (e) {
      setSyncMsg(`Error: ${e.message}`)
    }
    setSyncing(false)
  }

  // Branch lookup map
  const branchMap = useMemo(() => {
    const m = {}
    branches.forEach(b => { m[b.id] = b })
    return m
  }, [branches])

  // Filtered list
  const filtered = useMemo(() => {
    let list = employees
    if (filterStatus !== 'all') list = list.filter(e => e.emp_status === filterStatus)
    if (filterRole === 'manager') list = list.filter(e => e.is_manager)
    if (filterRole === 'staff')   list = list.filter(e => !e.is_manager)
    if (filterBranch) list = list.filter(e => e.branch_id === filterBranch)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.name?.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q) ||
        branchMap[e.branch_id]?.name?.toLowerCase().includes(q)
      )
    }
    return list
  }, [employees, filterStatus, filterRole, filterBranch, search, branchMap])

  // Stats
  const stats = useMemo(() => ({
    total:    employees.length,
    active:   employees.filter(e => e.emp_status === 'active').length,
    managers: employees.filter(e => e.is_manager).length,
    branches: new Set(employees.map(e => e.branch_id).filter(Boolean)).size,
  }), [employees])

  const s = {
    wrap: { padding: '20px 24px', minHeight: '100%', background: t.bg },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' },
    title: { fontSize: '.95rem', fontWeight: 600, color: t.text1, letterSpacing: '.04em' },
    sub:   { fontSize: '.7rem', color: t.text3, marginTop: '2px' },
    syncBtn: { background: t.gold, color: '#1a0e00', border: 'none', borderRadius: '6px', padding: '7px 16px', fontSize: '.73rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '.03em' },
    statsRow: { display: 'flex', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' },
    stat: { background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 16px', flex: '1', minWidth: '110px' },
    statVal: { fontSize: '1.35rem', fontWeight: 700, color: t.gold, lineHeight: 1 },
    statLbl: { fontSize: '.65rem', color: t.text3, marginTop: '4px', letterSpacing: '.05em', textTransform: 'uppercase' },
    filtersRow: { display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' },
    input: { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', color: t.text1, fontSize: '.75rem', outline: 'none', flex: 1, minWidth: '180px' },
    select: { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', color: t.text1, fontSize: '.73rem', outline: 'none', cursor: 'pointer' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '.73rem' },
    th: { padding: '8px 10px', borderBottom: `1px solid ${t.border}`, color: t.text3, fontWeight: 500, textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '.04em', textTransform: 'uppercase', fontSize: '.62rem' },
    td: { padding: '9px 10px', borderBottom: `1px solid ${t.border}`, color: t.text2, verticalAlign: 'middle' },
    card: { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', overflow: 'hidden' },
  }

  const DetailPanel = ({ emp }) => {
    const branch = branchMap[emp.branch_id]
    return (
      <div style={{ position: 'fixed', top: 0, right: 0, width: '320px', height: '100vh', background: t.card, borderLeft: `1px solid ${t.border}`, zIndex: 200, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '16px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: t.text1, fontWeight: 600, fontSize: '.85rem' }}>{emp.name}</span>
          <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: t.text3, cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
        <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {emp.is_manager && (
            <div style={{ background: `${t.gold}18`, border: `1px solid ${t.gold}40`, borderRadius: '6px', padding: '6px 12px', color: t.gold, fontSize: '.7rem', fontWeight: 600, textAlign: 'center' }}>
              ★ Branch Manager
            </div>
          )}
          {[
            ['Designation',  emp.designation || '—'],
            ['Branch',       branch?.name || '—'],
            ['Branch Code',  branch?.branch_code || '—'],
            ['Status',       emp.emp_status === 'active' ? 'Active' : 'Inactive'],
            ['Office Phone', emp.contact_phone || '—'],
            ['Mobile',       emp.mobile_phone || '—'],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '.62rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
              <span style={{ fontSize: '.78rem', color: t.text1 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Branch Employees</div>
          <div style={s.sub}>All CRM staff synced from CRM database</div>
        </div>
        <button onClick={syncFromCRM} disabled={syncing} style={{ ...s.syncBtn, opacity: syncing ? .6 : 1 }}>
          {syncing ? 'Syncing…' : '↻ Sync from CRM'}
        </button>
      </div>

      {syncMsg && (
        <div style={{ background: syncMsg.startsWith('✓') ? `${t.green}18` : `${t.red}18`, border: `1px solid ${syncMsg.startsWith('✓') ? t.green : t.red}40`, borderRadius: '6px', padding: '8px 14px', fontSize: '.72rem', color: syncMsg.startsWith('✓') ? t.green : t.red, marginBottom: '16px' }}>
          {syncMsg}
        </div>
      )}

      {/* Stats */}
      <div style={s.statsRow}>
        {[
          { val: stats.total,    lbl: 'Total Staff' },
          { val: stats.active,   lbl: 'Active' },
          { val: stats.managers, lbl: 'Managers' },
          { val: stats.branches, lbl: 'Branches' },
        ].map(({ val, lbl }) => (
          <div key={lbl} style={s.stat}>
            <div style={s.statVal}>{val}</div>
            <div style={s.statLbl}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={s.filtersRow}>
        <input
          placeholder="Search name, designation, branch…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={s.input}
        />
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} style={s.select}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={s.select}>
          <option value="all">All Roles</option>
          <option value="manager">Managers Only</option>
          <option value="staff">Non-Manager Staff</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={s.select}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All Status</option>
        </select>
        <span style={{ fontSize: '.68rem', color: t.text3, whiteSpace: 'nowrap' }}>{filtered.length} records</span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: t.text3, fontSize: '.75rem' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: t.text3, fontSize: '.78rem' }}>
          {employees.length === 0
            ? 'No employees synced yet. Click "Sync from CRM" to pull data.'
            : 'No employees match the current filters.'}
        </div>
      ) : (
        <div style={s.card}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Designation</th>
                <th style={s.th}>Branch</th>
                <th style={s.th}>Mobile</th>
                <th style={s.th}>Office</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => {
                const branch = branchMap[emp.branch_id]
                return (
                  <tr
                    key={emp.id}
                    onClick={() => setSelected(emp)}
                    style={{ cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {emp.is_manager && (
                          <span style={{ color: t.gold, fontSize: '.6rem' }}>★</span>
                        )}
                        <span style={{ color: t.text1, fontWeight: emp.is_manager ? 600 : 400 }}>{emp.name}</span>
                      </div>
                    </td>
                    <td style={{ ...s.td, color: t.text3, fontSize: '.68rem' }}>{emp.designation || '—'}</td>
                    <td style={s.td}>
                      <div style={{ fontSize: '.7rem', color: t.text2 }}>{branch?.name || '—'}</div>
                      {branch?.branch_code && <div style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'monospace' }}>{branch.branch_code}</div>}
                    </td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.68rem', color: emp.mobile_phone ? t.text2 : t.text4 }}>
                      {emp.mobile_phone || '—'}
                    </td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.68rem', color: emp.contact_phone ? t.text2 : t.text4 }}>
                      {emp.contact_phone || '—'}
                    </td>
                    <td style={s.td}>
                      <span style={{ background: emp.emp_status === 'active' ? `${t.green}20` : `${t.red}20`, color: emp.emp_status === 'active' ? t.green : t.red, borderRadius: '4px', padding: '2px 7px', fontSize: '.62rem', fontWeight: 500 }}>
                        {emp.emp_status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DetailPanel emp={selected} />}
    </div>
  )
}
