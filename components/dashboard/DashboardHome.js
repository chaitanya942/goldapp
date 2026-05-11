'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp, useRegionAccess } from '../../lib/context'
import LiveTicker from '../ui/LiveTicker'
import { getVisibleModules } from '../../lib/modules'
import { authedFetch } from '../../lib/authedFetch'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istNow, istStr, fromUtcDate } from '../../lib/dateIst'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = (iso) => { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}-${MONTHS[+m-1]}-${y}` }
const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtCr   = (n) => { if (n == null) return '—'; const cr = Number(n)/1e7; return cr >= 1 ? `₹${cr.toFixed(2)} Cr` : `₹${Number(n).toLocaleString('en-IN',{maximumFractionDigits:0})}` }
const fmtPct  = (n) => n != null ? `${Number(n).toFixed(2)}%` : '—'

// istNow() is pre-shifted by +5.5h, so use getUTCHours() to read the IST-aligned hour.
// Using getHours() applies the local timezone offset on top — wrong on devices already in IST.
function getGreeting() { const h = istNow().getUTCHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

function getRange(key) {
  const now = istNow(), y = now.getFullYear(), m = now.getMonth(), today = istStr(now)
  if (key === 'today')     return { from: today, to: today, label: 'Today' }
  if (key === 'yesterday') { const d = istStr(new Date(now - 86400000)); return { from: d, to: d, label: 'Yesterday' } }
  if (key === 'week')      { const off = now.getDay()===0?6:now.getDay()-1; return { from: istStr(new Date(now - off*86400000)), to: today, label: 'This Week' } }
  if (key === 'mtd')       return { from: `${y}-${String(m+1).padStart(2,'0')}-01`, to: today, label: 'Month to Date' }
  if (key === 'prev')      { const pm=m===0?11:m-1, pY=m===0?y-1:y, last=new Date(pY,pm+1,0).getDate(); return { from:`${pY}-${String(pm+1).padStart(2,'0')}-01`, to:`${pY}-${String(pm+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`, label:'Previous Month' } }
  if (key === 'ytd')       { const fy=m>=3?`${y}-04-01`:`${y-1}-04-01`; return { from:fy, to:today, label:'Year to Date (FY)' } }
  return { from: null, to: null, label: 'All Time' }
}

// Read-only consignment balance view for the dashboard.
// Shows the management team how much gold is "still at branches" vs "currently
// moving" between branches / hub / HO. No buttons, no actions — this is the
// ── Consignment overview for the dashboard ───────────────────────────────────
// Two side-by-side columns: "Branch In Stock" and "In Transit". Each shows
// region cards with rolled-up totals; click a card to expand into per-branch
// rows (Bills · Net Wt · Oldest). Region filter chips on top.
// Mobile: columns stack vertically.

const REGION_COLORS_DASH = {
  'Andhra Pradesh':    '#5ec1d6',
  'Kerala':            '#3aaa6a',
  'Telangana':         '#c9a84c',
  'Tamil Nadu':        '#e58a3b',
  'Rest of Karnataka': '#9275d5',
  'Bangalore':         '#e05555',
}

const fmtWtDash = (g) => {
  const n = Number(g || 0)
  if (n >= 1000) return `${(n / 1000).toFixed(2)} kg`
  return `${n.toFixed(0)} g`
}

const fmtAgeDash = (d) => {
  if (!d) return '—'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 0) return 'today'
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d'
  return `${days}d`
}

function ConsignmentBalanceView({ t, stats, isMobile }) {
  const [filterRegion,    setFilterRegion]    = useState('all')
  const [expandedStock,   setExpandedStock]   = useState(() => new Set())
  const [expandedTransit, setExpandedTransit] = useState(() => new Set())

  if (!stats || !stats.branchOverviewRaw) {
    return (
      <div style={{ minHeight: 180, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:24, height:24, borderRadius:'50%', border:`2px solid ${t.border}`, borderTopColor: t.orange, animation:'spin 1s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Both columns now read from the same RPC (branch_stock_summary), one
  // call per stock_status. Each row is already per-branch and carries
  // total_bills / total_net_wt / oldest_date / region in the same shape,
  // so the column-rendering code is identical for both.
  const stockRows   = (stats.branchOverviewRaw    || []).filter(b => ((b.today_bills || 0) + (b.older_bills || 0)) > 0)
  const transitRows = (stats.inTransitOverviewRaw || []).filter(b => ((b.today_bills || 0) + (b.older_bills || 0)) > 0)

  const allRegions = [...new Set([
    ...stockRows.map(b => b.region).filter(Boolean),
    ...transitRows.map(b => b.region).filter(Boolean),
  ])].sort()

  const stockFiltered   = filterRegion === 'all' ? stockRows   : stockRows.filter(b => b.region === filterRegion)
  const transitFiltered = filterRegion === 'all' ? transitRows : transitRows.filter(b => b.region === filterRegion)

  // Group both by region; rows are already per-branch.
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

  // Per-region totals — identical shape for both columns since both sources
  // are now per-branch with the same fields. Includes today's count and the
  // max age across branches in the region (for the urgency badge).
  const regionTotals = (byRegionMap) => (region) => {
    const rows = byRegionMap[region] || []
    return {
      branchCount:   rows.length,
      bills:         rows.reduce((s, b) => s + (b.today_bills || 0) + (b.older_bills || 0), 0),
      todayBills:    rows.reduce((s, b) => s + (b.today_bills || 0), 0),
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
        <DashFilterPill active={filterRegion === 'all'} color={t.gold} onClick={() => setFilterRegion('all')} t={t}>All</DashFilterPill>
        {allRegions.map(r => (
          <DashFilterPill key={r} active={filterRegion === r} color={REGION_COLORS_DASH[r] || t.gold} onClick={() => setFilterRegion(r)} t={t}>{r}</DashFilterPill>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <DashConsSection
          t={t} title="Branch In Stock" subtitle="awaiting consignment" accent={t.orange}
          regions={stockRegions}
          getTotals={stockRegionTotals}
          getBranches={(r) => stockByRegion[r] || []}
          getBranchView={(b) => ({
            name:   b.branch_name,
            bills:  (b.today_bills || 0) + (b.older_bills || 0),
            netWt:  Number(b.total_net_wt || 0),
            oldest: b.oldest_date,
          })}
          expanded={expandedStock} onToggle={toggleStock}
          countLabel="br"
          onSegmentClick={(r) => setFilterRegion(filterRegion === r ? 'all' : r)}
        />
        <DashConsSection
          t={t} title="In Transit" subtitle="bills currently in flight" accent={t.blue}
          regions={transitRegions}
          getTotals={transitRegionTotals}
          getBranches={(r) => transitByRegion[r] || []}
          getBranchView={(b) => ({
            name:   b.branch_name,
            bills:  (b.today_bills || 0) + (b.older_bills || 0),
            netWt:  Number(b.total_net_wt || 0),
            oldest: b.oldest_date,
          })}
          expanded={expandedTransit} onToggle={toggleTransit}
          countLabel="br"
          onSegmentClick={(r) => setFilterRegion(filterRegion === r ? 'all' : r)}
        />
      </div>

      {/* Global animations + interactive states for the consignment overview. */}
      <style>{`
        @keyframes dashRowIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dashBranchIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dashRowBar {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        @keyframes dashExpand {
          from { opacity: 0; max-height: 0; }
          to   { opacity: 1; max-height: 600px; }
        }
        .dash-region-row:hover {
          background: color-mix(in srgb, var(--region-color) 8%, transparent) !important;
        }
        .dash-region-row:hover > span:first-child {
          box-shadow: 0 0 0 5px color-mix(in srgb, var(--region-color) 35%, transparent) !important;
          transition: box-shadow .2s ease;
        }
        .dash-branch-row:hover {
          background: rgba(201,168,76,.04);
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-region-row, .dash-branch-row, [class*="logi-"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function DashConsSection({ t, title, subtitle, accent, regions, getTotals, getBranches, getBranchView, expanded, onToggle, countLabel, onSegmentClick }) {
  // Per-section sort. 'weight' = net wt desc (default). Others sort accordingly.
  const [sortKey, setSortKey] = useState('weight')

  // Section roll-up — used for the top summary + share-of-total bars below.
  const sectionTotals = regions.reduce((acc, r) => {
    const tot = getTotals(r)
    acc.bills      += tot.bills
    acc.todayBills += tot.todayBills || 0
    acc.netWt      += tot.netWt
    acc.units      += tot.branchCount != null ? tot.branchCount : tot.consignmentCount
    return acc
  }, { bills: 0, todayBills: 0, netWt: 0, units: 0 })

  // Region share data — sorted per the user's choice. Share % is always
  // computed from net weight so the visual distribution bar still aligns
  // with the section's primary metric.
  const distribution = regions.map(r => {
    const tot = getTotals(r)
    return { r, tot, share: sectionTotals.netWt > 0 ? tot.netWt / sectionTotals.netWt : 0 }
  }).sort((a, b) => {
    if (sortKey === 'bills')  return b.tot.bills - a.tot.bills
    if (sortKey === 'oldest') return (b.tot.maxOldestDays || 0) - (a.tot.maxOldestDays || 0)
    if (sortKey === 'name')   return a.r.localeCompare(b.r)
    return b.share - a.share  // default: weight
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
      background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 14, overflow: 'hidden',
      transition: 'border-color .2s',
    }}>
      {/* Header — title + subtitle */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${t.border}`,
        background: `linear-gradient(90deg, ${accent}14 0%, transparent 60%)`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: accent, boxShadow: `0 0 6px ${accent}55` }} />
        <span style={{ fontSize: 12, color: accent, letterSpacing: '.14em', fontWeight: 700, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 10, color: t.text4 }}>· {subtitle}</span>
      </div>

      {/* Section summary — big numbers + stacked distribution bar */}
      {regions.length > 0 && (
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.border}40`,
          background: `linear-gradient(180deg, ${t.card2 || t.card}80 0%, transparent 100%)` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 8.5, color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Total Net Wt</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
                <span className="logi-grow" style={{ fontSize: 22, fontWeight: 700, color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em' }}>{fmtWtDash(sectionTotals.netWt).replace(/\s.+/, '')}</span>
                <span style={{ fontSize: 11, color: t.text3 }}>{fmtWtDash(sectionTotals.netWt).split(' ')[1] || 'g'}</span>
                {sectionTotals.todayBills > 0 && (
                  <span title={`${sectionTotals.todayBills} bills added today across this section`}
                    style={{ marginLeft: 8, fontSize: 10, color: t.green, background: `${t.green}15`, border: `1px solid ${t.green}40`, borderRadius: 99, padding: '2px 8px', fontWeight: 700, fontFamily: 'monospace' }}>
                    +{sectionTotals.todayBills} today
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', fontSize: 10.5, color: t.text3, fontFamily: 'monospace' }}>
              <span><strong style={{ color: t.text2 }}>{sectionTotals.units}</strong> <span style={{ color: t.text4 }}>{countLabel === 'br' ? (sectionTotals.units === 1 ? 'branch' : 'branches') : (sectionTotals.units === 1 ? 'consignment' : 'consignments')}</span></span>
              <span><strong style={{ color: t.text2 }}>{sectionTotals.bills}</strong> <span style={{ color: t.text4 }}>bills</span></span>
            </div>
          </div>
          {/* Sort selector — small chip row that picks which dimension drives
              the region order. Visual layout (share %, bar, distribution) is
              unchanged; only the row ordering shifts. */}
          {regions.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginRight: 2 }}>Sort</span>
              <SortBtn k="weight" label="Weight" />
              <SortBtn k="bills"  label="Bills" />
              <SortBtn k="oldest" label="Oldest" />
              <SortBtn k="name"   label="Region" />
            </div>
          )}
          {/* Stacked distribution bar — clickable segments filter the section
              to that region. Click again on the same region or 'All' to clear. */}
          {sectionTotals.netWt > 0 && (
            <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: `${t.border}50`, cursor: onSegmentClick ? 'pointer' : 'default' }}>
              {distribution.map(({ r, tot, share }, i) => {
                const color = REGION_COLORS_DASH[r] || t.text3
                const widthPct = share * 100
                if (widthPct < 0.5) return null
                return (
                  <div key={r}
                    onClick={() => onSegmentClick && onSegmentClick(r)}
                    title={`${r}: ${fmtWtDash(tot.netWt)} (${(share * 100).toFixed(1)}%) — click to filter`}
                    style={{
                      width: `${widthPct}%`,
                      background: color,
                      transition: 'width .6s cubic-bezier(.4,0,.2,1), opacity .15s, transform .15s',
                      animation: `dashGrow .6s cubic-bezier(.4,0,.2,1) ${i * 80}ms backwards`,
                      transformOrigin: 'left',
                    }}
                    onMouseEnter={e => { if (onSegmentClick) e.currentTarget.style.opacity = '.75' }}
                    onMouseLeave={e => { if (onSegmentClick) e.currentTarget.style.opacity = '1' }}
                  />
                )
              })}
            </div>
          )}
          <style>{`@keyframes dashGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
        </div>
      )}

      <div>
        {regions.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: t.text4, fontSize: 12 }}>No data</div>
        ) : distribution.map(({ r, tot, share }, idx) => {
          const branches = getBranches(r)
          const color = REGION_COLORS_DASH[r] || t.text3
          const open = expanded.has(r)
          const rowCount = tot.branchCount != null ? tot.branchCount : tot.consignmentCount
          return (
            <div key={r}
              style={{
                borderTop: `1px solid ${t.border}30`,
                animation: `dashRowIn .35s cubic-bezier(.4,0,.2,1) ${idx * 50}ms backwards`,
              }}>
              <button onClick={() => onToggle(r)}
                className="dash-region-row"
                style={{
                  position: 'relative', overflow: 'hidden',
                  width: '100%', textAlign: 'left',
                  background: open ? `${color}10` : 'transparent',
                  border: 'none', cursor: 'pointer',
                  padding: '13px 14px 11px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'background .18s, transform .12s',
                  ['--region-color']: color,
                }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: color, flexShrink: 0,
                  boxShadow: `0 0 0 3px ${color}25`,
                }} />
                <span style={{ fontSize: 12.5, color: t.text1, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                <span style={{ fontSize: 10.5, color: t.text3, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  <span style={{ color: t.text4 }}>{rowCount} {countLabel}</span>
                  <span style={{ color: t.border, margin: '0 5px' }}>·</span>
                  <strong style={{ color: t.text2 }}>{tot.bills}</strong>
                  <span style={{ color: t.text4 }}> bills</span>
                  <span style={{ color: t.border, margin: '0 5px' }}>·</span>
                  <strong style={{ color: t.gold }}>{fmtWtDash(tot.netWt)}</strong>
                </span>
                {/* Today's bills badge — green pill, only when > 0 */}
                {tot.todayBills > 0 && (
                  <span title={`${tot.todayBills} bills added today in this region`}
                    style={{ fontSize: 9, color: t.green, background: `${t.green}15`, border: `1px solid ${t.green}40`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    +{tot.todayBills}
                  </span>
                )}
                {/* Urgency badge — red pill when any branch has oldest > 7d */}
                {tot.maxOldestDays > 7 && (
                  <span title={`Oldest bill in this region is ${tot.maxOldestDays} days old`}
                    className="logi-pulse"
                    style={{ fontSize: 9, color: t.red, background: `${t.red}15`, border: `1px solid ${t.red}45`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {tot.maxOldestDays}d
                  </span>
                )}
                {/* Per-row share indicator: small pill showing % of section total */}
                <span style={{ fontSize: 9.5, color, fontFamily: 'monospace', fontWeight: 700, background: `${color}15`, padding: '2px 7px', borderRadius: 99, border: `1px solid ${color}30`, whiteSpace: 'nowrap' }}>
                  {(share * 100).toFixed(0)}%
                </span>
                <span style={{ fontSize: 10, color: t.text4, transform: open ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .25s', marginLeft: 2 }}>▾</span>
                {/* Bottom share bar — fills proportional to region's share of section total */}
                <span style={{
                  position: 'absolute', bottom: 0, left: 0,
                  height: 2, width: `${share * 100}%`,
                  background: `linear-gradient(90deg, ${color} 0%, ${color}60 100%)`,
                  transition: 'width .6s cubic-bezier(.4,0,.2,1)',
                  animation: `dashRowBar .6s cubic-bezier(.4,0,.2,1) ${idx * 60 + 200}ms backwards`,
                  transformOrigin: 'left',
                }} />
              </button>
              {open && (
                <div style={{
                  background: `${color}06`,
                  padding: '4px 0 10px',
                  animation: 'dashExpand .25s cubic-bezier(.4,0,.2,1)',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 80px 50px', gap: 8, padding: '8px 14px 4px', fontSize: 9, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                    <span>Branch</span>
                    <span style={{ textAlign: 'right' }}>Bills</span>
                    <span style={{ textAlign: 'right' }}>Net Wt</span>
                    <span style={{ textAlign: 'right' }}>Oldest</span>
                  </div>
                  {branches.map((b, i) => {
                    const v = getBranchView(b)
                    const ageDays = v.oldest ? Math.floor((Date.now() - new Date(v.oldest).getTime()) / 86400000) : 0
                    const ageColor = ageDays > 7 ? t.red : ageDays > 3 ? t.orange : t.green
                    return (
                      <div key={i}
                        className="dash-branch-row"
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr 56px 80px 50px',
                          gap: 8, padding: '8px 14px',
                          fontSize: 11.5, color: t.text2,
                          borderTop: `1px solid ${t.border}25`,
                          alignItems: 'center',
                          transition: 'background .12s',
                          animation: `dashBranchIn .28s cubic-bezier(.4,0,.2,1) ${i * 30}ms backwards`,
                        }}>
                        <span style={{ color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{v.bills}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtWtDash(v.netWt)}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: ageColor, fontWeight: 600 }}>{fmtAgeDash(v.oldest)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DashFilterPill({ active, color, onClick, t, children }) {
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

function KpiCard({ label, value, sub, color, icon, loading, t, delay=0, compact=false }) {
  const [hov, setHov] = useState(false)
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(()=>setVis(true), delay); return ()=>clearTimeout(id) }, [delay])
  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{
      background: `linear-gradient(145deg,${t.card},${t.card2})`,
      border: `1px solid ${hov?color+'55':t.border}`,
      borderRadius: compact ? 12 : 16, padding: compact ? '12px 14px' : '20px 22px',
      position: 'relative', overflow: 'hidden',
      boxShadow: hov ? `${t.shadow},0 0 0 1px ${color}25` : t.shadow,
      transform: hov ? 'translateY(-2px)' : vis ? 'translateY(0)' : 'translateY(10px)',
      opacity: vis ? 1 : 0, transition: 'all .25s cubic-bezier(.34,1.56,.64,1)',
    }}>
      <div style={{ position:'absolute', top:0, left:16, right:16, height:1, background:`linear-gradient(90deg,transparent,${color}80,transparent)` }}/>
      <div style={{ position:'absolute', top:-30, right:-30, width:100, height:100, borderRadius:'50%', background:`radial-gradient(circle,${color}${hov?'18':'08'} 0%,transparent 70%)`, pointerEvents:'none' }}/>
      <div style={{ position:'absolute', right:12, bottom:8, fontSize:'3rem', opacity:hov?.08:.04, userSelect:'none' }}>{icon}</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: compact ? 8 : 14 }}>
        <div style={{ fontSize: compact ? 10 : 11, color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }}>{label}</div>
        {!compact && <div style={{ width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${color}22,${color}10)`, border:`1px solid ${color}28`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', flexShrink:0 }}>{icon}</div>}
      </div>
      {loading
        ? <div style={{ height: compact ? 24 : 32, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:8, width:'60%', animation:'shimmer 1.5s infinite' }}/>
        : <div style={{ fontSize: compact ? 22 : 28, fontWeight:200, color, letterSpacing:'-.02em', lineHeight:1, fontVariantNumeric:'tabular-nums', animation:'countUp 0.5s ease' }}>{value ?? '—'}</div>
      }
      {sub && !loading && !compact && <div style={{ fontSize:12, color:t.text4, marginTop:9, lineHeight:1.4 }}>{sub}</div>}
    </div>
  )
}

function StatRow({ label, value, sub, color, t, bar, barMax, delay=0 }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(()=>setVis(true), delay); return ()=>clearTimeout(id) }, [delay])
  const pct = bar!=null && barMax>0 ? Math.min(100,(bar/barMax)*100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:`1px solid ${t.border}25`, opacity:vis?1:0, transform:vis?'translateX(0)':'translateX(-8px)', transition:'all .3s ease' }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, color:t.text2, fontWeight:500, lineHeight:1.3 }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:t.text4, marginTop:2, lineHeight:1.3 }}>{sub}</div>}
      </div>
      {bar!=null && barMax>0 && (
        <div style={{ width:56, height:4, background:t.border2, borderRadius:2, overflow:'hidden', flexShrink:0 }}>
          <div style={{ width:vis?`${pct}%`:'0%', height:'100%', background:`linear-gradient(90deg,${color}90,${color})`, borderRadius:2, transition:'width .7s cubic-bezier(.4,0,.2,1)', boxShadow:`0 0 4px ${color}60` }}/>
        </div>
      )}
      <div style={{ fontSize:13, fontWeight:600, color, minWidth:64, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{value}</div>
    </div>
  )
}

const PERIODS = [
  { key:'today', label:'Today' }, { key:'yesterday', label:'Yesterday' },
  { key:'week', label:'This Week' }, { key:'mtd', label:'MTD' },
  { key:'prev', label:'Prev Month' }, { key:'ytd', label:'YTD' },
]

const EmptyPanel = ({ t }) => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'28px 0', gap:10 }}>
    <div style={{ fontSize:'2rem', opacity:.2 }}>📊</div>
    <div style={{ color:t.text4, fontSize:13 }}>No activity this period</div>
  </div>
)

// ── Module summary card ────────────────────────────────────────────────────────
function ModuleCard({ icon, label, color, metrics, cta, onClick, loading, t, delay = 0, compact = false }) {
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const id = setTimeout(() => setVis(true), delay); return () => clearTimeout(id) }, [delay])
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: `linear-gradient(145deg,${t.card},${t.card2})`,
        border: `1px solid ${hov ? color + '60' : t.border}`,
        borderRadius: compact ? 12 : 16, padding: compact ? '14px 14px' : '18px 20px', cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        boxShadow: hov ? `0 4px 20px ${color}20, inset 0 1px 0 rgba(255,255,255,.04)` : '0 2px 8px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.03)',
        transform: hov ? 'translateY(-2px)' : vis ? 'translateY(0)' : 'translateY(12px)',
        opacity: vis ? 1 : 0, transition: 'all .28s cubic-bezier(.34,1.4,.64,1)',
      }}
    >
      <div style={{ position: 'absolute', top: -24, right: -24, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle,${color}${hov ? '18' : '08'} 0%,transparent 70%)`, pointerEvents: 'none', transition: 'all .3s' }} />
      <div style={{ position: 'absolute', top: 0, left: 16, right: 16, height: 1, background: `linear-gradient(90deg,transparent,${color}60,transparent)` }} />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 10 : 14 }}>
        <div style={{ width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: 8, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? '.85rem' : '1rem', flexShrink: 0 }}>{icon}</div>
        <div style={{ fontSize: compact ? 11 : 12, color: t.text3, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, flex: 1, lineHeight: 1.2 }}>{label}</div>
        {!compact && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={hov ? color : t.text4} strokeWidth="2" strokeLinecap="round" style={{ transition: 'stroke .2s', transform: hov ? 'translateX(2px)' : 'none' }}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>}
      </div>
      {/* Metrics */}
      <div style={{ display: 'flex', gap: compact ? 10 : 16, flexWrap: 'wrap' }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ minWidth: compact ? 48 : 64 }}>
            {loading
              ? <div style={{ height: compact ? 18 : 22, width: compact ? 44 : 56, background: `linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize: '200% 100%', borderRadius: 6, animation: 'shimmer 1.5s infinite' }} />
              : <div style={{ fontSize: compact ? 17 : 20, fontWeight: 200, color, letterSpacing: '-.01em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{m.value ?? '—'}</div>
            }
            <div style={{ fontSize: compact ? 10 : 11, color: t.text4, marginTop: 3, lineHeight: 1.3 }}>{m.label}</div>
          </div>
        ))}
      </div>
      {/* CTA */}
      {cta && !compact && (
        <div style={{ marginTop: 14, fontSize: 12, color: hov ? color : t.text4, fontWeight: hov ? 600 : 400, transition: 'all .2s', letterSpacing: '.02em' }}>
          {cta} →
        </div>
      )}
    </div>
  )
}

function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function DashboardHome() {
  const { theme, userProfile, canSee, setActiveNav, openMobileMenuWithModule } = useApp()
  const regionAccess = useRegionAccess()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const showPurchase       = canSee('purchase-data') || canSee('purchase-reports')
  const showKpiCards       = canSee('element.dashboard.kpi_cards')
  const showPeriodSelector = canSee('element.dashboard.period_selector')
  const showStateTable     = canSee('element.dashboard.state_table')
  const showTopBranches    = canSee('element.dashboard.top_branches')
  const showRegionCards    = canSee('element.dashboard.region_cards')
  const visiblePanels      = [showStateTable, showTopBranches].filter(Boolean).length

  const COLOR_PALETTE = [t.gold, t.green, t.blue, t.purple, t.orange, t.red]

  const [period,         setPeriod]         = useState('today')
  const [overviewOpen,   setOverviewOpen]   = useState(false)
  const [consignOpen,    setConsignOpen]    = useState(false)
  const [salesOpen,      setSalesOpen]      = useState(false)
  const [filterType,     setFilterType]     = useState(null)
  const [filterValue,    setFilterValue]    = useState(null)
  const [branchSearch,   setBranchSearch]   = useState('')
  const [branchDropOpen, setBranchDropOpen] = useState(false)
  const branchInputRef = useRef(null)
  const branchDropRef  = useRef(null)
  const [lastSyncAt,   setLastSyncAt]   = useState(null)

  useEffect(() => {
    if (filterType !== 'branch') { setBranchSearch(''); setBranchDropOpen(false) }
  }, [filterType])

  // Fire-and-forget sync on mount + poll MAX(updated_at) for freshness display.
  useEffect(() => {
    authedFetch('/api/sync-purchases?days=2', { method: 'POST' }).catch(() => null)
    const fetchLastSync = async () => {
      const { data } = await supabase
        .from('purchases')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
      if (data?.[0]?.updated_at) setLastSyncAt(data[0].updated_at)
    }
    fetchLastSync()
    const id = setInterval(fetchLastSync, 30 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (branchDropRef.current && !branchDropRef.current.contains(e.target) &&
          branchInputRef.current && !branchInputRef.current.contains(e.target)) {
        setBranchDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const [loading,       setLoading]       = useState(true)
  const [kpis,          setKpis]          = useState(null)
  const [stateData,     setStateData]     = useState([])
  const [topBranches,    setTopBranches]    = useState([])
  const [bottomBranches, setBottomBranches] = useState([])
  const [branchMeta,    setBranchMeta]    = useState([])
  const [regionCounts,  setRegionCounts]  = useState({})
  const [stateCount,    setStateCount]    = useState(0)
  const [heroVis,       setHeroVis]       = useState(false)
  const [lastRefresh,   setLastRefresh]   = useState(null)
  const refreshRef = useRef(null)

  // ── Module hub data ──────────────────────────────────────────────────────────
  const [hubLoading,     setHubLoading]     = useState(true)
  const [todayKpis,      setTodayKpis]      = useState(null)
  const [telesalesStats, setTelesalesStats] = useState(null)
  const [consignStats,   setConsignStats]   = useState(null)
  const [adminStats,     setAdminStats]     = useState(null)

  useEffect(() => { setTimeout(()=>setHeroVis(true), 50) }, [])

  // Fetch all module-card data in parallel, once on mount
  useEffect(() => {
    const todayStr = istStr()
    const ps = []

    if (canSee('purchase-data') || canSee('purchase-reports')) {
      ps.push(
        supabase.rpc('get_purchase_aggregates', { p_from_date: todayStr, p_to_date: todayStr, p_branch: null, p_txn_type: null, p_region_branches: null, p_single_day: true })
          .then(({ data }) => setTodayKpis(data?.kpis || null))
          .catch(() => {})
      )
    }
    if (canSee('inbound-bot')) {
      ps.push(
        supabase.from('telesales_calls').select('outcome,duration_seconds').gte('call_date', todayStr)
          .then(({ data }) => {
            if (!data) return
            const total    = data.length
            const engaged  = data.filter(c => (c.duration_seconds || 0) >= 30).length
            const interest = data.filter(c => c.outcome === 'interested').length
            setTelesalesStats({ total, engaged, interested: interest, engageRate: total > 0 ? Math.round(engaged / total * 100) : 0 })
          }).catch(() => {})
      )
    }
    if (canSee('consignment-overview') || canSee('consignment-data')) {
      ps.push(
        Promise.all([
          // at_branch: outstation full + Bangalore today-only.
          authedFetch('/api/consignments?action=branch_overview&status=at_branch&include_bangalore_today=true').then(r => r.json()).catch(() => ({ data: [] })),
          // in_consignment: outstation only (Bangalore doesn't dispatch via consignment).
          authedFetch('/api/consignments?action=branch_overview&status=in_consignment').then(r => r.json()).catch(() => ({ data: [] })),
          // Still pulled for the legacy roll-up fields (movementBills, etc).
          // The new region-grouped overview reads from in-transit rows above.
          authedFetch('/api/consignments?action=consignments').then(r => r.json()).catch(() => ({ data: [] })),
        ]).then(([overview, transit, consignList]) => {
          const rows        = overview.data || []
          const transitRows = transit.data  || []  // per-branch in-transit roll-up

          // ── At-branch totals (gold sitting in branches, not yet in motion) ──
          // RPC returns total_gross_value, not total_amount — using that for the
          // value rollup; using total_amount silently produced ₹0 across the UI.
          const branchBills    = rows.reduce((s, b) => s + (b.older_bills || 0) + (b.today_bills || 0), 0)
          const branchWeight   = rows.reduce((s, b) => s + Number(b.total_gross_wt    || 0), 0)
          const branchValue    = rows.reduce((s, b) => s + Number(b.total_gross_value || 0), 0)
          const branchesActive = rows.filter(r => (r.older_bills || 0) + (r.today_bills || 0) > 0).length
          const urgent         = rows.filter(b => (b.oldest_age_days || 0) > 7).length

          // ── State-wise breakdown (rolls each branch's total under its state) ─
          // Used for the state-split chart in the dashboard widget. Branches with
          // no state metadata fall under 'Other'. Sorted by weight descending.
          const stateMap = new Map()
          for (const b of rows) {
            const totalBills = (b.older_bills || 0) + (b.today_bills || 0)
            if (totalBills === 0) continue
            const stateKey = b.state || b.region || 'Other'
            const cur = stateMap.get(stateKey) || { state: stateKey, weight: 0, value: 0, bills: 0, branches: 0 }
            cur.weight   += Number(b.total_gross_wt    || 0)
            cur.value    += Number(b.total_gross_value || 0)
            cur.bills    += totalBills
            cur.branches += 1
            stateMap.set(stateKey, cur)
          }
          const byState = [...stateMap.values()].sort((a, b) => b.weight - a.weight)

          // ── Top branches by weight (drill candidates for management).
          //    Pull the top 6, also surface oldest-pending date for the age tag.
          const topBranches = rows
            .filter(b => Number(b.total_gross_wt || 0) > 0)
            .map(b => ({
              branch:      b.branch_name,
              region:      b.region || null,
              state:       b.state  || null,
              weight:      Number(b.total_gross_wt    || 0),
              value:       Number(b.total_gross_value || 0),
              bills:       (b.older_bills || 0) + (b.today_bills || 0),
              oldest_date: b.oldest_date || null,
            }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 6)

          // ── At-risk rollup (stock sitting > 7 days at any branch) ─────────
          // We don't have per-bill ages in the rollup, so we conservatively
          // attribute the *whole* branch's totals to the at-risk bucket if its
          // oldest_date is > 7 days ago. Good enough for a callout.
          const now7 = Date.now() - 7  * 86400000
          const now14 = Date.now() - 14 * 86400000
          let riskWeight = 0, riskValue = 0, riskBills = 0
          let aged14Weight = 0
          for (const b of rows) {
            const od = b.oldest_date ? new Date(b.oldest_date).getTime() : null
            if (od == null) continue
            if (od < now7) {
              riskWeight += Number(b.total_gross_wt    || 0)
              riskValue  += Number(b.total_gross_value || 0)
              riskBills  += (b.older_bills || 0) + (b.today_bills || 0)
            }
            if (od < now14) {
              aged14Weight += Number(b.total_gross_wt || 0)
            }
          }

          // ── In-movement totals (active consignments — created but not yet
          //    received at the destination). Excludes cancelled and seed rows.
          const cs = consignList.data || []
          const inMotionList = cs.filter(c =>
            c.status !== 'received' && c.status !== 'seed' && c.status !== 'cancelled'
          )
          const movementCount  = inMotionList.length
          const movementBills  = inMotionList.reduce((s, c) => s + Number(c.total_bills    || 0), 0)
          const movementWeight = inMotionList.reduce((s, c) => s + Number(c.total_gross_wt || c.total_net_wt || 0), 0)
          const movementValue  = inMotionList.reduce((s, c) => s + Number(c.total_amount   || 0), 0)

          // In-movement state split (where consignments are originating from).
          const movementStateMap = new Map()
          for (const c of inMotionList) {
            const stateKey = c.source_state || c.state_code || c.region || 'Other'
            const cur = movementStateMap.get(stateKey) || { state: stateKey, weight: 0, count: 0 }
            cur.weight += Number(c.total_gross_wt || c.total_net_wt || 0)
            cur.count  += 1
            movementStateMap.set(stateKey, cur)
          }
          const movementByState = [...movementStateMap.values()].sort((a, b) => b.weight - a.weight)

          // ── Daily movement series (last 14 days, including today) ─────────
          // Counts consignments BY CREATION DATE so the sparkline reflects when
          // each consignment was dispatched. Cancelled rows are excluded. This
          // lets management see velocity over time at a glance.
          // Bucket by IST calendar day so the "today" column flips at IST midnight,
          // not the browser/server's local midnight.
          const today = istNow(); today.setUTCHours(0,0,0,0)
          const dailySeries = new Array(14).fill(0).map((_, i) => {
            const d = new Date(today); d.setUTCDate(d.getUTCDate() - (13 - i))
            return { date: d, count: 0, weight: 0 }
          })
          const dayKey = (d) => istStr(d)
          const seriesByKey = new Map(dailySeries.map(b => [dayKey(b.date), b]))
          const allMoved = (cs || []).filter(c => c.status !== 'seed' && c.status !== 'cancelled')
          for (const c of allMoved) {
            if (!c.created_at) continue
            const d = fromUtcDate(new Date(c.created_at))
            d.setUTCHours(0,0,0,0)
            const k = dayKey(d)
            const bucket = seriesByKey.get(k)
            if (bucket) {
              bucket.count++
              bucket.weight += Number(c.total_gross_wt || c.total_net_wt || 0)
            }
          }
          // Velocity: last 7 days vs prior 7 days (count of consignments).
          const last7   = dailySeries.slice(7).reduce((s, b) => s + b.count, 0)
          const prior7  = dailySeries.slice(0, 7).reduce((s, b) => s + b.count, 0)
          const last7w  = dailySeries.slice(7).reduce((s, b) => s + b.weight, 0)
          const prior7w = dailySeries.slice(0, 7).reduce((s, b) => s + b.weight, 0)
          const velocityPct = prior7 > 0 ? ((last7 - prior7) / prior7) * 100 : (last7 > 0 ? 100 : 0)

          // ── Lifecycle counts derived from the consignment list ──────────
          // Pending = accounts hasn't approved yet (after creation but before
          // doc generation). Cancel requests = ops asked to void, awaiting
          // accounts. Today = consignments created during the IST calendar
          // day. Counts only include in-flight rows (excludes received,
          // cancelled, seed).
          const todayKey = istStr(istNow())
          const pendingCount = inMotionList.filter(c => c.approval_status === 'pending').length
          const cancelReqCount = inMotionList.filter(c => c.cancellation_requested_at).length
          const todayCount = inMotionList.filter(c => {
            if (!c.created_at) return false
            const d = fromUtcDate(new Date(c.created_at))
            return istStr(d) === todayKey
          }).length

          setConsignStats({
            // legacy fields kept for any callers still reading them
            totalBranches: branchesActive,
            totalWeight:   branchWeight + movementWeight,
            urgent,
            totalPending:  branchBills,
            inTransit:     movementCount,
            // split for the dashboard balance view
            branchBills, branchWeight, branchValue, branchesActive,
            movementBills, movementWeight, movementValue, movementCount,
            // raw rows for the region-grouped expandable overview.
            // Both are per-branch shaped — same columns (total_bills,
            // total_net_wt, oldest_date, region) — so the dashboard component
            // treats them identically.
            branchOverviewRaw:     rows,
            inTransitOverviewRaw:  transitRows,
            // legacy: consignment-level list still passed for other widgets
            inTransitRaw:          inMotionList,
            // new richer slices
            byState, topBranches, movementByState,
            dailySeries, last7, prior7, last7w, prior7w, velocityPct,
            riskWeight, riskValue, riskBills, aged14Weight,
            // lifecycle counts (still computed; unused by the new overview
            // but kept in case another widget reads them)
            pendingCount, cancelReqCount, todayCount,
          })
        }).catch(() => {})
      )
    }
    if (canSee('user-management') || canSee('branch-management')) {
      ps.push(
        Promise.all([
          supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
          supabase.from('branches').select('id', { count: 'exact', head: true }).eq('is_active', true),
        ]).then(([u, b]) => setAdminStats({ userCount: u.count ?? 0, branchCount: b.count ?? 0 }))
          .catch(() => {})
      )
    }

    Promise.all(ps).finally(() => setHubLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Branches load + region scope filter. Re-runs when regionAccess.restricted /
  // regions change (which happens when userProfile finishes loading) so we don't
  // miss the filter due to a userProfile-vs-fetch race.
  useEffect(() => {
    if (!showPurchase) return
    supabase.from('branches').select('name, region, state, cluster').eq('is_active', true).then(({ data }) => {
      if (!data) return
      // Region scoping defense-in-depth: even if RLS isn't applied yet, drop rows outside user's regions.
      const filtered = regionAccess.restricted
        ? data.filter(b => regionAccess.regions.includes(b.region))
        : data
      setBranchMeta(filtered)
      const rc = {}
      filtered.forEach(b => { if (b.region) rc[b.region] = (rc[b.region] || 0) + 1 })
      setRegionCounts(rc)
      const states = new Set(filtered.map(b => b.state).filter(Boolean))
      setStateCount(states.size)
    })
  }, [showPurchase, regionAccess.restricted, JSON.stringify(regionAccess.regions || [])])

  // Re-run fetchAll whenever fresh purchases land in the DB. lastSyncAt is
  // polled every 30s from purchases.updated_at, so the dashboard catches the
  // post-sync state shortly after the fire-and-forget /sync-purchases finishes
  // (previously the dashboard rendered pre-sync data and only refreshed if
  // you navigated away and back).
  useEffect(() => { if (showPurchase) { fetchAll(); setLastRefresh(new Date()) } }, [period, showPurchase, filterType, filterValue, regionAccess.restricted, JSON.stringify(regionAccess.regions || []), branchMeta.length, lastSyncAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 3 minutes when viewing Today
  useEffect(() => {
    if (!showPurchase || period !== 'today') { clearInterval(refreshRef.current); return }
    refreshRef.current = setInterval(() => { fetchAll(); setLastRefresh(new Date()) }, 3 * 60 * 1000)
    return () => clearInterval(refreshRef.current)
  }, [showPurchase, period, filterType, filterValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true)
    setStateData([])
    setTopBranches([])
    setBottomBranches([])
    const { from, to } = getRange(period)

    // Region scoping: resolve the user's allowed branches BY DIRECTLY QUERYING branches.
    // Don't rely on branchMeta state — it may not have loaded yet, or may be holding
    // stale all-India data when this runs after a regionAccess change.
    let userBranches = null
    if (regionAccess.restricted) {
      const { data: regionMatch } = await supabase
        .from('branches')
        .select('name')
        .eq('is_active', true)
        .in('region', regionAccess.regions)
      userBranches = (regionMatch || []).map(b => b.name)
      if (userBranches.length === 0) {
        // No branches in user's regions → nothing to show.
        setKpis(null); setLoading(false); return
      }
    }

    // Build filter params — all routes use get_purchase_aggregates for consistent data
    let p_branch = null
    let p_region_branches = null
    if (filterType === 'branch' && filterValue) {
      p_branch = filterValue
    } else if (filterType === 'region' && filterValue) {
      p_region_branches = branchMeta.filter(b => b.region === filterValue).map(b => b.name)
    } else if (filterType === 'state' && filterValue) {
      p_region_branches = branchMeta.filter(b => b.state === filterValue).map(b => b.name)
    } else if (filterType === 'cluster' && filterValue) {
      p_region_branches = branchMeta.filter(b => b.cluster === filterValue).map(b => b.name)
    }

    // Apply user's region restriction:
    // - "All Data" tab (no UI filter) → set p_region_branches to user's allowed branches
    // - UI filter set → intersect with user's allowed branches; empty → no data
    if (userBranches) {
      if (p_region_branches) {
        p_region_branches = p_region_branches.filter(b => userBranches.includes(b))
      } else {
        p_region_branches = userBranches
      }
      if (p_branch && !userBranches.includes(p_branch)) {
        p_branch = null
        p_region_branches = []
      }
      if (p_region_branches.length === 0) {
        setKpis(null); setLoading(false); return
      }
    }

    // Route through /api/report-aggregates which enforces region scoping server-side
    // via lib/apiAuth — authoritative even if client-side regionAccess hasn't resolved
    // yet. The server intersects p_region_branches with the user's allowed branches.
    const params = new URLSearchParams()
    if (from)         params.set('from', from)
    if (to)           params.set('to', to)
    if (p_branch)     params.set('branch', p_branch)
    if (p_region_branches?.length) params.set('region_branches', p_region_branches.join(','))
    if (from === to)  params.set('single_day', 'true')
    const aggRes = await authedFetch(`/api/report-aggregates?${params}`)
    const aggJson = await aggRes.json().catch(() => ({}))
    if (aggJson?.empty || !aggJson?.kpis) { setKpis(null); setLoading(false); return }
    const data = aggJson
    setKpis(data.kpis || null)

    // Group breakdown by region (all/cluster/branch) or by state (when region/state is selected)
    const branchRows = data.branches || []
    const groupByState = filterType === 'region' || filterType === 'state'
    const groupKey = groupByState ? 'state' : 'region'
    const groupMap = {}
    branchRows.forEach(b => {
      const key = b[groupKey] || 'Unknown'
      if (!groupMap[key]) groupMap[key] = { state: key, total_net: 0, txn_count: 0, branch_count: 0 }
      groupMap[key].total_net += Number(b.total_net || 0)
      groupMap[key].txn_count += Number(b.txn_count || 0)
      groupMap[key].branch_count++
    })
    setStateData(Object.values(groupMap).sort((a, b) => b.total_net - a.total_net))
    // Top 5 (descending net wt) + Bottom 5 (ascending net wt, only branches with at least 1 txn).
    // Excluding zero-txn branches keeps "Bottom" meaningful — otherwise bottom is just inactive ones.
    const sortedDesc = [...branchRows].sort((a, b) => Number(b.total_net || 0) - Number(a.total_net || 0))
    setTopBranches(sortedDesc.slice(0, 5))
    const activeAsc = sortedDesc.filter(b => Number(b.txn_count || 0) > 0).reverse()
    setBottomBranches(activeAsc.slice(0, 5))
    setLoading(false)
  }

  const name          = userProfile?.full_name?.split(' ')[0] || 'there'
  const { label: periodLabel, from: pFrom, to: pTo } = getRange(period)
  const totalBranches = Object.values(regionCounts).reduce((a,b)=>a+b,0)

  const regionColorMap = {}
  const orderedRegions = stateData.filter(s=>s.state).map(s=>s.state)
  Object.keys(regionCounts).forEach(r => { if (!orderedRegions.includes(r)) orderedRegions.push(r) })
  orderedRegions.forEach((region, i) => { regionColorMap[region] = COLOR_PALETTE[i % COLOR_PALETTE.length] })

  const branchRegionMap = {}
  branchMeta.forEach(b => { if (b.name && b.region) branchRegionMap[b.name] = b.region })

  const filterTypeOptions = [
    { key: null,      label: 'All Data' },
    { key: 'region',  label: 'Region'   },
    { key: 'state',   label: 'State'    },
    { key: 'cluster', label: 'Cluster'  },
    { key: 'branch',  label: 'Branch'   },
  ]
  // Region scoping: when restricted, drop branch-meta rows outside user's regions BEFORE
  // computing the filter dropdown options. Even if branches RLS isn't deployed yet, the UI
  // will only let the user pick from their allowed regions.
  const scopedBranchMeta = regionAccess.restricted
    ? branchMeta.filter(b => regionAccess.regions.includes(b.region))
    : branchMeta

  const filterValueOptions = filterType === 'region'
    ? [...new Set(scopedBranchMeta.map(b => b.region).filter(Boolean))].sort()
    : filterType === 'state'
    ? [...new Set(scopedBranchMeta.map(b => b.state).filter(Boolean))].sort()
    : filterType === 'cluster'
    ? [...new Set(scopedBranchMeta.map(b => b.cluster).filter(Boolean))].sort()
    : filterType === 'branch'
    ? [...new Set(scopedBranchMeta.map(b => b.name).filter(Boolean))].sort()
    : []

  const maxStateNet  = Math.max(...stateData.map(s=>Number(s.total_net||0)), 1)
  const hasData      = kpis?.total_count > 0
  const hasStateData = stateData.filter(s=>s.state && Number(s.total_net||0)>0).length > 0
  const physPct      = hasData ? (kpis.physical_count/kpis.total_count)*100 : 0
  const takePct      = hasData ? (kpis.takeover_count/kpis.total_count)*100 : 0
  const dateLabel    = pFrom&&pTo ? (pFrom===pTo ? fmtDate(pFrom) : `${fmtDate(pFrom)} — ${fmtDate(pTo)}`) : ''

  const panel = {
    background:`linear-gradient(145deg,${t.card},${t.card2})`,
    border:`1px solid ${t.border}`, borderRadius:16, padding:'20px 22px',
    boxShadow: t.shadow,
  }
  const panelTitle = { fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }
  const panelMeta  = { fontSize:12, color:t.text4 }

  return (
    <div style={{ padding: isMobile ? '16px' : '28px 32px', maxWidth: '100%', boxSizing: 'border-box' }}>
      <style>{`
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes pglow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.25)}}
        .overview-body {
          display: grid;
          grid-template-rows: 1fr;
          transition: grid-template-rows .35s cubic-bezier(.4,0,.2,1), opacity .3s ease;
          overflow: hidden;
        }
        .overview-body.collapsed {
          grid-template-rows: 0fr;
          opacity: 0;
        }
        .overview-body > div { min-height: 0; }
      `}</style>

      {/* ── HERO ── */}
      <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2} 60%,${t.card})`, border:`1px solid ${t.border}`, borderRadius:20, padding: isMobile ? '18px 16px' : '28px 44px', marginBottom:20, position:'relative', overflow:'hidden', boxShadow:`${t.shadow},inset 0 1px 0 rgba(255,255,255,.04)`, opacity:heroVis?1:0, transform:heroVis?'translateY(0)':'translateY(16px)', transition:'all .6s cubic-bezier(.34,1.2,.64,1)' }}>
        <div style={{ position:'absolute', right:-80, top:-80, width:320, height:320, borderRadius:'50%', background:`radial-gradient(circle,${t.gold}12 0%,transparent 65%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', inset:0, backgroundImage:`radial-gradient(${t.gold}08 1px,transparent 1px)`, backgroundSize:'28px 28px', pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:0, left:'10%', right:'10%', height:1, background:`linear-gradient(90deg,transparent,${t.gold}40,transparent)` }}/>
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ fontSize:12, color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ width:24, height:1, background:`linear-gradient(90deg,transparent,${t.gold})`, display:'inline-block' }}/>
            {getGreeting()}, {name}
            {lastSyncAt && (() => {
              const ageMs  = Date.now() - new Date(lastSyncAt).getTime()
              const ageMin = Math.floor(ageMs / 60000)
              const ageSec = Math.floor(ageMs / 1000)
              const fresh  = ageMs < 5 * 60 * 1000
              const stale  = ageMs > 15 * 60 * 1000
              const color  = stale ? t.red : fresh ? t.green : t.text3
              const label  = ageSec < 60 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin/60)}h ago`
              return (
                <span style={{ display:'flex', alignItems:'center', gap:5, color, textTransform:'none', letterSpacing:'.02em', fontSize:11 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:color, boxShadow: fresh ? `0 0 6px ${color}` : 'none' }} />
                  Synced {label}
                </span>
              )
            })()}
          </div>
          <div style={{ fontSize:36, fontWeight:200, color:t.text1, lineHeight:1.15, marginBottom:24, letterSpacing:'-.02em' }}>
            Every gram.<br/>
            <span style={{ fontStyle:'italic', color:t.gold, textShadow:`0 0 40px ${t.gold}40` }}>Accounted for.</span>
          </div>
        </div>
      </div>

      {/* ── LIVE RATES ── */}
      <LiveTicker />

      {/* ── MOBILE MODULE GRID — clean grouped-by-module view (role-aware) ── */}
      {isMobile && (() => {
        const visibleModules = getVisibleModules(canSee)
        if (visibleModules.length === 0) return null
        const tapModule = (m) => {
          if (m.comingSoon) { openMobileMenuWithModule(m.id); return }
          if (m.visibleTabs.length === 1) { setActiveNav(m.visibleTabs[0].id); return }
          openMobileMenuWithModule(m.id)
        }
        return (
          <div style={{ marginTop: 8, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Your Modules</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {visibleModules.map((m, i) => (
                <button key={m.id} onClick={() => tapModule(m)}
                  style={{
                    background: `linear-gradient(135deg, ${m.color}10, ${t.card2})`,
                    border: `1px solid ${m.color}25`, borderRadius: 14, padding: '14px 14px',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
                    cursor: 'pointer', textAlign: 'left',
                    opacity: m.comingSoon ? 0.7 : 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'transform .15s, border-color .15s',
                  }}
                  onTouchStart={e => e.currentTarget.style.transform = 'scale(0.98)'}
                  onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${m.color}25`, border: `1px solid ${m.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{m.icon}</div>
                    {m.comingSoon && <div style={{ fontSize: 9, padding: '2px 6px', background: `${t.text4}25`, color: t.text3, borderRadius: 4, fontWeight: 600 }}>SOON</div>}
                  </div>
                  <div style={{ fontSize: 13, color: t.text1, fontWeight: 600, lineHeight: 1.2 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: t.text3 }}>
                    {m.comingSoon ? 'Coming soon' : `${m.visibleTabs.length} section${m.visibleTabs.length !== 1 ? 's' : ''}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── DESKTOP MODULE HUB (per-page cards with stats) ── */}
      {!isMobile && (() => {
        const cards = [
          canSee('purchase-data') && {
            id: 'purchase-data', icon: '◉', label: 'Purchase Data', color: t.gold,
            metrics: [
              { label: "Today's Bills",  value: todayKpis?.total_count > 0 ? Number(todayKpis.total_count).toLocaleString('en-IN') : '—' },
              { label: 'Net Weight',     value: todayKpis?.total_net > 0 ? `${Number(todayKpis.total_net).toFixed(1)}g` : '—' },
            ],
            cta: 'Open Purchase Data',
          },
          canSee('purchase-reports') && {
            id: 'purchase-reports', icon: '📈', label: 'Purchase Reports', color: t.green,
            metrics: [
              { label: 'MTD Bills',  value: kpis?.total_count > 0 ? Number(kpis.total_count).toLocaleString('en-IN') : '—' },
              { label: 'MTD Value',  value: kpis?.total_value > 0 ? (Number(kpis.total_value)/1e7 >= 1 ? `₹${(Number(kpis.total_value)/1e7).toFixed(1)}Cr` : `₹${Number(kpis.total_value).toLocaleString('en-IN',{maximumFractionDigits:0})}`) : '—' },
            ],
            cta: 'Open Reports',
          },
          canSee('consignment-overview') && {
            id: 'consignment-overview', icon: '📦', label: 'Branch Stock', color: t.orange,
            metrics: [
              { label: 'Branches with Stock', value: consignStats ? String(consignStats.totalBranches) : '—' },
              { label: 'Urgent Alerts',       value: consignStats ? String(consignStats.urgent) : '—' },
            ],
            cta: 'Open Branch Stock',
          },
          (canSee('consignment-data') || canSee('consignment-report') || canSee('consignment-summary')) && !canSee('consignment-overview') && {
            id: 'consignment-data', icon: '📦', label: 'Consignments', color: t.orange,
            metrics: [{ label: 'Data & Reports', value: '→' }],
            cta: 'Open Consignments',
          },
          canSee('inbound-bot') && {
            id: 'inbound-bot', icon: '◑', label: 'Telesales', color: t.purple,
            metrics: [
              { label: "Today's Calls",  value: telesalesStats ? String(telesalesStats.total) : '—' },
              { label: 'Engagement',     value: telesalesStats ? `${telesalesStats.engageRate}%` : '—' },
              { label: 'Interested',     value: telesalesStats ? String(telesalesStats.interested) : '—' },
            ],
            cta: 'Open Inbound Bot',
          },
          canSee('live-market-rates') && {
            id: 'live-market-rates', icon: '◎', label: 'Market Rates', color: t.blue,
            metrics: [{ label: 'Live gold rates', value: '24K / 22K / 18K' }],
            cta: 'Open Market Rates',
          },
          canSee('cal-table') && {
            id: 'cal-table', icon: '⊛', label: 'Cal Table', color: t.text2,
            metrics: [{ label: 'Sales pricing calculator', value: '→' }],
            cta: 'Open Cal Table',
          },
          (canSee('user-management') || canSee('branch-management')) && {
            id: 'user-management', icon: '⚙', label: 'Administration', color: t.red,
            metrics: [
              { label: 'Active Users',    value: adminStats ? String(adminStats.userCount) : '—' },
              { label: 'Active Branches', value: adminStats ? String(adminStats.branchCount) : '—' },
            ],
            cta: canSee('user-management') ? 'Open User Management' : 'Open Branch Management',
          },
        ].filter(Boolean)

        if (cards.length === 0) return (
          <div style={{ marginTop: 8, background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:20, padding:'40px 44px', boxShadow:t.shadow, textAlign:'center' }}>
            <div style={{ fontSize:'2rem', opacity:.15, marginBottom:16 }}>◈</div>
            <div style={{ fontSize:15, color:t.text2, fontWeight:500, marginBottom:8 }}>Your workspace is ready</div>
            <div style={{ fontSize:13, color:t.text4, lineHeight:1.7 }}>
              The modules available to your role will appear here.<br />
              Contact your administrator if you need access to additional sections.
            </div>
          </div>
        )

        const cols = isMobile ? (cards.length === 1 ? 1 : 2) : (cards.length === 1 ? 1 : cards.length === 2 ? 2 : cards.length <= 4 ? 2 : 3)
        return (
          <div style={{ marginTop: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>Your Modules</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
              {cards.map((card, i) => (
                <ModuleCard
                  key={card.id}
                  icon={card.icon} label={card.label} color={card.color}
                  metrics={card.metrics} cta={card.cta}
                  onClick={() => setActiveNav(card.id)}
                  loading={hubLoading}
                  t={t} delay={i * 60} compact={isMobile}
                />
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── PURCHASE OVERVIEW ── */}
      {showPurchase && <div style={{ marginTop: 8, border:`1px solid ${t.border2}`, borderRadius:20, background:`linear-gradient(160deg,${t.card2},${t.card3})`, boxShadow:`${t.shadow},inset 0 1px 0 rgba(255,255,255,.03)`, position:'relative', overflow:'hidden', transition:'all .35s ease' }}>
        <div style={{ position:'absolute', top:0, left:0, width:160, height:160, background:`radial-gradient(circle at top left,${t.gold}08,transparent 70%)`, pointerEvents:'none' }}/>

        {/* ── Clickable Header ── */}
        <div
          onClick={() => setOverviewOpen(o => !o)}
          style={{ display:'flex', alignItems:'center', gap: isMobile ? 8 : 14, padding: overviewOpen ? (isMobile ? '14px 16px' : '20px 24px') : (isMobile ? '10px 16px' : '12px 24px'), flexWrap:'wrap', position:'relative', zIndex:1, cursor:'pointer', userSelect:'none', borderBottom: overviewOpen ? `1px solid ${t.border}` : 'none', transition:'border .35s ease' }}
        >
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:3, height:20, borderRadius:2, background:`linear-gradient(180deg,${t.gold},${t.gold}40)`, boxShadow:`0 0 8px ${t.gold}60` }}/>
            <div style={{ fontSize:14, color:t.text2, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700 }}>Purchase Overview</div>
          </div>

          {overviewOpen && !isMobile && <>
            {/* Period tabs — desktop only in header */}
            {showPeriodSelector && <div onClick={e=>e.stopPropagation()} style={{ display:'flex', gap:3, padding:4, background:t.card, borderRadius:10, border:`1px solid ${t.border}`, boxShadow:'inset 0 1px 3px rgba(0,0,0,.3)' }}>
              {PERIODS.map(({ key, label }) => (
                <button key={key} onClick={()=>setPeriod(key)} style={{ padding:'6px 14px', borderRadius:7, border:'none', cursor:'pointer', background:period===key?`linear-gradient(135deg,${t.gold},${t.gold}cc)`:'transparent', color:period===key?'#0a0a0a':t.text3, fontSize:12, fontWeight:period===key?700:500, letterSpacing:'.03em', transition:'all .2s cubic-bezier(.34,1.56,.64,1)', boxShadow:period===key?`0 2px 8px ${t.gold}40`:'none', whiteSpace:'nowrap' }}>
                  {label}
                </button>
              ))}
            </div>}
            {showPeriodSelector && <div style={{ fontSize:12, color:t.text3, fontStyle:'italic' }}>{!loading && dateLabel}</div>}
            <button onClick={e => { e.stopPropagation(); fetchAll(); setLastRefresh(new Date()) }}
              style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${t.border}`, background:t.card, color:t.text3, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap' }}>
              ↻{lastRefresh && <span style={{ fontSize:10, color:t.text4 }}>{lastRefresh.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span>}
            </button>
            {totalBranches > 0 && <div style={{ fontSize:11, color:t.text4, display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:t.green, display:'inline-block', boxShadow:`0 0 5px ${t.green}80` }}/>
              {totalBranches} active branches · {Object.keys(regionCounts).length} regions
            </div>}
          </>}

          {/* Chevron */}
          <div style={{ marginLeft:'auto', width:28, height:28, borderRadius:8, background:`${t.gold}12`, border:`1px solid ${t.gold}28`, display:'flex', alignItems:'center', justifyContent:'center', color:t.gold, fontSize:11, transition:'transform .35s cubic-bezier(.4,0,.2,1)', transform: overviewOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            ▼
          </div>
        </div>

        {/* ── Collapsible body ── */}
        <div className={`overview-body${overviewOpen ? '' : ' collapsed'}`}>
          <div style={{ padding: overviewOpen ? (isMobile ? '16px 14px 20px' : '24px 24px 28px') : '0' }}>

            {/* Period selector — mobile only, own scrollable row */}
            {isMobile && showPeriodSelector && overviewOpen && (
              <div onClick={e=>e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:14 }}>
                <div style={{ display:'flex', gap:3, padding:4, background:t.card, borderRadius:10, border:`1px solid ${t.border}`, boxShadow:'inset 0 1px 3px rgba(0,0,0,.3)', overflowX:'auto', scrollbarWidth:'none', flex:1, WebkitOverflowScrolling:'touch' }}>
                  {PERIODS.map(({ key, label }) => (
                    <button key={key} onClick={()=>setPeriod(key)} style={{ padding:'6px 12px', borderRadius:7, border:'none', cursor:'pointer', background:period===key?`linear-gradient(135deg,${t.gold},${t.gold}cc)`:'transparent', color:period===key?'#0a0a0a':t.text3, fontSize:12, fontWeight:period===key?700:500, letterSpacing:'.03em', transition:'all .2s cubic-bezier(.34,1.56,.64,1)', boxShadow:period===key?`0 2px 8px ${t.gold}40`:'none', whiteSpace:'nowrap', flexShrink:0 }}>
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={() => { fetchAll(); setLastRefresh(new Date()) }}
                  style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${t.border}`, background:t.card, color:loading?t.gold:t.text3, fontSize:14, cursor:'pointer', flexShrink:0, transition:'color .2s' }}>
                  ↻
                </button>
              </div>
            )}

            {/* Hierarchical filter */}
            {overviewOpen && branchMeta.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                {/* Row 1: type selector */}
                <div style={{ display:'flex', gap:5, overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
                  {filterTypeOptions.map(opt => {
                    const active = opt.key === filterType
                    return (
                      <button key={opt.key||'all'}
                        onClick={() => { setFilterType(opt.key); setFilterValue(null) }}
                        style={{ padding:'4px 12px', borderRadius:20, border:`1px solid ${active ? t.gold+'80' : t.border}`, background: active ? `${t.gold}20` : 'transparent', color: active ? t.gold : t.text4, fontSize:11, fontWeight: active ? 700 : 500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .18s' }}>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                {/* Row 2: search dropdown for branch; pills for everything else */}
                {filterType === 'branch' ? (
                  <div style={{ position:'relative' }}>
                    {filterValue ? (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px 5px 12px', borderRadius:20, background:`${t.blue}20`, border:`1px solid ${t.blue}60` }}>
                          <span style={{ fontSize:11, color:t.blue, fontWeight:600 }}>{filterValue}</span>
                          <button onClick={() => { setFilterValue(null); setBranchSearch('') }}
                            style={{ background:'none', border:'none', color:t.blue, cursor:'pointer', fontSize:12, lineHeight:1, padding:'0 0 0 2px', opacity:.7 }}>✕</button>
                        </div>
                        <button onClick={() => { setFilterValue(null); setBranchSearch(''); setBranchDropOpen(true); setTimeout(()=>branchInputRef.current?.focus(),50) }}
                          style={{ fontSize:10, color:t.text4, background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0 }}>
                          Change
                        </button>
                      </div>
                    ) : (
                      <div style={{ position:'relative', maxWidth:280 }}>
                        <input
                          ref={branchInputRef}
                          value={branchSearch}
                          onChange={e => { setBranchSearch(e.target.value); setBranchDropOpen(true) }}
                          onFocus={() => setBranchDropOpen(true)}
                          placeholder="Search branch…"
                          style={{ width:'100%', boxSizing:'border-box', background:t.card, border:`1px solid ${branchDropOpen ? t.blue+'80' : t.border}`, borderRadius:8, padding:'6px 12px', color:t.text1, fontSize:12, outline:'none', transition:'border .15s' }}
                        />
                        {branchDropOpen && (
                          <div ref={branchDropRef}
                            style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, background:t.card, border:`1px solid ${t.border}`, borderRadius:8, zIndex:200, maxHeight:200, overflowY:'auto', boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>
                            {filterValueOptions.filter(v => !branchSearch || v.toLowerCase().includes(branchSearch.toLowerCase())).map(v => (
                              <button key={v}
                                onMouseDown={e => { e.preventDefault(); setFilterValue(v); setBranchSearch(''); setBranchDropOpen(false) }}
                                style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 12px', background:'none', border:'none', color:t.text2, fontSize:12, cursor:'pointer', borderBottom:`1px solid ${t.border}30` }}
                                onMouseEnter={e => e.currentTarget.style.background = `${t.gold}12`}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                {v}
                              </button>
                            ))}
                            {filterValueOptions.filter(v => !branchSearch || v.toLowerCase().includes(branchSearch.toLowerCase())).length === 0 && (
                              <div style={{ padding:'10px 12px', fontSize:11, color:t.text4 }}>No branches match</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : filterType && filterValueOptions.length > 0 ? (
                  <div style={{ display:'flex', gap:5, overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', paddingLeft:2 }}>
                    {filterValueOptions.map(v => {
                      const active = v === filterValue
                      return (
                        <button key={v}
                          onClick={() => setFilterValue(active ? null : v)}
                          style={{ padding:'3px 10px', borderRadius:20, border:`1px solid ${active ? t.blue+'80' : t.border}`, background: active ? `${t.blue}20` : 'transparent', color: active ? t.blue : t.text4, fontSize:10, fontWeight: active ? 700 : 400, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .18s' }}>
                          {v}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )}

            {/* KPI Rows — gated by element.dashboard.kpi_cards */}
            {showKpiCards && <>
              {/* KPI Row 1 */}
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14, marginBottom: isMobile ? 10 : 14 }}>
                <KpiCard t={t} delay={0}   label="Total Bills"          icon="🧾" color={t.gold}  loading={loading} value={hasData?Number(kpis.total_count).toLocaleString('en-IN'):'—'} sub={periodLabel} compact={isMobile}/>
                <KpiCard t={t} delay={60}  label="Total Net Weight"     icon="⚖️" color={t.gold}  loading={loading} value={hasData?`${fmt(kpis.total_net)}g`:'—'} sub="Net weight purchased" compact={isMobile}/>
                <KpiCard t={t} delay={120} label="Gross Purchase Value" icon="₹"  color={t.green} loading={loading} value={hasData?fmtCr(kpis.total_value):'—'} sub="Before service charges" compact={isMobile}/>
                <KpiCard t={t} delay={180} label="Avg Rate / Gram"      icon="📈" color={t.green} loading={loading} value={hasData&&kpis.avg_rate_per_gram>0?`₹${Number(kpis.avg_rate_per_gram).toLocaleString('en-IN',{maximumFractionDigits:0})}/g`:'—'} sub="Gross value ÷ net weight" compact={isMobile}/>
              </div>

              {/* KPI Row 2 */}
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14, marginBottom: isMobile ? 14 : 22 }}>
                <KpiCard t={t} delay={240} label="Avg Purity"         icon="✦" color={t.purple} loading={loading} value={hasData?fmtPct(kpis.avg_purity):'—'} sub="Weighted by net weight" compact={isMobile}/>
                <KpiCard t={t} delay={300} label="Avg Wt / Bill"      icon="◈" color={t.text2}  loading={loading} value={hasData?`${fmt(kpis.avg_net_per_txn)}g`:'—'} sub="Net weight ÷ bills" compact={isMobile}/>
                <KpiCard t={t} delay={360} label="Avg Service Charge" icon="%" color={t.red}    loading={loading} value={hasData?`${Number(kpis.avg_service_charge_pct||0).toFixed(2)}%`:'—'} sub="Service charge ÷ gross value" compact={isMobile}/>
                <KpiCard t={t} delay={420} label="Active Branches"    icon="⬡" color={t.blue}   loading={loading} value={hasData?`${kpis.branch_count} / ${totalBranches}`:`— / ${totalBranches}`} sub={hasData?'branches purchased this period':'No purchases this period'} compact={isMobile}/>
              </div>

              {/* Purchase Mix */}
              {!loading && hasData && (
                <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:14, padding:'18px 22px', marginBottom:22 }}>
                  {isMobile
                    ? <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:10 }}>Purchase Mix</div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                          {[{ color:t.gold, label:'Physical', pct:physPct, count:kpis.physical_count },{ color:'#e07820', label:'Takeover', pct:takePct, count:kpis.takeover_count }].map(item=>(
                            <div key={item.label} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:`${item.color}0a`, border:`1px solid ${item.color}25`, borderRadius:10 }}>
                              <div style={{ width:10, height:10, borderRadius:3, background:item.color, boxShadow:`0 0 6px ${item.color}60`, flexShrink:0 }}/>
                              <div>
                                <div style={{ fontSize:12, color:t.text3, fontWeight:500 }}>{item.label}</div>
                                <div style={{ fontSize:18, fontWeight:200, color:item.color, lineHeight:1.1, fontVariantNumeric:'tabular-nums' }}>{item.pct.toFixed(1)}%</div>
                                <div style={{ fontSize:11, color:t.text4 }}>{Number(item.count||0).toLocaleString('en-IN')} bills</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    : <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                        <div style={{ fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }}>Purchase Mix</div>
                        <div style={{ display:'flex', gap:20 }}>
                          {[{ color:t.gold, label:'Physical', pct:physPct, count:kpis.physical_count },{ color:'#e07820', label:'Takeover', pct:takePct, count:kpis.takeover_count }].map(item=>(
                            <div key={item.label} style={{ display:'flex', alignItems:'center', gap:7 }}>
                              <div style={{ width:10, height:10, borderRadius:3, background:item.color, boxShadow:`0 0 6px ${item.color}60` }}/>
                              <span style={{ fontSize:13, color:t.text2, fontWeight:500 }}>{item.label}</span>
                              <span style={{ fontSize:13, color:item.color, fontWeight:700 }}>{item.pct.toFixed(1)}%</span>
                              <span style={{ fontSize:12, color:t.text4 }}>({Number(item.count||0).toLocaleString('en-IN')} bills)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                  }
                  <div style={{ display:'flex', height:10, borderRadius:100, overflow:'hidden', gap:2, boxShadow:'inset 0 1px 3px rgba(0,0,0,.4)' }}>
                    <div style={{ width:`${physPct}%`, background:`linear-gradient(90deg,${t.gold}aa,${t.gold})`, borderRadius:'100px 0 0 100px', transition:'width .8s cubic-bezier(.4,0,.2,1)', boxShadow:`0 0 10px ${t.gold}50` }}/>
                    <div style={{ flex:1, background:'linear-gradient(90deg,#e07820,#c85010)', borderRadius:'0 100px 100px 0', boxShadow:'0 0 10px #e0782050' }}/>
                  </div>
                </div>
              )}
            </>}

            {/* Bottom panels grid — only visible panels */}
            {visiblePanels > 0 && <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${visiblePanels},1fr)`, gap:16 }}>

              {/* By Region */}
              {showStateTable && <div style={panel}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div style={panelTitle}>By Region</div>
                  <div style={panelMeta}>Net Weight</div>
                </div>
                {loading
                  ? [0,1,2,3,4].map(i=><div key={i} style={{ height:30, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:6, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
                  : !hasStateData
                    ? <EmptyPanel t={t} />
                    : stateData.filter(s=>s.state && Number(s.total_net||0)>0).map((s,i)=>(
                        <StatRow key={s.state||i} delay={i*60}
                          label={s.state}
                          sub={`${s.branch_count||0} branches · ${Number(s.txn_count||s.total_count||0).toLocaleString('en-IN')} bills`}
                          value={`${fmt(s.total_net)}g`}
                          color={regionColorMap[s.state] || COLOR_PALETTE[i % COLOR_PALETTE.length]}
                          t={t}
                          bar={Number(s.total_net||0)} barMax={maxStateNet}/>
                      ))
                }
              </div>}


              {/* Top Branches */}
              {showTopBranches && <div style={panel}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div style={panelTitle}>Top 5 Branches</div>
                  <div style={panelMeta}>Net Weight</div>
                </div>
                {loading
                  ? [0,1,2,3,4].map(i=><div key={i} style={{ height:26, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:4, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
                  : !hasData
                    ? <EmptyPanel t={t} />
                    : topBranches.map((b,i)=>{
                        const region = branchRegionMap[b.branch_name]
                        const color  = regionColorMap[region] || t.green
                        return (
                          <StatRow key={b.branch_name} delay={i*50}
                            label={b.branch_name}
                            value={`${fmt(b.total_net)}g`}
                            color={color} t={t}
                            bar={Number(b.total_net||0)}
                            barMax={Math.max(...topBranches.map(x=>Number(x.total_net||0)),1)}/>
                        )
                      })
                }
                {/* Bottom 5 — separator + list */}
                {!loading && hasData && bottomBranches.length > 0 && (
                  <>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'22px 0 14px', paddingTop:14, borderTop:`1px solid ${t.border}` }}>
                      <div style={{ ...panelTitle, color:t.red }}>Bottom 5 Branches</div>
                      <div style={panelMeta}>active only</div>
                    </div>
                    {bottomBranches.map((b,i)=>(
                      <StatRow key={b.branch_name} delay={i*50}
                        label={b.branch_name}
                        value={`${fmt(b.total_net)}g`}
                        color={t.red} t={t}
                        bar={Number(b.total_net||0)}
                        barMax={Math.max(...topBranches.map(x=>Number(x.total_net||0)),1)}/>
                    ))}
                  </>
                )}
              </div>}

            </div>}
          </div>
        </div>
      </div>}

      {/* ── CONSIGNMENT OVERVIEW (collapsible) ── */}
      {(canSee('consignment-overview') || canSee('consignment-data') || canSee('consignment-report') || canSee('consignment-analytics')) && (
        <div style={{ marginTop: 12, border:`1px solid ${t.border2}`, borderRadius:20, background:`linear-gradient(160deg,${t.card2},${t.card3})`, boxShadow:`${t.shadow},inset 0 1px 0 rgba(255,255,255,.03)`, position:'relative', overflow:'hidden', transition:'all .35s ease' }}>
          <div style={{ position:'absolute', top:0, left:0, width:160, height:160, background:`radial-gradient(circle at top left,${t.orange}08,transparent 70%)`, pointerEvents:'none' }}/>
          <div onClick={() => setConsignOpen(o => !o)}
            style={{ display:'flex', alignItems:'center', gap: isMobile ? 8 : 14, padding: consignOpen ? (isMobile ? '14px 16px' : '20px 24px') : (isMobile ? '10px 16px' : '12px 24px'), flexWrap:'wrap', position:'relative', zIndex:1, cursor:'pointer', userSelect:'none', borderBottom: consignOpen ? `1px solid ${t.border}` : 'none' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:3, height:20, borderRadius:2, background:`linear-gradient(180deg,${t.orange},${t.orange}40)`, boxShadow:`0 0 8px ${t.orange}60` }}/>
              <div style={{ fontSize:14, color:t.text2, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700 }}>Consignment Overview</div>
            </div>
            {!consignOpen && consignStats && (
              <div style={{ display:'flex', gap: isMobile ? 10 : 22, alignItems:'center', fontSize: isMobile ? 11 : 12, color: t.text3, marginLeft: isMobile ? 0 : 14, flexWrap:'wrap' }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:t.orange, boxShadow:`0 0 6px ${t.orange}` }}/>
                  <strong style={{ color: t.orange, fontWeight: 700, fontFamily:'monospace' }}>{Number(consignStats.branchWeight || 0).toFixed(0)}g</strong>
                  <span style={{ color: t.text4 }}>at branch</span>
                </span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:t.blue, boxShadow:`0 0 6px ${t.blue}` }}/>
                  <strong style={{ color: t.blue, fontWeight: 700, fontFamily:'monospace' }}>{Number(consignStats.movementWeight || 0).toFixed(0)}g</strong>
                  <span style={{ color: t.text4 }}>in movement</span>
                </span>
              </div>
            )}
            <div style={{ marginLeft:'auto', width:28, height:28, borderRadius:8, background:`${t.orange}12`, border:`1px solid ${t.orange}28`, display:'flex', alignItems:'center', justifyContent:'center', color:t.orange, fontSize:11, transition:'transform .35s cubic-bezier(.4,0,.2,1)', transform: consignOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</div>
          </div>
          {consignOpen && (
            <div style={{ padding: isMobile ? '16px 14px 20px' : '24px 28px 28px' }}>
              <ConsignmentBalanceView t={t} stats={consignStats} isMobile={isMobile} />
            </div>
          )}
        </div>
      )}

      {/* ── SALES OVERVIEW (collapsible) ── */}
      {(canSee('cal-table') || canSee('live-market-rates')) && (
        <div style={{ marginTop: 12, border:`1px solid ${t.border2}`, borderRadius:20, background:`linear-gradient(160deg,${t.card2},${t.card3})`, boxShadow:`${t.shadow},inset 0 1px 0 rgba(255,255,255,.03)`, position:'relative', overflow:'hidden', transition:'all .35s ease' }}>
          <div style={{ position:'absolute', top:0, left:0, width:160, height:160, background:`radial-gradient(circle at top left,${t.green}08,transparent 70%)`, pointerEvents:'none' }}/>
          <div onClick={() => setSalesOpen(o => !o)}
            style={{ display:'flex', alignItems:'center', gap: isMobile ? 8 : 14, padding: salesOpen ? (isMobile ? '14px 16px' : '20px 24px') : (isMobile ? '10px 16px' : '12px 24px'), flexWrap:'wrap', position:'relative', zIndex:1, cursor:'pointer', userSelect:'none', borderBottom: salesOpen ? `1px solid ${t.border}` : 'none' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:3, height:20, borderRadius:2, background:`linear-gradient(180deg,${t.green},${t.green}40)`, boxShadow:`0 0 8px ${t.green}60` }}/>
              <div style={{ fontSize:14, color:t.text2, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700 }}>Sales Overview</div>
            </div>
            {!salesOpen && (
              <div style={{ fontSize: isMobile ? 11 : 12, color: t.text3, marginLeft: isMobile ? 0 : 14 }}>
                Live gold rates · Cal Table
              </div>
            )}
            <div style={{ marginLeft:'auto', width:28, height:28, borderRadius:8, background:`${t.green}12`, border:`1px solid ${t.green}28`, display:'flex', alignItems:'center', justifyContent:'center', color:t.green, fontSize:11, transition:'transform .35s cubic-bezier(.4,0,.2,1)', transform: salesOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</div>
          </div>
          {salesOpen && (
            <div style={{ padding: isMobile ? '16px 14px 20px' : '24px 28px 28px' }}>
              <LiveTicker />
              <div style={{ marginTop: 14, display:'flex', gap:8, flexWrap:'wrap' }}>
                {canSee('cal-table') && (
                  <button onClick={() => setActiveNav('cal-table')}
                    style={{ padding:'8px 16px', borderRadius:9, background:`${t.gold}15`, border:`1px solid ${t.gold}35`, color:t.gold, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                    Cal Table →
                  </button>
                )}
                {canSee('live-market-rates') && (
                  <button onClick={() => setActiveNav('live-market-rates')}
                    style={{ padding:'8px 16px', borderRadius:9, background:`${t.green}15`, border:`1px solid ${t.green}35`, color:t.green, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                    Live Market Rates →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ROADMAP ── */}
      <div style={{ marginTop:20, background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:16, padding:'20px 28px', boxShadow:t.shadow }}>
        <div style={{ fontSize:12, color:t.text3, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600, marginBottom:14 }}>Roadmap</div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {[
            { label:'Melting',          phase:'Phase 2', color:t.orange },
            { label:'Sales',            phase:'Phase 3', color:t.purple },
            { label:'ClawdBot AI',      phase:'Phase 4', color:t.blue   },
            { label:'Advanced Reports', phase:'Phase 5', color:t.green  },
          ].map(item=>(
            <div key={item.label} style={{ padding:'9px 18px', borderRadius:10, background:`linear-gradient(135deg,${item.color}14,${item.color}07)`, border:`1px solid ${item.color}32`, display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:13, color:item.color, fontWeight:600 }}>{item.label}</span>
              <span style={{ fontSize:11, color:t.text4, padding:'2px 8px', borderRadius:100, background:t.card2, border:`1px solid ${t.border}` }}>{item.phase}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
} 