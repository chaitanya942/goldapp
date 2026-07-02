'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

async function fetchEmployees() {
  const res = await authedFetch('/api/branch-employees')
  const data = await res.json()
  return data.employees || []
}

const fmtAgo = (iso) => {
  if (!iso) return '—'
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

export default function BranchEmployees() {
  const { theme, setActiveNav, canSee } = useApp()
  const t = THEMES[theme]
  const [view, setView] = useState('directory')   // 'directory' | 'insights'

  const [employees, setEmployees]   = useState([])
  const [branches,  setBranches]    = useState([])
  const [loading,   setLoading]     = useState(false)
  const [search,    setSearch]      = useState('')
  const [filterBranch,    setFilterBranch]    = useState('')
  const [filterRole,      setFilterRole]      = useState('all')
  const [filterStatus,    setFilterStatus]    = useState('active')
  const [filterUnmatched, setFilterUnmatched] = useState(false)
  const [selected,        setSelected]        = useState(null)

  const hasActiveFilters = search || filterBranch || filterRole !== 'all' || filterStatus !== 'active' || filterUnmatched

  const clearFilters = () => {
    setSearch('')
    setFilterBranch('')
    setFilterRole('all')
    setFilterStatus('active')
    setFilterUnmatched(false)
  }

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

  // Branch lookup map
  const branchMap = useMemo(() => {
    const m = {}
    branches.forEach(b => { m[b.id] = b })
    return m
  }, [branches])

  // Filtered list
  const filtered = useMemo(() => {
    let list = employees
    if (filterUnmatched) return list.filter(e => !e.branch_id)
    if (filterStatus !== 'all') list = list.filter(e => e.emp_status === filterStatus)
    if (filterRole === 'manager') list = list.filter(e => e.is_manager)
    if (filterRole === 'staff')   list = list.filter(e => !e.is_manager)
    if (filterBranch) list = list.filter(e => e.branch_id === filterBranch)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.name?.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q) ||
        e.emp_id?.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q) ||
        e.role?.toLowerCase().includes(q) ||
        branchMap[e.branch_id]?.name?.toLowerCase().includes(q) ||
        e.crm_branch_name?.toLowerCase().includes(q) ||
        e.mobile_phone?.includes(q) ||
        e.contact_phone?.includes(q)
      )
    }
    return list
  }, [employees, filterStatus, filterRole, filterBranch, search, branchMap])

  const lastSynced = useMemo(() => {
    const ts = employees.map(e => e.synced_at).filter(Boolean).sort()
    return ts.length ? ts[ts.length - 1] : null
  }, [employees])

  // Stats
  const stats = useMemo(() => ({
    total:     employees.length,
    active:    employees.filter(e => e.emp_status === 'active').length,
    managers:  employees.filter(e => e.is_manager).length,
    branches:  new Set(employees.map(e => e.branch_id || e.crm_branch_name).filter(Boolean)).size,
    unmatched: employees.filter(e => !e.branch_id).length,
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
            ['Emp ID',          emp.emp_id || '—'],
            ['Designation',     emp.designation || '—'],
            ['Role',            emp.role || '—'],
            ['Access Level',    emp.access_level || '—'],
            ['Branch',          branch?.name || emp.crm_branch_name || '—'],
            ['Branch Code',     branch?.branch_code || emp.crm_branch_code || '—'],
            ['Status',          emp.emp_status === 'active' ? 'Active' : 'Inactive'],
            ['Mobile',          emp.mobile_phone || '—'],
            ['Email',           emp.email || '—'],
            ['PAN',             emp.pan_number || '—'],
            ['Date of Joining', emp.date_of_joining || '—'],
            ['— CRM Activity —', ''],
            ['Cases Opened',    emp.cases_opened  != null ? String(emp.cases_opened)  : '—'],
            ['Cases Handled',   emp.cases_handled != null ? String(emp.cases_handled) : '—'],
            ['Last Activity',   emp.last_txn_at  ? fmtAgo(emp.last_txn_at)  : '—'],
            ['Last Login',      emp.logged_in_at ? fmtAgo(emp.logged_in_at) : '—'],
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
          <div style={s.sub}>All staff synced from the NEW CRM</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '.68rem', color: t.text3, lineHeight: 1.5 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: t.green, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.green, boxShadow: `0 0 5px ${t.green}` }} />
            Auto-synced daily · midnight
          </div>
          <div style={{ color: t.text4 }}>Last synced {fmtAgo(lastSynced)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `1px solid ${t.border}` }}>
        {[['directory', 'Directory'], ['insights', '★ Insights']].map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)} style={{ background: 'none', border: 'none', borderBottom: view === v ? `2px solid ${t.gold}` : '2px solid transparent', color: view === v ? t.gold : t.text3, padding: '8px 14px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>{lbl}</button>
        ))}
      </div>

      {view === 'insights' ? <EmployeeInsights t={t} setActiveNav={setActiveNav} canSee={canSee} /> : (<>

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
        {stats.unmatched > 0 && (
          <div
            onClick={() => { setFilterUnmatched(f => !f); setFilterStatus('all') }}
            style={{ ...s.stat, border: `1px solid ${filterUnmatched ? t.red : t.red + '55'}`, background: filterUnmatched ? `${t.red}18` : t.card, cursor: 'pointer', flexShrink: 0 }}
          >
            <div style={{ ...s.statVal, color: t.red }}>{stats.unmatched}</div>
            <div style={{ ...s.statLbl, color: t.red }}>Unmatched</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={s.filtersRow}>
        <input
          placeholder="Search name, designation, branch…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={s.input}
        />
        <select value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setFilterUnmatched(false) }} style={s.select}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setFilterUnmatched(false) }} style={s.select}>
          <option value="all">All Roles</option>
          <option value="manager">Managers Only</option>
          <option value="staff">Non-Manager Staff</option>
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setFilterUnmatched(false) }} style={s.select}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All Status</option>
        </select>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 12px', color: t.text3, fontSize: '.7rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Clear filters
          </button>
        )}
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
                <th style={s.th}>Emp ID</th>
                <th style={s.th}>Name</th>
                <th style={s.th}>Designation</th>
                <th style={s.th}>Role</th>
                <th style={s.th}>Branch</th>
                <th style={s.th}>Mobile</th>
                <th style={s.th}>Email</th>
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
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.66rem', color: t.text3 }}>{emp.emp_id || '—'}</td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {emp.is_manager && (
                          <span style={{ color: t.gold, fontSize: '.6rem' }}>★</span>
                        )}
                        <span style={{ color: t.text1, fontWeight: emp.is_manager ? 600 : 400 }}>{emp.name}</span>
                      </div>
                    </td>
                    <td style={{ ...s.td, color: t.text3, fontSize: '.68rem' }}>{emp.designation || '—'}</td>
                    <td style={{ ...s.td, fontSize: '.64rem', color: t.text3, whiteSpace: 'nowrap' }}>{emp.role || '—'}</td>
                    <td style={s.td}>
                      <div style={{ fontSize: '.7rem', color: branch ? t.text2 : t.text3 }}>
                        {branch?.name || emp.crm_branch_name || '—'}
                      </div>
                      {(branch?.branch_code || emp.crm_branch_code) && (
                        <div style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'monospace' }}>
                          {branch?.branch_code || emp.crm_branch_code}
                        </div>
                      )}
                    </td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.68rem', color: emp.mobile_phone ? t.text2 : t.text4 }}>
                      {emp.mobile_phone || '—'}
                    </td>
                    <td style={{ ...s.td, fontSize: '.64rem', color: emp.email ? t.text2 : t.text4, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={emp.email || ''}>
                      {emp.email || '—'}
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
      </>)}

      {selected && <DetailPanel emp={selected} />}
    </div>
  )
}

// ── Insights tab — live from NEW CRM (performance, throughput, rollups) ────────
function EmployeeInsights({ t, setActiveNav, canSee }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('performance')
  const [sortStage, setSortStage] = useState('cases')

  useEffect(() => {
    let live = true
    authedFetch('/api/branch-employees/insights').then(r => r.json()).then(j => { if (!live) return; j.error ? setErr(j.error) : setD(j) }).catch(e => setErr(e.message))
    return () => { live = false }
  }, [])

  const fmtM = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(0) + 'm'
  const num  = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN')
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 10 }
  const th = { padding: '7px 10px', fontSize: '.6rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: '.72rem', color: t.text2, borderBottom: `1px solid ${t.border}66`, whiteSpace: 'nowrap' }
  const STAGE_LBL = { val: 'Valuation', estneg: 'Estim+Nego', quoprep: 'Quo prep', quoappr: 'Quo appr', kyc: 'KYC', pay: 'Payment' }

  if (err) return <div style={{ ...card, padding: 16, color: t.red, fontSize: '.75rem' }}>⚠ {err}</div>
  if (!d)  return <div style={{ padding: 40, textAlign: 'center', color: t.text3, fontSize: '.75rem' }}>Computing insights from CRM…</div>

  const T = d.totals
  const stages = d.stages || []
  const perfRows = [...d.people].filter(p => p.active && p.perf?.cases > 0)
    .sort((a, b) => sortStage === 'cases' ? (b.perf.cases - a.perf.cases) : ((a.perf[sortStage] ?? 1e9) - (b.perf[sortStage] ?? 1e9)))
    .slice(0, 40)
  const goProductivity = () => canSee?.('productivity') && setActiveNav?.('productivity')

  const Kpi = ({ label, val, color }) => (
    <div style={{ ...card, padding: '11px 14px', flex: 1, minWidth: 120, borderLeft: `3px solid ${color || t.gold}` }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: color || t.gold, fontFamily: 'monospace' }}>{val}</div>
      <div style={{ fontSize: '.6rem', color: t.text3, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    </div>
  )
  const TabBtn = ({ id, label }) => <button onClick={() => setTab(id)} style={{ background: tab === id ? `${t.gold}18` : 'none', border: `1px solid ${tab === id ? t.gold : t.border}`, borderRadius: 6, color: tab === id ? t.gold : t.text3, padding: '5px 12px', fontSize: '.7rem', fontWeight: 600, cursor: 'pointer' }}>{label}</button>
  // tiny inline SVG sparkline (30-day daily throughput)
  const Sparkline = ({ data, color, w = 92, h = 22 }) => {
    if (!data || !data.length) return <span style={{ color: t.text4, fontSize: '.62rem' }}>—</span>
    const mx = Math.max(1, ...data), n = data.length
    const pts = data.map((v, i) => `${(i / (n - 1)) * w},${h - (v / mx) * (h - 3) - 1}`).join(' ')
    const area = `0,${h} ${pts} ${w},${h}`
    return (
      <svg width={w} height={h} style={{ display: 'block' }}>
        <polygon points={area} fill={`${color || t.blue}22`} />
        <polyline points={pts} fill="none" stroke={color || t.blue} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    )
  }
  const Leader = ({ title, rows, valFn, sub }) => (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.text1 }}>{title} <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>{sub}</span></div>
      {rows.map((p, i) => (
        <div key={p.emp_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${t.border}44` }}>
          <span style={{ width: 16, color: t.text4, fontSize: '.62rem' }}>{i + 1}</span>
          <span style={{ flex: 1, color: t.text1, fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name} <span style={{ color: t.text4, fontSize: '.6rem' }}>· {p.branch}</span></span>
          <span style={{ color: t.gold, fontWeight: 700, fontFamily: 'monospace', fontSize: '.72rem' }}>{valFn(p)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Active Staff" val={num(T.active)} color={t.green} />
        <Kpi label="With CRM Activity" val={num(T.with_activity)} color={t.blue} />
        <Kpi label="Cases Opened" val={num(T.total_cases_opened)} />
        <Kpi label="Org Median TAT" val={fmtM(T.median_org_tat)} color={t.gold} />
        <Kpi label="Idle 30d+" val={num(T.idle_30d)} color={t.red} />
        <Kpi label="Exits" val={num(T.exits)} color={t.text3} />
      </div>

      {/* Overview: org 30-day throughput trend + stage bottleneck */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div style={{ ...card, padding: '11px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '.72rem', fontWeight: 700, color: t.text1 }}>Org throughput <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· cases/day · last 30d</span></span>
            <span style={{ fontSize: '.72rem', fontFamily: 'monospace', color: t.blue }}>{num((d.orgTrend || []).reduce((s, v) => s + v, 0))} total</span>
          </div>
          <div style={{ marginTop: 8 }}><Sparkline data={d.orgTrend} color={t.blue} w={520} h={44} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.55rem', color: t.text4, marginTop: 2 }}>
            <span>{(d.trendDays || [])[0]}</span><span>{(d.trendDays || []).slice(-1)[0]}</span>
          </div>
        </div>
        <div style={{ ...card, padding: '11px 14px' }}>
          <div style={{ fontSize: '.72rem', fontWeight: 700, color: t.text1, marginBottom: 8 }}>Stage bottleneck <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· org median hrs/stage · where time goes</span></div>
          {(() => { const st = (d.bottleneck || []).filter(b => b.stage !== 'total'); const mx = Math.max(1, ...st.map(b => b.median || 0)); return st.map(b => (
            <div key={b.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ width: 78, fontSize: '.62rem', color: t.text3, textAlign: 'right' }}>{STAGE_LBL[b.stage] || b.stage}</span>
              <div style={{ flex: 1, height: 12, background: `${t.border}55`, borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${((b.median || 0) / mx) * 100}%`, height: '100%', background: b.median === mx ? t.red : t.gold, borderRadius: 3 }} /></div>
              <span style={{ width: 48, fontSize: '.62rem', fontFamily: 'monospace', color: b.median === mx ? t.red : t.text2, textAlign: 'right' }}>{fmtM(b.median)}</span>
            </div>
          )) })()}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <TabBtn id="performance" label="Performance" />
        <TabBtn id="branches" label="Branch rollup" />
        <TabBtn id="regions" label="Region rollup" />
        <TabBtn id="leaders" label="Leaders" />
        <TabBtn id="lifecycle" label="Idle / Joiners / Exits" />
        {canSee?.('productivity') && <button onClick={goProductivity} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${t.border}`, borderRadius: 6, color: t.blue, padding: '5px 12px', fontSize: '.7rem', fontWeight: 600, cursor: 'pointer' }}>Open Productivity →</button>}
      </div>

      {tab === 'performance' && (
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.text1 }}>Performance — per-employee stage TAT medians <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· click a stage to rank by it (fastest first) · top 40 by cases</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Employee</th><th style={th}>Branch</th>
                <th onClick={() => setSortStage('cases')} style={{ ...th, textAlign: 'right', cursor: 'pointer', color: sortStage === 'cases' ? t.gold : t.text4 }}>Cases{sortStage === 'cases' ? ' ▾' : ''}</th>
                {stages.map(sk => <th key={sk} onClick={() => setSortStage(sk)} style={{ ...th, textAlign: 'right', cursor: 'pointer', color: sortStage === sk ? t.gold : t.text4 }}>{STAGE_LBL[sk]}{sortStage === sk ? ' ▾' : ''}</th>)}
                <th style={{ ...th, textAlign: 'right', color: t.gold }}>Total</th>
                <th style={{ ...th, textAlign: 'center' }}>30d activity</th>
              </tr></thead>
              <tbody>{perfRows.map(p => (
                <tr key={p.emp_id}>
                  <td style={{ ...td, color: t.text1, fontWeight: 600 }}>{p.name}</td>
                  <td style={td}>{p.branch}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{num(p.perf.cases)}</td>
                  {stages.map(sk => <td key={sk} style={{ ...td, textAlign: 'right', color: sortStage === sk ? t.gold : t.text2 }}>{fmtM(p.perf[sk])}</td>)}
                  <td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtM(p.perf.total)}</td>
                  <td style={{ ...td, padding: '2px 10px' }}><Sparkline data={p.spark} color={t.blue} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'branches' && (
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.text1 }}>Branch rollup <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· staff · manager coverage · cases · median TAT</span></div>
          <div style={{ overflowX: 'auto', maxHeight: 500 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Branch</th><th style={{ ...th, textAlign: 'right' }}>Staff</th><th style={{ ...th, textAlign: 'right' }}>Managers</th><th style={{ ...th, textAlign: 'right' }}>Cases opened</th><th style={{ ...th, textAlign: 'right' }}>Median TAT</th></tr></thead>
              <tbody>{d.byBranch.map(b => (
                <tr key={b.key}>
                  <td style={{ ...td, color: t.text1, fontWeight: 600 }}>{b.key}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{num(b.staff)}</td>
                  <td style={{ ...td, textAlign: 'right', color: b.managers === 0 ? t.red : t.text2 }}>{num(b.managers)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{num(b.cases_opened)}</td>
                  <td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtM(b.median_tat)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'regions' && (
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.text1 }}>Region rollup <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· staff · branches · cases · median TAT</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Region</th><th style={{ ...th, textAlign: 'right' }}>Staff</th><th style={{ ...th, textAlign: 'right' }}>Branches</th><th style={{ ...th, textAlign: 'right' }}>Cases opened</th><th style={{ ...th, textAlign: 'right' }}>Median TAT</th></tr></thead>
              <tbody>{(d.byRegion || []).map(r => (
                <tr key={r.key}>
                  <td style={{ ...td, color: t.text1, fontWeight: 600 }}>{r.key}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{num(r.staff)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{num(r.branches)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{num(r.cases_opened)}</td>
                  <td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtM(r.median_tat)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'leaders' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Leader title="Top openers" sub="· cases opened" rows={d.topOpeners} valFn={p => num(p.cases_opened)} />
          <Leader title="Top handlers" sub="· cases touched" rows={d.topHandlers} valFn={p => num(p.cases_handled)} />
          <Leader title="Fastest (≥5 cases)" sub="· median total TAT" rows={d.fastest} valFn={p => fmtM(p.perf.total)} />
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.text1 }}>By role</div>
            {d.byRole.map(r => <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', borderBottom: `1px solid ${t.border}44`, fontSize: '.72rem' }}><span style={{ color: t.text2 }}>{r.key}</span><span style={{ color: t.gold, fontWeight: 700 }}>{num(r.staff)}</span></div>)}
          </div>
        </div>
      )}

      {tab === 'lifecycle' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.red }}>Idle 30d+ <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· no CRM activity</span></div>
            {d.idle.map(p => <div key={p.emp_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${t.border}44`, fontSize: '.7rem' }}><span style={{ color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name} <span style={{ color: t.text4, fontSize: '.6rem' }}>· {p.branch}</span></span><span style={{ color: t.red, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.idle_days == null ? 'never' : `${p.idle_days}d`}</span></div>)}
          </div>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.green }}>New joiners <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· ≤3 months</span></div>
            {d.newJoiners.length ? d.newJoiners.map(p => <div key={p.emp_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${t.border}44`, fontSize: '.7rem' }}><span style={{ color: t.text1 }}>{p.name} <span style={{ color: t.text4, fontSize: '.6rem' }}>· {p.branch}</span></span><span style={{ color: t.green, whiteSpace: 'nowrap' }}>{p.tenure_months}mo</span></div>) : <div style={{ padding: 12, color: t.text4, fontSize: '.7rem' }}>None (date-of-joining sparse in CRM)</div>}
          </div>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}`, fontSize: '.72rem', fontWeight: 700, color: t.text3 }}>Exits <span style={{ color: t.text4, fontWeight: 400, fontSize: '.62rem' }}>· active=false · {d.exits.length}</span></div>
            {d.exits.slice(0, 40).map(p => <div key={p.emp_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${t.border}44`, fontSize: '.7rem' }}><span style={{ color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span><span style={{ color: t.text4, fontSize: '.6rem', whiteSpace: 'nowrap' }}>{p.branch}</span></div>)}
          </div>
        </div>
      )}
    </div>
  )
}
