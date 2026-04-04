'use client'

import { useState, useEffect } from 'react'
import GoldSpinner from '../../ui/GoldSpinner'

export default function ReportCrmInsights({ t }) {
  const [kpis, setKpis]             = useState(null)
  const [rejReasons, setRejReasons] = useState([])
  const [walkReasons, setWalkReasons] = useState([])
  const [branchConv, setBranchConv] = useState([])
  const [loading, setLoading]       = useState(true)
  const [approved, setApproved]     = useState(0)

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const [kpiRes, rejRes, walkRes] = await Promise.all([
          fetch('/api/crm-purchases?action=kpis').then(r => r.json()),
          fetch('/api/crm-purchases?action=rejected&page=0&pageSize=1').then(r => r.json()),
          fetch('/api/crm-purchases?action=walkin&page=0&pageSize=1').then(r => r.json()),
        ])
        if (kpiRes) {
          setKpis(kpiRes)
          // Approximate approved from Supabase (just for rejection rate)
          const appTotal = (Number(kpiRes.rejected || 0) + Number(kpiRes.pending || 0))
          // We don't have approved count here easily, just show ratio of what we have
        }
        if (rejRes.topReasons) setRejReasons(rejRes.topReasons)
        if (walkRes.reasonDist) setWalkReasons(walkRes.reasonDist)
        if (walkRes.branchStats) setBranchConv(walkRes.branchStats)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
      <GoldSpinner size={28} />
    </div>
  )

  if (!kpis) return null

  const rejected   = Number(kpis.rejected   || 0)
  const pending    = Number(kpis.pending    || 0)
  const walkin     = Number(kpis.walkin     || 0)
  const blacklisted = Number(kpis.blacklisted || 0)

  // Rejection rate = rejected / (rejected + pending) as a signal of friction
  const totalTxn   = rejected + pending
  const rejRate    = totalTxn > 0 ? ((rejected / totalTxn) * 100).toFixed(1) : '—'

  // Bar chart helper
  const BarRow = ({ label, value, max, color }) => {
    const pct = max > 0 ? Math.round((Number(value) / Number(max)) * 100) : 0
    return (
      <div style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center' }}>
          <span style={{ fontSize: '.68rem', color: t.text2, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ fontSize: '.68rem', color: t.text3, flexShrink: 0, marginLeft: '8px' }}>{Number(value).toLocaleString('en-IN')}</span>
        </div>
        <div style={{ height: '5px', background: `${t.border}60`, borderRadius: '3px' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color || t.gold, borderRadius: '3px', transition: 'width .5s ease' }} />
        </div>
      </div>
    )
  }

  const card = {
    background: t.card,
    border: `1px solid ${t.border}`,
    borderRadius: '14px',
    padding: '20px 24px',
    boxShadow: '0 1px 3px rgba(0,0,0,.4)',
  }

  // Top 15 branches by walk-in volume
  const topBranchConv = [...branchConv]
    .sort((a, b) => Number(b.pipeline_count) - Number(a.pipeline_count))
    .slice(0, 15)

  const maxBranchPipeline = topBranchConv[0]?.pipeline_count || 1

  return (
    <div>
      <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '6px' }}>Live from CRM</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 300, color: t.text1, marginBottom: '20px' }}>CRM Insights</div>

      {/* KPI ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Rejected Bills',        value: rejected.toLocaleString('en-IN'),    color: t.red,    sub: 'Flagged & not approved' },
          { label: 'Pending Bills',          value: pending.toLocaleString('en-IN'),     color: t.orange, sub: 'Awaiting CRM approval' },
          { label: 'Walk-in Pipeline',       value: walkin.toLocaleString('en-IN'),      color: t.blue,   sub: 'Active leads in CRM' },
          { label: 'Blacklisted Customers',  value: blacklisted.toLocaleString('en-IN'), color: t.red,    sub: 'Flagged customers' },
        ].map(c => (
          <div key={c.label} style={{ ...card, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: '16px', right: '16px', height: '1.5px', background: `linear-gradient(90deg, transparent, ${c.color}70, transparent)` }} />
            <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '12px' }}>{c.label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 200, color: c.color, lineHeight: 1 }}>{c.value}</div>
            <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '8px' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* CHARTS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>

        {/* Rejection Reasons */}
        <div style={card}>
          <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '16px' }}>Top Rejection Reasons</div>
          {rejReasons.length === 0
            ? <div style={{ fontSize: '.72rem', color: t.text4, padding: '24px', textAlign: 'center' }}>No data</div>
            : rejReasons.map((r, i) => (
              <BarRow
                key={i}
                label={r.reason === '(blank)' ? '(no reason given)' : r.reason}
                value={r.count}
                max={rejReasons[0]?.count || 1}
                color={i === 0 ? t.red : i === 1 ? t.orange : t.gold}
              />
            ))
          }
        </div>

        {/* Walk-in Reasons */}
        <div style={card}>
          <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '16px' }}>Walk-in Drop-off Reasons</div>
          {walkReasons.length === 0
            ? <div style={{ fontSize: '.72rem', color: t.text4, padding: '24px', textAlign: 'center' }}>No data</div>
            : walkReasons.map((r, i) => (
              <BarRow
                key={i}
                label={r.reason === '(not specified)' ? '(reason not entered)' : r.reason}
                value={r.count}
                max={walkReasons[0]?.count || 1}
                color={t.blue}
              />
            ))
          }
        </div>
      </div>

      {/* Branch Walk-in Pipeline Table */}
      {topBranchConv.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '16px' }}>
            Branch Walk-in Conversion (Top {topBranchConv.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Branch', 'Total Walk-ins', 'Pipeline', 'Converted', 'Conv%', 'Pipeline Bar'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: '.55rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topBranchConv.map((b, i) => {
                  const conv = b.total_walkin > 0 ? ((Number(b.sold_count) / Number(b.total_walkin)) * 100).toFixed(1) : '0.0'
                  const barPct = maxBranchPipeline > 0 ? Math.round((Number(b.pipeline_count) / Number(maxBranchPipeline)) * 100) : 0
                  return (
                    <tr key={b.branch_id || i}
                      onMouseEnter={e => e.currentTarget.style.background = `${t.card}`}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '9px 12px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20` }}>{b.branch_name || b.branch_id}</td>
                      <td style={{ padding: '9px 12px', fontSize: '.72rem', color: t.text2, borderBottom: `1px solid ${t.border}20`, textAlign: 'right' }}>{Number(b.total_walkin).toLocaleString('en-IN')}</td>
                      <td style={{ padding: '9px 12px', fontSize: '.72rem', color: t.orange, borderBottom: `1px solid ${t.border}20`, textAlign: 'right' }}>{Number(b.pipeline_count).toLocaleString('en-IN')}</td>
                      <td style={{ padding: '9px 12px', fontSize: '.72rem', color: t.green, borderBottom: `1px solid ${t.border}20`, textAlign: 'right' }}>{Number(b.sold_count).toLocaleString('en-IN')}</td>
                      <td style={{ padding: '9px 12px', fontSize: '.72rem', color: Number(conv) >= 30 ? t.green : t.orange, borderBottom: `1px solid ${t.border}20`, textAlign: 'right', fontWeight: 500 }}>{conv}%</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${t.border}20`, minWidth: '120px' }}>
                        <div style={{ height: '5px', background: `${t.border}40`, borderRadius: '3px' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: t.blue, borderRadius: '3px' }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
