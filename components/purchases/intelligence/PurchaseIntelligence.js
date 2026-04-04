'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../../lib/context'
import GoldSpinner from '../../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const TABS = [
  { id: 'overview',   label: 'Overview',         icon: '◈' },
  { id: 'branches',   label: 'Branch Matrix',    icon: '⬡' },
  { id: 'customers',  label: 'Repeat Customers', icon: '↻' },
  { id: 'pending',    label: 'Pending Aging',    icon: '⏳' },
  { id: 'pipeline',   label: 'Pipeline',         icon: '→' },
]

const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric'}) : '—'
const fmtVal   = n => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits:0 })}` : '—'
const fmtNum   = n => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtPct   = n => n != null ? `${Number(n).toFixed(1)}%` : '—'

function StatCard({ label, value, sub, color, alert, t }) {
  return (
    <div style={{
      background: alert ? `${color}10` : t.card,
      border: `1px solid ${alert ? color + '50' : t.border}`,
      borderRadius: '12px', padding: '18px 20px',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position:'absolute', top:0, left:'16px', right:'16px', height:'1.5px', background:`linear-gradient(90deg,transparent,${color}60,transparent)` }} />
      <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'10px' }}>{label}</div>
      <div style={{ fontSize:'1.6rem', fontWeight:200, color, lineHeight:1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:'.62rem', color: t.text4, marginTop:'8px', lineHeight:1.4 }}>{sub}</div>}
    </div>
  )
}

function AlertBanner({ icon, title, desc, color, t }) {
  return (
    <div style={{ background:`${color}10`, border:`1px solid ${color}40`, borderRadius:'10px', padding:'12px 18px', display:'flex', alignItems:'center', gap:'12px' }}>
      <div style={{ fontSize:'1rem', color }}>{icon}</div>
      <div>
        <div style={{ fontSize:'.75rem', color, fontWeight:500 }}>{title}</div>
        <div style={{ fontSize:'.68rem', color: t.text3, marginTop:'2px' }}>{desc}</div>
      </div>
    </div>
  )
}

// ── BRANCH STATUS COLOR ──
function branchStatus(days) {
  if (days === 9999 || days === null) return { label: 'Never',   color: '#555', bg: '#55555520' }
  if (days === 0)                     return { label: 'Active',  color: '#3aaa6a', bg: '#3aaa6a18' }
  if (days <= 6)                      return { label: 'Recent',  color: '#c9a84c', bg: '#c9a84c18' }
  if (days <= 29)                     return { label: 'Dormant', color: '#c9981f', bg: '#c9981f18' }
  return                                     { label: 'Inactive',color: '#e05555', bg: '#e0555518' }
}

// ── AGING COLOR ──
function agingColor(days, t) {
  if (days <= 7)  return t.green
  if (days <= 30) return t.orange
  if (days <= 90) return '#c9981f'
  return t.red
}

// ── MINI BAR ──
function MiniBar({ value, max, color, height = 4 }) {
  const pct = max > 0 ? Math.min(100, Math.round(Number(value) / Number(max) * 100)) : 0
  return (
    <div style={{ height, background: `${color}20`, borderRadius: '2px', minWidth: '60px' }}>
      <div style={{ width:`${pct}%`, height:'100%', background: color, borderRadius:'2px' }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({ t }) {
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/purchase-intelligence?action=overview')
      .then(r => r.json()).then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'80px' }}><GoldSpinner size={32}/></div>
  if (!data)   return null

  const { funnel, branchActivity, pendingAging, highRejBranches, walkinFunnel } = data
  const f  = funnel     || {}
  const ba = branchActivity || {}
  const wf = walkinFunnel   || {}

  const approvalRate = f.approved > 0 ? ((Number(f.approved) / (Number(f.approved) + Number(f.rejected))) * 100).toFixed(1) : '—'
  const walkinConv   = wf.total_walkin > 0 ? ((Number(wf.sold) / Number(wf.total_walkin)) * 100).toFixed(1) : '—'
  const oldPending   = (pendingAging || []).filter(b => b.bucket === '90+ days').reduce((s, b) => s + Number(b.count), 0)

  const BUCKET_ORDER = ['Today','1–7 days','8–30 days','31–90 days','90+ days']
  const agingMap     = {}
  ;(pendingAging || []).forEach(b => { agingMap[b.bucket] = b })

  const card = { background: t.card, border:`1px solid ${t.border}`, borderRadius:'14px', padding:'20px 24px' }

  return (
    <div>
      {/* ALERTS */}
      {(Number(ba.inactive) > 0 || Number(ba.dormant) > 0 || oldPending > 0 || highRejBranches?.length > 0) && (
        <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'24px' }}>
          {Number(ba.inactive) > 0 && (
            <AlertBanner icon="⊘" color={t.red} t={t}
              title={`${ba.inactive} branch${Number(ba.inactive)>1?'es':''} inactive for 30+ days`}
              desc="No approved purchases in over a month — check branch activity and CRM records" />
          )}
          {Number(ba.dormant) > 0 && (
            <AlertBanner icon="◌" color={t.orange} t={t}
              title={`${ba.dormant} branch${Number(ba.dormant)>1?'es':''} dormant (7–30 days)`}
              desc="These branches have not had an approved purchase in the last 7–30 days" />
          )}
          {oldPending > 0 && (
            <AlertBanner icon="⏳" color={t.red} t={t}
              title={`${oldPending} pending bill${oldPending>1?'s':''} older than 90 days`}
              desc="Some bills have been sitting in pending status for months — review immediately" />
          )}
          {highRejBranches?.length > 0 && (
            <AlertBanner icon="!" color={t.orange} t={t}
              title={`${highRejBranches.length} branch${highRejBranches.length>1?'es':''} with >20% rejection rate`}
              desc={`Highest: ${highRejBranches[0]?.branch_name || highRejBranches[0]?.branch_id} at ${highRejBranches[0]?.rejection_rate}%`} />
          )}
        </div>
      )}

      {/* BRANCH ACTIVITY */}
      <div style={{ fontSize:'.6rem', color:t.text4, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'10px' }}>Branch Activity</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px', marginBottom:'28px' }}>
        <StatCard label="Active Today"    value={fmtNum(ba.active_today)} color={t.green}  sub="Purchased today"          t={t} />
        <StatCard label="Active This Week" value={fmtNum(ba.active_week)} color={t.gold}   sub="Last 1–6 days"            t={t} />
        <StatCard label="Dormant (7–30d)" value={fmtNum(ba.dormant)}     color={t.orange} sub="No purchase in 7–30 days" t={t} alert={Number(ba.dormant)>0} />
        <StatCard label="Inactive (30d+)" value={fmtNum(ba.inactive)}    color={t.red}    sub="No purchase in 30+ days"  t={t} alert={Number(ba.inactive)>0} />
      </div>

      {/* CRM SUBMISSION FUNNEL */}
      <div style={{ fontSize:'.6rem', color:t.text4, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'10px' }}>CRM Submission Funnel (All Time)</div>
      <div style={{ ...card, marginBottom:'24px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'0', alignItems:'stretch' }}>
          {[
            { label:'Total Submissions', value: fmtNum(f.total_submissions), color: t.text1 },
            { label:'Approved',          value: fmtNum(f.approved),           color: t.green  },
            { label:'Rejected',          value: fmtNum(f.rejected),           color: t.red    },
            { label:'Pending',           value: fmtNum(f.pending),            color: t.orange },
            { label:'Approval Rate',     value: `${approvalRate}%`,           color: t.gold   },
          ].map((item, i) => (
            <div key={i} style={{ textAlign:'center', padding:'16px 8px', borderLeft: i>0 ? `1px solid ${t.border}` : 'none' }}>
              <div style={{ fontSize:'1.5rem', fontWeight:200, color:item.color }}>{item.value}</div>
              <div style={{ fontSize:'.58rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', marginTop:'6px' }}>{item.label}</div>
            </div>
          ))}
        </div>
        {/* Visual funnel bar */}
        <div style={{ marginTop:'16px', height:'6px', background:`${t.border}40`, borderRadius:'3px', overflow:'hidden', display:'flex' }}>
          {Number(f.total_submissions) > 0 && [
            { v: Number(f.approved),  c: t.green  },
            { v: Number(f.rejected),  c: t.red    },
            { v: Number(f.pending),   c: t.orange },
          ].map((seg, i) => (
            <div key={i} style={{ flex: seg.v, background: seg.c, transition:'flex .5s' }} />
          ))}
        </div>
      </div>

      {/* WALK-IN FUNNEL + PENDING AGING side by side */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'24px' }}>

        {/* Walk-in funnel */}
        <div style={card}>
          <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'16px' }}>Walk-in Funnel (All Time)</div>
          {[
            { label:'Total Walk-ins',   value: wf.total_walkin, color: t.text2 },
            { label:'Sold / Converted', value: wf.sold,         color: t.green },
            { label:'Visited Not Sold', value: wf.visited_not_sold, color: t.red   },
            { label:'Enquiry',          value: wf.enquiry,      color: t.blue   },
            { label:'Planning to Visit',value: wf.planning,     color: t.orange },
            { label:'Call Later',       value: wf.call_later,   color: t.purple },
          ].map((row, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom: i < 5 ? `1px solid ${t.border}20` : 'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <div style={{ width:'6px', height:'6px', borderRadius:'50%', background: row.color }} />
                <span style={{ fontSize:'.72rem', color: t.text2 }}>{row.label}</span>
              </div>
              <span style={{ fontSize:'.78rem', color: row.color, fontWeight: i===0?300:400 }}>{fmtNum(row.value)}</span>
            </div>
          ))}
          <div style={{ marginTop:'12px', fontSize:'.68rem', color: t.gold, textAlign:'right' }}>
            Conversion rate: {walkinConv}%
          </div>
        </div>

        {/* Pending aging */}
        <div style={card}>
          <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'16px' }}>Pending Bill Aging</div>
          {BUCKET_ORDER.map(bucket => {
            const b = agingMap[bucket]
            if (!b) return null
            const color = bucket === 'Today' ? t.green : bucket === '1–7 days' ? t.gold : bucket === '8–30 days' ? t.orange : t.red
            return (
              <div key={bucket} style={{ marginBottom:'12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ fontSize:'.72rem', color: t.text2 }}>{bucket}</span>
                  <span style={{ fontSize:'.72rem', color }}>
                    {fmtNum(b.count)} bills · {fmtVal(b.total_value)}
                  </span>
                </div>
                <div style={{ height:'4px', background:`${t.border}40`, borderRadius:'2px' }}>
                  <div style={{ width:`${Math.min(100,(Number(b.count)/Number(funnel?.pending||1)*100))}%`, height:'100%', background:color, borderRadius:'2px' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* HIGH REJECTION BRANCHES */}
      {highRejBranches?.length > 0 && (
        <div style={card}>
          <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'14px' }}>
            Branches with High Rejection Rate (&gt;20%)
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>{['Branch','Total','Rejected','Rejection Rate'].map(h =>
                <th key={h} style={{ padding:'6px 12px', fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', textAlign:'left', borderBottom:`1px solid ${t.border}`, fontWeight:400 }}>{h}</th>
              )}</tr>
            </thead>
            <tbody>
              {highRejBranches.map((b, i) => (
                <tr key={i}>
                  <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.text1 }}>{b.branch_name || b.branch_id}</td>
                  <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.text3 }}>{fmtNum(b.total)}</td>
                  <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.red }}>{fmtNum(b.rejected)}</td>
                  <td style={{ padding:'8px 12px', fontSize:'.72rem', fontWeight:500 }}>
                    <span style={{ color: Number(b.rejection_rate)>40 ? t.red : t.orange }}>{b.rejection_rate}%</span>
                    <MiniBar value={b.rejection_rate} max={100} color={Number(b.rejection_rate)>40?t.red:t.orange} height={3} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: BRANCH MATRIX
// ─────────────────────────────────────────────────────────────────────────────
function BranchMatrixTab({ t }) {
  const [branches, setBranches] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('days_since_purchase')
  const [sortDir, setSortDir]   = useState(1)   // 1=asc, -1=desc
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => {
    fetch('/api/purchase-intelligence?action=branch-matrix')
      .then(r => r.json())
      .then(d => { setBranches(d.branches || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(1) }
  }

  const filtered = branches
    .filter(b => {
      if (search && !b.branch_name?.toLowerCase().includes(search.toLowerCase())) return false
      if (filterStatus) {
        const st = branchStatus(b.days_since_purchase)
        if (st.label !== filterStatus) return false
      }
      return true
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? 9999
      const bv = b[sortKey] ?? 9999
      return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir
    })

  const maxMtdVal = Math.max(...filtered.map(b => Number(b.mtd_value) || 0), 1)
  const maxTotal  = Math.max(...filtered.map(b => Number(b.total_approved) || 0), 1)

  const SortTh = ({ label, k }) => (
    <th onClick={() => handleSort(k)} style={{ padding:'8px 12px', fontSize:'.55rem', color: sortKey===k?t.gold:t.text3, letterSpacing:'.1em', textTransform:'uppercase', textAlign:'left', borderBottom:`1px solid ${t.border}`, fontWeight:400, cursor:'pointer', whiteSpace:'nowrap' }}>
      {label} {sortKey===k ? (sortDir===1?'↑':'↓') : ''}
    </th>
  )

  const inp = { background:t.card, border:`1px solid ${t.border}`, borderRadius:'6px', padding:'7px 12px', color:t.text1, fontSize:'.72rem', outline:'none' }

  return (
    <div>
      {/* SUMMARY BADGES */}
      <div style={{ display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap' }}>
        {[['All', '', t.text3], ['Active', 'Active', t.green], ['Recent', 'Recent', t.gold], ['Dormant', 'Dormant', t.orange], ['Inactive', 'Inactive', t.red]].map(([label, val, color]) => {
          const count = val === '' ? branches.length : branches.filter(b => branchStatus(b.days_since_purchase).label === val).length
          return (
            <button key={label} onClick={() => setFilterStatus(val)}
              style={{ padding:'5px 14px', borderRadius:'100px', cursor:'pointer', border:`1px solid ${filterStatus===val?color:t.border}`, background: filterStatus===val?`${color}18`:'transparent', color: filterStatus===val?color:t.text3, fontSize:'.65rem', transition:'all .15s' }}>
              {label} <span style={{ opacity:.7 }}>({count})</span>
            </button>
          )
        })}
        <input style={{ ...inp, width:'200px', marginLeft:'auto' }} placeholder="Search branch..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? <div style={{ display:'flex', justifyContent:'center', padding:'64px' }}><GoldSpinner size={32}/></div> : (
        <div style={{ overflowX:'auto', borderRadius:'12px', border:`1px solid ${t.border}` }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'900px' }}>
            <thead>
              <tr style={{ background: t.card }}>
                <th style={{ padding:'8px 12px', fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', textAlign:'left', borderBottom:`1px solid ${t.border}`, fontWeight:400, whiteSpace:'nowrap' }}>Status</th>
                <SortTh label="Branch"         k="branch_name" />
                <SortTh label="Last Purchase"  k="days_since_purchase" />
                <SortTh label="MTD Bills"      k="mtd_count" />
                <SortTh label="MTD Value"      k="mtd_value" />
                <SortTh label="LM Bills"       k="lm_count" />
                <SortTh label="Growth"         k="growth_pct" />
                <SortTh label="Total Approved" k="total_approved" />
                <SortTh label="Rej. Rate"      k="rejection_rate" />
                <SortTh label="Pending"        k="total_pending" />
                <SortTh label="Pipeline"       k="pipeline_count" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => {
                const st  = branchStatus(b.days_since_purchase)
                const rej = Number(b.rejection_rate) || 0
                const grow = b.growth_pct
                return (
                  <tr key={b.branch_id || i}
                    style={{ background:'transparent', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = t.card2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${t.border}15` }}>
                      <span style={{ fontSize:'.6rem', background:st.bg, color:st.color, padding:'2px 8px', borderRadius:'100px', letterSpacing:'.06em' }}>{st.label}</span>
                    </td>
                    <td style={{ padding:'9px 12px', fontSize:'.72rem', color:t.text1, fontWeight:500, borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>{b.branch_name || b.branch_id}</td>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>
                      <div style={{ fontSize:'.72rem', color: agingColor(b.days_since_purchase, t) }}>
                        {b.days_since_purchase === 9999 ? '—' : b.days_since_purchase === 0 ? 'Today' : `${b.days_since_purchase}d ago`}
                      </div>
                      <div style={{ fontSize:'.6rem', color:t.text4 }}>{fmtDate(b.last_approved_date)}</div>
                    </td>
                    <td style={{ padding:'9px 12px', fontSize:'.75rem', color:t.gold, fontWeight:500, borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>{fmtNum(b.mtd_count)}</td>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${t.border}15` }}>
                      <div style={{ fontSize:'.72rem', color:t.green }}>{fmtVal(b.mtd_value)}</div>
                      <MiniBar value={b.mtd_value} max={maxMtdVal} color={t.green} />
                    </td>
                    <td style={{ padding:'9px 12px', fontSize:'.72rem', color:t.text3, borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>{fmtNum(b.lm_count)}</td>
                    <td style={{ padding:'9px 12px', fontSize:'.72rem', borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>
                      {grow === null ? <span style={{ color:t.text4 }}>—</span> :
                        <span style={{ color: grow >= 0 ? t.green : t.red }}>{grow >= 0 ? '+' : ''}{grow}%</span>}
                    </td>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${t.border}15` }}>
                      <div style={{ fontSize:'.72rem', color:t.text2, textAlign:'right' }}>{fmtNum(b.total_approved)}</div>
                      <MiniBar value={b.total_approved} max={maxTotal} color={t.blue} />
                    </td>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${t.border}15` }}>
                      <span style={{ fontSize:'.72rem', color: rej>30?t.red:rej>15?t.orange:t.green }}>{rej}%</span>
                    </td>
                    <td style={{ padding:'9px 12px', fontSize:'.72rem', color: Number(b.total_pending)>0?t.orange:t.text4, borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>
                      {Number(b.total_pending) > 0 ? fmtNum(b.total_pending) : '—'}
                    </td>
                    <td style={{ padding:'9px 12px', fontSize:'.72rem', color: Number(b.pipeline_count)>0?t.blue:t.text4, borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>
                      {Number(b.pipeline_count) > 0 ? fmtNum(b.pipeline_count) : '—'}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} style={{ padding:'48px', textAlign:'center', color:t.text4, fontSize:'.75rem' }}>No branches match filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop:'10px', fontSize:'.62rem', color:t.text4 }}>
        {filtered.length} of {branches.length} branches shown · Click column headers to sort
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: REPEAT CUSTOMERS
// ─────────────────────────────────────────────────────────────────────────────
function RepeatCustomersTab({ t }) {
  const [data, setData]       = useState({ rows:[], total:0, stats:null })
  const [loading, setLoading] = useState(true)
  const [minVisits, setMinVisits] = useState(2)
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(0)
  const PAGE_SIZE = 100

  const load = useCallback(async (p = 0) => {
    setLoading(true)
    const params = new URLSearchParams({ action:'repeat-customers', minVisits:String(minVisits), page:String(p), pageSize:String(PAGE_SIZE) })
    if (search) params.set('search', search)
    try {
      const d = await fetch(`/api/purchase-intelligence?${params}`).then(r => r.json())
      setData({ rows: d.rows||[], total: d.total||0, stats: d.stats||null })
    } catch(e) { console.error(e) } finally { setLoading(false) }
  }, [minVisits, search])

  useEffect(() => { load(0); setPage(0) }, [load])

  const { rows, total, stats } = data
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const inp = { background:t.card, border:`1px solid ${t.border}`, borderRadius:'6px', padding:'7px 12px', color:t.text1, fontSize:'.72rem', outline:'none' }

  return (
    <div>
      {/* STAT CARDS */}
      {stats && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'24px' }}>
          <StatCard label="Unique Customers"    value={fmtNum(stats.unique_customers)}  color={t.text1} t={t} />
          <StatCard label="Repeat Customers"    value={fmtNum(stats.repeat_customers)}  color={t.gold}  sub="Visited 2+ times" t={t} />
          <StatCard label="Loyal (5+ visits)"   value={fmtNum(stats.loyal_5plus)}       color={t.green} t={t} />
          <StatCard label="Loyal (10+ visits)"  value={fmtNum(stats.loyal_10plus)}      color={t.blue}  t={t} />
          <StatCard label="Multi-Branch"        value={fmtNum(stats.multi_branch)}      color={t.purple} sub="Visited 2+ branches" t={t} />
        </div>
      )}

      {/* FILTERS */}
      <div style={{ display:'flex', gap:'10px', marginBottom:'16px', alignItems:'center', flexWrap:'wrap' }}>
        <input style={{ ...inp, width:'220px' }} placeholder="Search name or phone..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'.7rem', color:t.text4 }}>Min visits:</span>
          {[2,3,5,10,15].map(v => (
            <button key={v} onClick={() => { setMinVisits(v); setPage(0) }}
              style={{ padding:'4px 12px', borderRadius:'100px', cursor:'pointer', border:`1px solid ${minVisits===v?t.gold:t.border}`, background: minVisits===v?`${t.gold}18`:'transparent', color: minVisits===v?t.gold:t.text3, fontSize:'.65rem', transition:'all .15s' }}>
              {v}+
            </button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', fontSize:'.7rem', color:t.text3 }}>
          {fmtNum(total)} customers with {minVisits}+ visits
        </div>
      </div>

      {/* PAGINATION */}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px', marginBottom:'10px', fontSize:'.7rem', color:t.text3, alignItems:'center' }}>
        <button onClick={() => { const p=Math.max(0,page-1); setPage(p); load(p) }} disabled={page===0}
          style={{ background:'none', border:`1px solid ${t.border}`, borderRadius:'5px', padding:'3px 10px', color:page===0?t.text4:t.text2, cursor:page===0?'not-allowed':'pointer' }}>←</button>
        <span>Page {page+1} of {totalPages||1}</span>
        <button onClick={() => { const p=Math.min(totalPages-1,page+1); setPage(p); load(p) }} disabled={page>=totalPages-1}
          style={{ background:'none', border:`1px solid ${t.border}`, borderRadius:'5px', padding:'3px 10px', color:page>=totalPages-1?t.text4:t.text2, cursor:page>=totalPages-1?'not-allowed':'pointer' }}>→</button>
      </div>

      {loading ? <div style={{ display:'flex', justifyContent:'center', padding:'64px' }}><GoldSpinner size={32}/></div> : (
        <div style={{ overflowX:'auto', borderRadius:'12px', border:`1px solid ${t.border}` }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'800px' }}>
            <thead>
              <tr style={{ background:t.card }}>
                {['Customer','Phone','Total Visits','Approved','Rejected','Total Value','Branches','First Visit','Last Visit','Days Since'].map(h =>
                  <th key={h} style={{ padding:'8px 12px', fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', textAlign:'left', borderBottom:`1px solid ${t.border}`, fontWeight:400, whiteSpace:'nowrap' }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.cust_mobile || i}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding:'9px 12px', fontSize:'.75rem', color:t.text1, fontWeight:500, borderBottom:`1px solid ${t.border}15` }}>{r.cust_name || '—'}</td>
                  <td style={{ padding:'9px 12px', fontSize:'.72rem', color:t.text3, borderBottom:`1px solid ${t.border}15` }}>{r.cust_mobile}</td>
                  <td style={{ padding:'9px 12px', textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>
                    <span style={{ fontSize:'.8rem', fontWeight:600, color: Number(r.total_visits)>=10?t.purple:Number(r.total_visits)>=5?t.gold:t.text1 }}>
                      {fmtNum(r.total_visits)}
                    </span>
                  </td>
                  <td style={{ padding:'9px 12px', fontSize:'.72rem', color:t.green, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>{fmtNum(r.approved_visits)}</td>
                  <td style={{ padding:'9px 12px', fontSize:'.72rem', color: Number(r.rejected_visits)>0?t.red:t.text4, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>
                    {Number(r.rejected_visits)>0 ? fmtNum(r.rejected_visits) : '—'}
                  </td>
                  <td style={{ padding:'9px 12px', fontSize:'.72rem', color:t.gold, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>{fmtVal(r.total_value)}</td>
                  <td style={{ padding:'9px 12px', textAlign:'center', borderBottom:`1px solid ${t.border}15` }}>
                    {Number(r.branches_visited)>1
                      ? <span style={{ fontSize:'.65rem', background:`${t.purple}18`, color:t.purple, padding:'2px 8px', borderRadius:'100px' }}>{r.branches_visited} branches</span>
                      : <span style={{ fontSize:'.65rem', color:t.text4 }}>1 branch</span>}
                  </td>
                  <td style={{ padding:'9px 12px', fontSize:'.68rem', color:t.text3, borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>{fmtDate(r.first_visit)}</td>
                  <td style={{ padding:'9px 12px', fontSize:'.68rem', color:t.text2, borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>{fmtDate(r.last_visit)}</td>
                  <td style={{ padding:'9px 12px', fontSize:'.68rem', borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>
                    <span style={{ color: agingColor(r.days_since_last, t) }}>
                      {r.days_since_last === 0 ? 'Today' : `${r.days_since_last}d ago`}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length===0 && (
                <tr><td colSpan={10} style={{ padding:'48px', textAlign:'center', color:t.text4, fontSize:'.75rem' }}>No repeat customers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: PENDING AGING
// ─────────────────────────────────────────────────────────────────────────────
function PendingAgingTab({ t }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [minDays, setMinDays] = useState(0)

  useEffect(() => {
    fetch('/api/purchase-intelligence?action=pending-aging')
      .then(r => r.json()).then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'64px' }}><GoldSpinner size={32}/></div>
  if (!data) return null

  const { rows, agingSummary: ag, byBranch } = data
  const filtered = (rows || []).filter(r => {
    if (minDays > 0 && Number(r.days_pending) < minDays) return false
    if (search && !r.cust_name?.toLowerCase().includes(search.toLowerCase()) && !r.bill_no?.includes(search) && !(r.branch_name||'').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const maxBranchDays = Math.max(...(byBranch||[]).map(b => Number(b.oldest_days)||0), 1)
  const inp = { background:t.card, border:`1px solid ${t.border}`, borderRadius:'6px', padding:'7px 12px', color:t.text1, fontSize:'.72rem', outline:'none' }

  return (
    <div>
      {/* SUMMARY */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'24px' }}>
        <StatCard label="Total Pending"    value={fmtNum(ag?.total_pending)} color={t.orange} sub={`₹${Number(ag?.total_value||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`} t={t} />
        <StatCard label="Oldest Bill"      value={`${ag?.oldest_days ?? '—'}d`} color={t.red}    sub="Days in pending state" t={t} alert={Number(ag?.oldest_days)>90} />
        <StatCard label="Avg Age"          value={`${Number(ag?.avg_days||0).toFixed(0)}d`} color={t.orange} t={t} />
        <StatCard label="Older than 30d"   value={fmtNum((Number(ag?.quarter_count||0)) + (Number(ag?.old_count||0)))} color={t.red}    t={t} alert={Number(ag?.quarter_count)+Number(ag?.old_count)>0} />
        <StatCard label="Today / 1–7d"     value={fmtNum(Number(ag?.today_count||0)+Number(ag?.week_count||0))} color={t.gold} t={t} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'16px', marginBottom:'24px' }}>
        {/* Full bill table */}
        <div>
          <div style={{ display:'flex', gap:'10px', marginBottom:'12px', flexWrap:'wrap', alignItems:'center' }}>
            <input style={{ ...inp, width:'220px' }} placeholder="Search customer, bill, branch..." value={search} onChange={e => setSearch(e.target.value)} />
            {[0,30,90,180,365].map(d => (
              <button key={d} onClick={() => setMinDays(d)}
                style={{ padding:'4px 12px', borderRadius:'100px', cursor:'pointer', border:`1px solid ${minDays===d?t.gold:t.border}`, background:minDays===d?`${t.gold}18`:'transparent', color:minDays===d?t.gold:t.text3, fontSize:'.63rem' }}>
                {d === 0 ? 'All' : `${d}d+`}
              </button>
            ))}
            <span style={{ marginLeft:'auto', fontSize:'.68rem', color:t.text3 }}>{filtered.length} bills</span>
          </div>
          <div style={{ overflowX:'auto', borderRadius:'10px', border:`1px solid ${t.border}`, maxHeight:'420px', overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'640px' }}>
              <thead style={{ position:'sticky', top:0 }}>
                <tr style={{ background:t.card }}>
                  {['Age','Bill No','Customer','Branch','Amount','Method','Remark'].map(h =>
                    <th key={h} style={{ padding:'7px 12px', fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', textAlign:'left', borderBottom:`1px solid ${t.border}`, fontWeight:400, whiteSpace:'nowrap' }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const acolor = agingColor(r.days_pending, t)
                  return (
                    <tr key={r.id || i}
                      onMouseEnter={e => e.currentTarget.style.background = t.card2}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding:'8px 12px', borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>
                        <div style={{ fontSize:'.78rem', fontWeight:600, color:acolor }}>{r.days_pending}d</div>
                        <div style={{ fontSize:'.6rem', color:t.text4 }}>{fmtDate(r.date)}</div>
                      </td>
                      <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.gold, borderBottom:`1px solid ${t.border}15` }}>{r.bill_no||'—'}</td>
                      <td style={{ padding:'8px 12px', borderBottom:`1px solid ${t.border}15` }}>
                        <div style={{ fontSize:'.72rem', color:t.text1 }}>{r.cust_name}</div>
                        <div style={{ fontSize:'.62rem', color:t.text4 }}>{r.cust_mobile}</div>
                      </td>
                      <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.text2, borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>{r.branch_name||r.branch_id}</td>
                      <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.text1, borderBottom:`1px solid ${t.border}15`, textAlign:'right' }}>{fmtVal(r.amount)}</td>
                      <td style={{ padding:'8px 12px', fontSize:'.68rem', color:t.text3, borderBottom:`1px solid ${t.border}15` }}>{r.pymt_mde||'—'}</td>
                      <td style={{ padding:'8px 12px', fontSize:'.65rem', color:t.text4, maxWidth:'140px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', borderBottom:`1px solid ${t.border}15` }}>{r.txn_rmrk||'—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* By branch sidebar */}
        <div style={{ background:t.card, border:`1px solid ${t.border}`, borderRadius:'12px', padding:'18px' }}>
          <div style={{ fontSize:'.58rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'14px' }}>Pending by Branch</div>
          {(byBranch||[]).map((b, i) => (
            <div key={i} style={{ marginBottom:'12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
                <span style={{ fontSize:'.7rem', color:t.text2 }}>{b.branch_name||b.branch_id||'(unknown)'}</span>
                <span style={{ fontSize:'.68rem', color: agingColor(b.oldest_days, t) }}>{b.count} · {b.oldest_days}d max</span>
              </div>
              <MiniBar value={b.oldest_days} max={maxBranchDays} color={agingColor(b.oldest_days, t)} height={4} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: PIPELINE INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────────────
function PipelineTab({ t }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/purchase-intelligence?action=pipeline-intel')
      .then(r => r.json()).then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'64px' }}><GoldSpinner size={32}/></div>
  if (!data) return null

  const { funnel: f, pipelineAging: pa, sourceDist, branchConv } = data

  const totalPipeline = Number(f?.visited_not_sold||0)+Number(f?.enquiry||0)+Number(f?.planning||0)+Number(f?.call_later||0)
  const convRate = f?.total > 0 ? ((Number(f.sold)/Number(f.total))*100).toFixed(1) : '0.0'
  const maxBranchConv = Math.max(...(branchConv||[]).map(b => Number(b.total)||0), 1)

  const card = { background:t.card, border:`1px solid ${t.border}`, borderRadius:'12px', padding:'18px 20px' }

  const FunnelStep = ({ label, value, color, isFirst }) => (
    <div style={{ textAlign:'center', flex:1, position:'relative' }}>
      {!isFirst && <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', fontSize:'1rem', color:t.border }}>›</div>}
      <div style={{ fontSize:'1.4rem', fontWeight:200, color }}>{fmtNum(value)}</div>
      <div style={{ fontSize:'.58rem', color:t.text3, letterSpacing:'.08em', textTransform:'uppercase', marginTop:'4px' }}>{label}</div>
      <div style={{ height:'3px', background:`${color}30`, borderRadius:'2px', marginTop:'8px' }}>
        <div style={{ width:`${f?.total>0?Math.round(Number(value)/Number(f.total)*100):0}%`, height:'100%', background:color, borderRadius:'2px' }} />
      </div>
    </div>
  )

  return (
    <div>
      {/* FUNNEL VISUALIZATION */}
      <div style={{ ...card, marginBottom:'20px' }}>
        <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'20px' }}>Walk-in Funnel</div>
        <div style={{ display:'flex', gap:'4px', alignItems:'center', marginBottom:'16px' }}>
          <FunnelStep label="Total Walk-ins"    value={f?.total}          color={t.text1}  isFirst={true} />
          <FunnelStep label="Sold"              value={f?.sold}           color={t.green} />
          <FunnelStep label="Visited Not Sold"  value={f?.visited_not_sold} color={t.red} />
          <FunnelStep label="Enquiry"           value={f?.enquiry}        color={t.blue} />
          <FunnelStep label="Planning"          value={f?.planning}       color={t.orange} />
          <FunnelStep label="Call Later"        value={f?.call_later}     color={t.purple} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.68rem', color:t.text3, borderTop:`1px solid ${t.border}`, paddingTop:'12px' }}>
          <span>Overall conversion: <strong style={{ color:t.gold }}>{convRate}%</strong></span>
          <span>Active pipeline: <strong style={{ color:t.orange }}>{fmtNum(totalPipeline)}</strong></span>
        </div>
      </div>

      {/* PIPELINE AGING + SOURCE */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'20px' }}>
        <div style={card}>
          <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'14px' }}>Pipeline Aging</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'10px', marginBottom:'12px' }}>
            {[
              { label:'Oldest Lead', value:`${pa?.oldest_days||0}d`, color: Number(pa?.oldest_days)>30?t.red:t.orange },
              { label:'Avg Age',     value:`${Number(pa?.avg_days||0).toFixed(0)}d`, color: t.text2 },
              { label:'Fresh (0–3d)',value:fmtNum(pa?.fresh),  color:t.green },
              { label:'Old (30d+)',  value:fmtNum(pa?.old_leads), color:t.red, alert:Number(pa?.old_leads)>0 },
            ].map((s, i) => (
              <div key={i} style={{ background: s.alert?`${t.red}10`:t.card2, borderRadius:'8px', padding:'12px', border:`1px solid ${s.alert?t.red+'30':t.border}` }}>
                <div style={{ fontSize:'.55rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:'6px' }}>{s.label}</div>
                <div style={{ fontSize:'1.1rem', fontWeight:300, color:s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:'.62rem', color:t.text4 }}>Fresh: ≤3d · Recent: 4–14d · Stale: 15–30d · Old: 30d+</div>
        </div>

        <div style={card}>
          <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'14px' }}>Walk-in Source Analysis</div>
          {(sourceDist||[]).map((s, i) => (
            <div key={i} style={{ marginBottom:'10px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
                <span style={{ fontSize:'.7rem', color:t.text2 }}>{s.source}</span>
                <span style={{ fontSize:'.68rem', color:t.text3 }}>{fmtNum(s.total)} · <span style={{ color: Number(s.conv_rate)>=30?t.green:t.orange }}>{s.conv_rate}%</span></span>
              </div>
              <div style={{ height:'4px', background:`${t.border}40`, borderRadius:'2px', display:'flex', gap:'1px' }}>
                <div style={{ flex: Number(s.converted), background:t.green, borderRadius:'2px' }} />
                <div style={{ flex: Number(s.total)-Number(s.converted), background:`${t.border}60`, borderRadius:'2px' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* BRANCH CONVERSION TABLE */}
      <div style={card}>
        <div style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:'14px' }}>Branch Conversion Rates (Top 20 by Volume)</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['#','Branch','Total Walk-ins','Sold','Pipeline','Conv%','Volume Bar'].map(h =>
                  <th key={h} style={{ padding:'7px 12px', fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', textAlign:'left', borderBottom:`1px solid ${t.border}`, fontWeight:400 }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {(branchConv||[]).map((b, i) => {
                const conv = Number(b.conv_rate)
                return (
                  <tr key={i}
                    onMouseEnter={e => e.currentTarget.style.background = t.card2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding:'8px 12px', fontSize:'.68rem', color:t.text4, borderBottom:`1px solid ${t.border}15` }}>{i+1}</td>
                    <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.text1, borderBottom:`1px solid ${t.border}15`, whiteSpace:'nowrap' }}>{b.branch_name||b.branch_id}</td>
                    <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.text2, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>{fmtNum(b.total)}</td>
                    <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.green, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>{fmtNum(b.sold)}</td>
                    <td style={{ padding:'8px 12px', fontSize:'.72rem', color:t.orange, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>{fmtNum(b.pipeline)}</td>
                    <td style={{ padding:'8px 12px', fontWeight:500, textAlign:'right', borderBottom:`1px solid ${t.border}15` }}>
                      <span style={{ fontSize:'.75rem', color: conv>=40?t.green:conv>=20?t.gold:t.orange }}>{conv}%</span>
                    </td>
                    <td style={{ padding:'8px 12px', borderBottom:`1px solid ${t.border}15`, minWidth:'100px' }}>
                      <MiniBar value={b.total} max={maxBranchConv} color={t.blue} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function PurchaseIntelligence() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div style={{ minHeight:'100vh', background:t.bg }}>
      {/* PAGE HEADER */}
      <div style={{ padding:'24px 32px 0', borderBottom:`1px solid ${t.border}`, background:t.card }}>
        <div style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'4px' }}>Purchase · Intelligence</div>
        <div style={{ fontSize:'1.7rem', fontWeight:200, color:t.text1, marginBottom:'16px' }}>Purchase Intelligence</div>

        {/* TAB BAR */}
        <div style={{ display:'flex', gap:'0' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                background:'transparent', border:'none',
                borderBottom: activeTab===tab.id ? `2px solid ${t.gold}` : '2px solid transparent',
                padding:'10px 22px', cursor:'pointer', display:'flex', alignItems:'center', gap:'7px',
                color: activeTab===tab.id ? t.gold : t.text3,
                fontSize:'.72rem', fontWeight: activeTab===tab.id ? 500 : 400,
                letterSpacing:'.03em', transition:'all .15s',
              }}>
              <span style={{ fontSize:'.85rem' }}>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div style={{ padding:'28px 32px' }}>
        {activeTab === 'overview'  && <OverviewTab          t={t} />}
        {activeTab === 'branches'  && <BranchMatrixTab      t={t} />}
        {activeTab === 'customers' && <RepeatCustomersTab   t={t} />}
        {activeTab === 'pending'   && <PendingAgingTab      t={t} />}
        {activeTab === 'pipeline'  && <PipelineTab          t={t} />}
      </div>
    </div>
  )
}
