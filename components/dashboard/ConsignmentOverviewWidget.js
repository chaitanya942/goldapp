'use client'

// ConsignmentOverviewWidget — self-contained rich consignment view rendered
// inside dashboards. Shows two side-by-side columns (Branch In Stock + In
// Transit) grouped by region with per-branch drill-down, sort chips, hero
// net-weight, distribution bar, and clickable region filter chips.
//
// Originally a private component inside DashboardHome.js. Extracted so the
// element-driven DynamicDashboard (which renders for non-super-admin roles)
// can show the same overview for users whose role grants consignment-report
// access. The widget fetches its own data so the host page doesn't need to
// hand it in.

import { useEffect, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'

const REGION_COLORS_DASH = {
  'Andhra Pradesh':    '#5ec1d6',
  'Kerala':            '#3aaa6a',
  'Telangana':         '#c9a84c',
  'Tamil Nadu':        '#e58a3b',
  'Rest of Karnataka': '#9275d5',
  'Bangalore':         '#e05555',
}

const fmtWt = (g) => {
  const n = Number(g || 0)
  if (n >= 1000) return `${(n / 1000).toFixed(2)} kg`
  return `${n.toFixed(0)} g`
}

const fmtAge = (d) => {
  if (!d) return '—'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 0) return 'today'
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d'
  return `${days}d`
}

export default function ConsignmentOverviewWidget({ t, isMobile, setActiveNav }) {
  const [stockRows,   setStockRows]   = useState(null)
  const [transitRows, setTransitRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      authedFetch('/api/consignments?action=branch_overview&status=at_branch&include_bangalore=true').then(r => r.json()).catch(() => ({ data: [] })),
      authedFetch('/api/consignments?action=branch_overview&status=in_consignment&include_bangalore=true').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([a, b]) => {
      if (cancelled) return
      setStockRows(a.data || [])
      setTransitRows(b.data || [])
    })
    return () => { cancelled = true }
  }, [])

  const [filterRegion,    setFilterRegion]    = useState('all')
  const [expandedStock,   setExpandedStock]   = useState(() => new Set())
  const [expandedTransit, setExpandedTransit] = useState(() => new Set())

  if (stockRows == null || transitRows == null) {
    return (
      <div style={{ minHeight: 180, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:24, height:24, borderRadius:'50%', border:`2px solid ${t.border}`, borderTopColor: t.orange, animation:'spin 1s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Both columns now read from the same RPC (branch_stock_summary), one
  // call per stock_status. Each row is per-branch with identical columns,
  // so the section component handles both identically.
  const stockFiltered0   = (stockRows   || []).filter(b => ((b.today_bills || 0) + (b.older_bills || 0)) > 0)
  const transitFiltered0 = (transitRows || []).filter(b => ((b.today_bills || 0) + (b.older_bills || 0)) > 0)

  const allRegions = [...new Set([
    ...stockFiltered0.map(b => b.region).filter(Boolean),
    ...transitFiltered0.map(b => b.region).filter(Boolean),
  ])].sort()

  const stockFiltered   = filterRegion === 'all' ? stockFiltered0   : stockFiltered0.filter(b => b.region === filterRegion)
  const transitFiltered = filterRegion === 'all' ? transitFiltered0 : transitFiltered0.filter(b => b.region === filterRegion)

  const groupByRegion = (rows) => {
    const m = {}
    for (const b of rows) {
      const r = b.region || 'Other'
      if (!m[r]) m[r] = []
      m[r].push(b)
    }
    return m
  }
  const stockByRegion   = groupByRegion(stockFiltered)
  const transitByRegion = groupByRegion(transitFiltered)

  const regionTotals = (byRegionMap) => (region) => {
    const rows = byRegionMap[region] || []
    return {
      branchCount:   rows.length,
      bills:         rows.reduce((s, b) => s + (b.today_bills || 0) + (b.older_bills || 0), 0),
      todayBills:    rows.reduce((s, b) => s + (b.today_bills || 0), 0),
      todayNetWt:    rows.reduce((s, b) => s + Number(b.today_net_wt || 0), 0),
      netWt:         rows.reduce((s, b) => s + Number(b.total_net_wt || 0), 0),
      maxOldestDays: rows.reduce((m, b) => Math.max(m, b.oldest_age_days || 0), 0),
    }
  }
  const stockRegionTotals   = regionTotals(stockByRegion)
  const transitRegionTotals = regionTotals(transitByRegion)

  const toggle = (set, setter) => (r) => setter(prev => {
    const next = new Set(prev)
    if (next.has(r)) next.delete(r); else next.add(r)
    return next
  })
  const toggleStock   = toggle(expandedStock,   setExpandedStock)
  const toggleTransit = toggle(expandedTransit, setExpandedTransit)

  const stockRegions   = Object.keys(stockByRegion).sort()
  const transitRegions = Object.keys(transitByRegion).sort()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Region filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginRight: 4 }}>Region</span>
        <FilterPill active={filterRegion === 'all'} color={t.gold} onClick={() => setFilterRegion('all')} t={t}>All</FilterPill>
        {allRegions.map(r => (
          <FilterPill key={r} active={filterRegion === r} color={REGION_COLORS_DASH[r] || t.gold} onClick={() => setFilterRegion(r)} t={t}>{r}</FilterPill>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <ConsSection
          t={t} title="Branch In Stock" subtitle="awaiting consignment" accent={t.orange}
          regions={stockRegions}
          getTotals={stockRegionTotals}
          getBranches={(r) => stockByRegion[r] || []}
          expanded={expandedStock} onToggle={toggleStock}
          onSegmentClick={(r) => setFilterRegion(filterRegion === r ? 'all' : r)}
          cta={setActiveNav ? { label: 'Open Branch Stock', onClick: () => setActiveNav('consignment-overview') } : null}
        />
        <ConsSection
          t={t} title="In Transit" subtitle="bills currently in flight" accent={t.blue}
          regions={transitRegions}
          getTotals={transitRegionTotals}
          getBranches={(r) => transitByRegion[r] || []}
          expanded={expandedTransit} onToggle={toggleTransit}
          onSegmentClick={(r) => setFilterRegion(filterRegion === r ? 'all' : r)}
          cta={setActiveNav ? { label: 'Open Consignment Report', onClick: () => setActiveNav('consignment-report') } : null}
        />
      </div>

      <style>{`
        @keyframes consWidgetRowIn    { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes consWidgetBranchIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes consWidgetRowBar   { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes consWidgetExpand   { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 600px; } }
        @keyframes consWidgetGrow     { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .cons-widget-region-row:hover {
          background: color-mix(in srgb, var(--region-color) 8%, transparent) !important;
        }
        .cons-widget-region-row:hover > span:first-child {
          box-shadow: 0 0 0 5px color-mix(in srgb, var(--region-color) 35%, transparent) !important;
          transition: box-shadow .2s ease;
        }
        .cons-widget-branch-row:hover { background: rgba(201,168,76,.04); }
        @media (prefers-reduced-motion: reduce) {
          .cons-widget-region-row, .cons-widget-branch-row { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function FilterPill({ active, color, onClick, t, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '5px 11px',
        background: active ? `${color}22` : 'transparent',
        border: `1px solid ${active ? `${color}70` : t.border}`,
        color: active ? color : t.text3,
        borderRadius: '99px',
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all .15s ease',
      }}>
      {children}
    </button>
  )
}

function ConsSection({ t, title, subtitle, accent, regions, getTotals, getBranches, expanded, onToggle, onSegmentClick, cta }) {
  const [sortKey, setSortKey] = useState('weight')

  const sectionTotals = regions.reduce((acc, r) => {
    const tot = getTotals(r)
    acc.bills      += tot.bills
    acc.todayBills += tot.todayBills || 0
    acc.todayNetWt += tot.todayNetWt || 0
    acc.netWt      += tot.netWt
    acc.units      += tot.branchCount || 0
    return acc
  }, { bills: 0, todayBills: 0, todayNetWt: 0, netWt: 0, units: 0 })

  const distribution = regions.map(r => {
    const tot = getTotals(r)
    return { r, tot, share: sectionTotals.netWt > 0 ? tot.netWt / sectionTotals.netWt : 0 }
  }).sort((a, b) => {
    if (sortKey === 'bills')  return b.tot.bills - a.tot.bills
    if (sortKey === 'oldest') return (b.tot.maxOldestDays || 0) - (a.tot.maxOldestDays || 0)
    if (sortKey === 'name')   return a.r.localeCompare(b.r)
    return b.share - a.share
  })

  const SortBtn = ({ k, label }) => {
    const active = sortKey === k
    return (
      <button onClick={() => setSortKey(k)}
        style={{
          padding: '3px 9px',
          borderRadius: 99,
          background: active ? `${accent}22` : 'transparent',
          border: `1px solid ${active ? `${accent}60` : t.border}`,
          color: active ? accent : t.text4,
          fontSize: 9.5, fontWeight: active ? 700 : 500,
          cursor: 'pointer', letterSpacing: '.04em',
          transition: 'all .12s ease',
        }}>
        {label}
      </button>
    )
  }

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: `linear-gradient(165deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
      border: `1px solid ${t.border}`,
      borderTop: `2px solid ${accent}55`,
      borderRadius: 14,
      boxShadow: `0 1px 0 ${accent}08 inset, 0 4px 16px rgba(0,0,0,.12)`,
      transition: 'border-color .2s, box-shadow .25s',
    }}>
      <div aria-hidden style={{
        position: 'absolute', top: -50, right: -60, width: 180, height: 180,
        borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${accent}15 0%, transparent 65%)`,
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        padding: '14px 18px',
        borderBottom: `1px solid ${t.border}`,
        background: `linear-gradient(90deg, ${accent}1a 0%, ${accent}06 35%, transparent 70%)`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 3, height: 22, borderRadius: 2, background: `linear-gradient(180deg, ${accent} 0%, ${accent}40 100%)`, boxShadow: `0 0 10px ${accent}60` }} />
        <span style={{ fontSize: 12.5, color: accent, letterSpacing: '.16em', fontWeight: 700, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.04em' }}>· {subtitle}</span>
      </div>

      {regions.length > 0 && (
        <div style={{
          position: 'relative', zIndex: 1,
          padding: '18px 18px 16px', borderBottom: `1px solid ${t.border}40`,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Total Net Wt</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontSize: 32, fontWeight: 200, color: t.text1,
                  fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.02em',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtWt(sectionTotals.netWt).replace(/\s.+/, '')}
                </span>
                <span style={{ fontSize: 13, color: t.text3, fontWeight: 500 }}>{fmtWt(sectionTotals.netWt).split(' ')[1] || 'g'}</span>
              </div>
              {sectionTotals.todayNetWt > 0 && (
                <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.green }} />
                  <span title={`${sectionTotals.todayBills} bill${sectionTotals.todayBills === 1 ? '' : 's'} totalling ${fmtWt(sectionTotals.todayNetWt)} added today`}
                    style={{ fontSize: 10, color: t.green, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '.02em' }}>
                    +{fmtWt(sectionTotals.todayNetWt)} TODAY
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 18, marginLeft: 'auto', alignItems: 'flex-end' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Branches</div>
                <div style={{ fontSize: 16, color: t.text1, fontWeight: 700, fontFamily: 'monospace', marginTop: 2 }}>{sectionTotals.units}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Bills</div>
                <div style={{ fontSize: 16, color: t.text1, fontWeight: 700, fontFamily: 'monospace', marginTop: 2 }}>{sectionTotals.bills}</div>
              </div>
            </div>
          </div>
          {regions.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginRight: 2 }}>Sort</span>
              <SortBtn k="weight" label="Weight" />
              <SortBtn k="bills"  label="Bills" />
              <SortBtn k="oldest" label="Oldest" />
              <SortBtn k="name"   label="Region" />
            </div>
          )}
          {sectionTotals.netWt > 0 && (
            <div style={{
              display: 'flex', height: 12, borderRadius: 7, overflow: 'hidden',
              background: `${t.border}50`,
              boxShadow: `inset 0 1px 2px rgba(0,0,0,.18)`,
              cursor: onSegmentClick ? 'pointer' : 'default',
            }}>
              {distribution.map(({ r, tot, share }, i) => {
                const color = REGION_COLORS_DASH[r] || t.text3
                const widthPct = share * 100
                if (widthPct < 0.5) return null
                return (
                  <div key={r}
                    onClick={() => onSegmentClick && onSegmentClick(r)}
                    title={`${r}: ${fmtWt(tot.netWt)} (${(share * 100).toFixed(1)}%) — click to filter`}
                    style={{
                      width: `${widthPct}%`,
                      background: `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,.18)`,
                      transition: 'width .6s cubic-bezier(.4,0,.2,1), opacity .15s, transform .15s',
                      animation: `consWidgetGrow .6s cubic-bezier(.4,0,.2,1) ${i * 80}ms backwards`,
                      transformOrigin: 'left',
                    }}
                    onMouseEnter={e => { if (onSegmentClick) e.currentTarget.style.opacity = '.7' }}
                    onMouseLeave={e => { if (onSegmentClick) e.currentTarget.style.opacity = '1' }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      <div>
        {regions.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: t.text4, fontSize: 12 }}>No data</div>
        ) : distribution.map(({ r, tot, share }, idx) => {
          const branches = getBranches(r)
          const color = REGION_COLORS_DASH[r] || t.text3
          const open = expanded.has(r)
          return (
            <div key={r}
              style={{
                borderTop: `1px solid ${t.border}30`,
                animation: `consWidgetRowIn .35s cubic-bezier(.4,0,.2,1) ${idx * 50}ms backwards`,
              }}>
              <button onClick={() => onToggle(r)}
                className="cons-widget-region-row"
                style={{
                  position: 'relative', overflow: 'hidden',
                  width: '100%', textAlign: 'left',
                  background: open ? `linear-gradient(90deg, ${color}18 0%, ${color}06 50%, transparent 100%)` : 'transparent',
                  border: 'none', cursor: 'pointer',
                  padding: '15px 16px 13px 20px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'background .18s, transform .12s',
                  ['--region-color']: color,
                }}>
                <span aria-hidden style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                  background: `linear-gradient(180deg, ${color} 0%, ${color}60 100%)`,
                  boxShadow: `0 0 8px ${color}40`,
                }} />
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: color, flexShrink: 0,
                  boxShadow: `0 0 0 3px ${color}25, 0 0 8px ${color}50`,
                }} />
                <span style={{ fontSize: 13.5, color: t.text1, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.005em' }}>{r}</span>
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 14, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  <span>
                    <strong style={{ color: t.text1, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{tot.branchCount}</strong>
                    <span style={{ color: t.text4, fontSize: 10, marginLeft: 3 }}>br</span>
                  </span>
                  <span>
                    <strong style={{ color: t.text1, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{tot.bills}</strong>
                    <span style={{ color: t.text4, fontSize: 10, marginLeft: 3 }}>bills</span>
                  </span>
                  <span style={{ color: t.gold, fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtWt(tot.netWt)}
                  </span>
                </span>
                {tot.maxOldestDays > 7 && (
                  <span title={`Oldest bill in this region is ${tot.maxOldestDays} days old`}
                    style={{ fontSize: 9.5, color: t.red, background: `${t.red}15`, border: `1px solid ${t.red}45`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {tot.maxOldestDays}d
                  </span>
                )}
                <span style={{ fontSize: 10, color, fontFamily: 'monospace', fontWeight: 700, background: `${color}15`, padding: '2px 8px', borderRadius: 99, border: `1px solid ${color}30`, whiteSpace: 'nowrap' }}>
                  {(share * 100).toFixed(0)}%
                </span>
                <span style={{ fontSize: 10, color: t.text4, transform: open ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .25s', marginLeft: 2 }}>▾</span>
                <span style={{
                  position: 'absolute', bottom: 0, left: 3,
                  height: 3, width: `${share * 100}%`,
                  background: `linear-gradient(90deg, ${color} 0%, ${color}50 100%)`,
                  boxShadow: `0 0 4px ${color}40`,
                  transition: 'width .6s cubic-bezier(.4,0,.2,1)',
                  animation: `consWidgetRowBar .6s cubic-bezier(.4,0,.2,1) ${idx * 60 + 200}ms backwards`,
                  transformOrigin: 'left',
                }} />
              </button>
              {open && (
                <div style={{
                  background: `${color}06`,
                  padding: '4px 0 10px',
                  animation: 'consWidgetExpand .25s cubic-bezier(.4,0,.2,1)',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 80px 50px', gap: 8, padding: '8px 14px 4px', fontSize: 9, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                    <span>Branch</span>
                    <span style={{ textAlign: 'right' }}>Bills</span>
                    <span style={{ textAlign: 'right' }}>Net Wt</span>
                    <span style={{ textAlign: 'right' }}>Oldest</span>
                  </div>
                  {branches.map((b, i) => {
                    const bills  = (b.today_bills || 0) + (b.older_bills || 0)
                    const netWt  = Number(b.total_net_wt || 0)
                    const oldest = b.oldest_date
                    const ageDays = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 86400000) : 0
                    const ageColor = ageDays > 7 ? t.red : ageDays > 3 ? t.orange : t.green
                    return (
                      <div key={i}
                        className="cons-widget-branch-row"
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr 56px 80px 50px',
                          gap: 8, padding: '8px 14px',
                          fontSize: 11.5, color: t.text2,
                          borderTop: `1px solid ${t.border}25`,
                          alignItems: 'center',
                          transition: 'background .12s',
                          animation: `consWidgetBranchIn .28s cubic-bezier(.4,0,.2,1) ${i * 30}ms backwards`,
                        }}>
                        <span style={{ color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.branch_name}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{bills}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtWt(netWt)}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: ageColor, fontWeight: 600 }}>{fmtAge(oldest)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer CTA — drills into the module that owns this slice
          (Branch Stock for at-branch, Consignment Report for in-transit). */}
      {cta && (
        <div style={{ borderTop: `1px solid ${t.border}`, background: `${accent}06`, padding: '10px 14px' }}>
          <button onClick={cta.onClick}
            style={{
              width: '100%', padding: '9px 12px',
              borderRadius: 8,
              background: `${accent}15`,
              border: `1px solid ${accent}40`,
              color: accent,
              fontSize: 11.5, fontWeight: 700,
              letterSpacing: '.04em',
              cursor: 'pointer',
              transition: 'background .15s, transform .12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${accent}25` }}
            onMouseLeave={e => { e.currentTarget.style.background = `${accent}15` }}>
            {cta.label} →
          </button>
        </div>
      )}
    </div>
  )
}
