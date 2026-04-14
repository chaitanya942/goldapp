'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fmt, fmtVal, getStyles } from './reportUtils'
import { supabase } from '../../../lib/supabase'

// ─────────────────────────────────────────────
// EXPAND PANEL — portal-based so fixed positioning works correctly
// ─────────────────────────────────────────────
function Panel({ id, expanded, onExpand, onClose, t, cardStyle = {}, noExpand = false, children }) {
  const isExp = !noExpand && expanded === id
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!isExp) return
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [isExp, onClose])

  const modal = isExp && mounted ? createPortal(
    <>
      <style>{`@keyframes panelPop{from{opacity:0;transform:translate(-50%,-47%) scale(.94)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', cursor: 'pointer' }} />
      <div style={{ ...cardStyle, position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(1200px,96vw)', maxHeight: '90vh', overflowY: 'auto', zIndex: 9999, cursor: 'default', boxShadow: '0 32px 80px rgba(0,0,0,0.9)', animation: 'panelPop .22s cubic-bezier(.34,1.3,.64,1)' }}>
        <button onClick={onClose} style={{ position: 'sticky', top: 0, float: 'right', background: 'transparent', border: 'none', color: t.text3, fontSize: '1.1rem', cursor: 'pointer', padding: '0 0 8px 12px', lineHeight: 1, zIndex: 2 }}>✕</button>
        {children}
      </div>
    </>,
    document.body
  ) : null

  return (
    <>
      <div onClick={() => !noExpand && !isExp && onExpand(id)} style={{ ...cardStyle, cursor: noExpand ? 'default' : 'pointer' }}>
        {children}
      </div>
      {modal}
    </>
  )
}

// ─────────────────────────────────────────────
// REGION COLORS — fixed palette
// ─────────────────────────────────────────────
const REGION_COLORS = [
  '#c9a84c', '#3a8fbf', '#8c5ac8', '#3aaa6a', '#4ac8c8',
  '#e05555', '#c9981f', '#c84a8c', '#6abf5e', '#bf6a3a',
]

// Preferred order — determines which color index each region gets.
// Regions at position 0 get REGION_COLORS[0] (gold), position 1 gets blue, etc.
// This is stable: adding new data never shifts existing region colors.
const REGION_PRIORITY = [
  'Bangalore', 'Kerala', 'Rest of Karnataka',
  'Andhra Pradesh', 'Telangana', 'Tamil Nadu',
  'Maharashtra', 'Rajasthan', 'Gujarat', 'Unknown',
]

function buildRegionColors(names) {
  const map = {}
  let nextIdx = 0
  // Assign colors in priority order first
  REGION_PRIORITY.forEach(r => {
    if (names.includes(r)) map[r] = REGION_COLORS[nextIdx++ % REGION_COLORS.length]
  })
  // Then assign any region not in the priority list
  names.forEach(r => {
    if (!map[r]) map[r] = REGION_COLORS[nextIdx++ % REGION_COLORS.length]
  })
  return map
}

// ─────────────────────────────────────────────
// DONUT CHART — region net weight split
// ─────────────────────────────────────────────
function RegionDonut({ branchData, t }) {
  const [hovered, setHovered] = useState(null)

  const regionMap = {}
  ;(branchData || []).forEach(b => {
    const r = b.region || 'Unknown'
    regionMap[r] = (regionMap[r] || 0) + Number(b.total_net || 0)
  })
  const regions = Object.entries(regionMap).sort((a, b) => b[1] - a[1])
  const total   = regions.reduce((s, [, v]) => s + v, 0)
  const colorMap = buildRegionColors(regions.map(([name]) => name))

  const cx = 130, cy = 130, r = 100, sw = 32, circ = 2 * Math.PI * r
  let offset = 0
  const slices = regions.map(([name, val]) => {
    const pct  = total > 0 ? val / total : 0
    const dash = pct * circ
    const slice = { name, val, pct, color: colorMap[name], offset, dash }
    offset += dash
    return slice
  })

  const hov    = hovered != null ? slices[hovered] : null
  const maxVal = slices[0]?.val || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
      <svg width="260" height="260">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.border} strokeWidth={sw} />
        {[...slices].reverse().map((sl, ri) => {
          const i    = slices.length - 1 - ri
          const d    = Math.max(0, sl.dash - 2)
          const gap  = circ - d
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={sl.color} strokeWidth={hovered === i ? sw + 5 : sw}
              strokeDasharray={`${d} ${gap}`}
              strokeDashoffset={-sl.offset + circ / 4}
              style={{ cursor: 'pointer', transition: 'stroke-width .15s' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )
        })}
        {hov ? (
          <>
            <text x={cx} y={cy - 14} textAnchor="middle" fill={hov.color} fontSize="22" fontWeight="700">{(hov.pct * 100).toFixed(1)}%</text>
            <text x={cx} y={cy + 8}  textAnchor="middle" fill={t.text2} fontSize="11">{hov.name}</text>
            <text x={cx} y={cy + 24} textAnchor="middle" fill={t.text3} fontSize="10">{fmt(hov.val)}g</text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 8}  textAnchor="middle" fill={t.text1} fontSize="18" fontWeight="600">{fmt(total)}g</text>
            <text x={cx} y={cy + 12} textAnchor="middle" fill={t.text3} fontSize="10">Total Net Wt</text>
          </>
        )}
      </svg>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {slices.map((sl, i) => (
          <div key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'default', opacity: hovered != null && hovered !== i ? 0.35 : 1, transition: 'opacity .15s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: sl.color, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: '.72rem', color: t.text1, fontWeight: 400 }}>
                {sl.name}
                {sl.name === 'Unknown' && <span style={{ marginLeft: '6px', fontSize: '.6rem', color: '#c9a84c', opacity: .7 }}>⚠ branches missing region</span>}
              </div>
              <div style={{ fontSize: '.72rem', color: sl.color, fontWeight: 500 }}>{fmt(sl.val)}g</div>
              <div style={{ width: '42px', textAlign: 'right', fontSize: '.65rem', color: t.text3 }}>{(sl.pct * 100).toFixed(1)}%</div>
            </div>
            <div style={{ height: '4px', background: t.border, borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(sl.val / maxVal) * 100}%`, background: sl.color, borderRadius: '2px', transition: 'width .4s' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// BRANCH BILLS MODAL
// ─────────────────────────────────────────────
function BranchBillsModal({ branch, branchInfo, color, t, fromDate, toDate, filterTxn, onClose }) {
  const [bills, setBills]     = useState([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!branch) return
    setLoading(true)
    let q = supabase.from('purchases')
      .select('purchase_date, customer_name, phone_number, application_id, gross_weight, net_weight, purity, total_amount, transaction_type')
      .eq('branch_name', branch)
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
    if (fromDate)  q = q.gte('purchase_date', fromDate)
    if (toDate)    q = q.lte('purchase_date', toDate)
    if (filterTxn) q = q.eq('transaction_type', filterTxn)
    q.order('purchase_date', { ascending: false })
      .then(({ data }) => { setBills(data || []); setLoading(false) })
  }, [branch])

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const totalNet = bills.reduce((s, b) => s + Number(b.net_weight || 0), 0)
  const totalVal = bills.reduce((s, b) => s + Number(b.total_amount || 0), 0)

  if (!mounted) return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', cursor: 'pointer' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 9999, width: 'min(1400px, 98vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: t.card, border: `1px solid ${color}40`, borderRadius: '16px', boxShadow: `0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px ${color}20` }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: color }} />
                <div style={{ fontSize: '1.3rem', color: t.text1, fontWeight: 500 }}>{branch}</div>
              </div>
              <div style={{ fontSize: '.75rem', color: t.text3 }}>{branchInfo?.region} · {branchInfo?.state} · {branchInfo?.cluster}</div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: '1rem', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
          </div>
          {!loading && (
            <div style={{ display: 'flex', gap: '24px', marginTop: '14px' }}>
              {[
                { label: 'Total Bills',  value: bills.length.toLocaleString('en-IN'), color: t.text1 },
                { label: 'Total Net Wt', value: `${fmt(totalNet)}g`,                   color: t.gold  },
                { label: 'Total Value',  value: fmtVal(totalVal),                       color: t.green },
                { label: 'Avg Purity',   value: `${(bills.reduce((s,b)=>s+Number(b.purity||0)*Number(b.net_weight||0),0)/Math.max(totalNet,1)).toFixed(1)}%`, color: t.purple },
                { label: 'Physical',     value: bills.filter(b=>b.transaction_type==='PHYSICAL').length, color: t.gold },
                { label: 'Takeover',     value: bills.filter(b=>b.transaction_type==='TAKEOVER').length, color: t.blue },
              ].map(({ label, value, color: c }) => (
                <div key={label}>
                  <div style={{ fontSize: '1rem', color: c, fontWeight: 500 }}>{value}</div>
                  <div style={{ fontSize: '.6rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '3px' }}>{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: t.text4, fontSize: '.75rem' }}>Loading bills…</div>
          ) : bills.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: t.text4, fontSize: '.75rem' }}>No bills found</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: t.card, zIndex: 1 }}>
                <tr>
                  {['#', 'Date', 'Customer', 'Phone', 'App ID', 'Gross Wt', 'Net Wt', 'Purity', 'Gross Value', 'Svc %', 'Final Amt', 'Type', 'Status'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', fontSize: '.6rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.1em', textAlign: h === '#' ? 'center' : 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bills.map((b, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}15` }}
                    onMouseEnter={e => e.currentTarget.style.background = `${color}12`}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}15`}>
                    <td style={{ padding: '11px 14px', fontSize: '.72rem', color: t.text4, textAlign: 'center' }}>{i + 1}</td>
                    <td style={{ padding: '11px 14px', fontSize: '.75rem', color: t.text2, whiteSpace: 'nowrap' }}>{b.purchase_date ? new Date(b.purchase_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: '.78rem', color: t.text1, fontWeight: 400 }}>{b.customer_name || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: '.72rem', color: t.text3 }}>{b.phone_number || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: '.68rem', color: t.text4, fontFamily: 'monospace' }}>{b.application_id || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: '.75rem', color: t.text2, textAlign: 'right' }}>{Number(b.gross_weight||0).toFixed(2)}g</td>
                    <td style={{ padding: '11px 14px', fontSize: '.78rem', color: t.gold, textAlign: 'right', fontWeight: 500 }}>{Number(b.net_weight||0).toFixed(2)}g</td>
                    <td style={{ padding: '11px 14px', fontSize: '.75rem', color: t.purple, textAlign: 'right' }}>{Number(b.purity||0).toFixed(1)}%</td>
                    <td style={{ padding: '11px 14px', fontSize: '.78rem', color: t.green, textAlign: 'right', fontWeight: 400 }}>{fmtVal(b.total_amount)}</td>
                    <td style={{ padding: '11px 14px', fontSize: '.75rem', color: t.orange, textAlign: 'right' }}>{Number(b.service_charge_pct||0).toFixed(2)}%</td>
                    <td style={{ padding: '11px 14px', fontSize: '.75rem', color: t.text2, textAlign: 'right' }}>{fmtVal(b.final_amount_crm)}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      <span style={{ fontSize: '.68rem', padding: '3px 9px', borderRadius: '4px', fontWeight: 600, background: b.transaction_type === 'PHYSICAL' ? `${t.gold}25` : `${t.blue}25`, color: b.transaction_type === 'PHYSICAL' ? t.gold : t.blue }}>
                        {b.transaction_type === 'PHYSICAL' ? 'PHY' : 'TKO'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: '.7rem', color: t.text4 }}>{b.stock_status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

// ─────────────────────────────────────────────
// BRANCH HEATMAP GRID
// ─────────────────────────────────────────────
function BranchHeatmap({ branchData, allBranchMeta, metric, t, fromDate, toDate, filterTxn }) {
  const [hovered,        setHovered]        = useState(null)
  const [selectedBranch, setSelectedBranch] = useState(null)

  // Merge transaction data with full branch list so zero-txn branches appear
  const branchDataMap = {}
  ;(branchData || []).forEach(b => { branchDataMap[b.branch_name] = b })
  const zeroBranches = (allBranchMeta || [])
    .filter(m => !branchDataMap[m.name])
    .map(m => ({ branch_name: m.name, region: m.region || 'Unknown', state: m.state || 'Unknown', cluster: m.cluster || null, txn_count: 0, physical_count: 0, total_net: 0, total_value: 0, avg_purity: 0 }))

  const regions = [...new Set([...(branchData || []), ...zeroBranches].map(b => b.region || 'Unknown'))]
  const regionColors = buildRegionColors(regions)

  const sorted = [
    ...[...(branchData || [])].sort((a, b) => Number(b[metric]) - Number(a[metric])),
    ...zeroBranches.sort((a, b) => a.branch_name.localeCompare(b.branch_name)),
  ]

  const maxVal = Number(sorted[0]?.[metric] || 1)

  const metricLabel = (b) => {
    if (metric === 'total_net')   return `${fmt(b[metric])}g`
    if (metric === 'total_value') return fmtVal(b[metric])
    return Number(b[metric]).toLocaleString('en-IN')
  }

  const hov          = hovered ? sorted.find(b => b.branch_name === hovered) : null
  const selectedInfo = selectedBranch ? sorted.find(b => b.branch_name === selectedBranch) : null
  const selectedColor = selectedInfo ? regionColors[selectedInfo.region || 'Unknown'] : '#c9a84c'

  return (
    <div>
      {selectedBranch && (
        <BranchBillsModal
          branch={selectedBranch}
          branchInfo={selectedInfo}
          color={selectedColor}
          t={t}
          fromDate={fromDate}
          toDate={toDate}
          filterTxn={filterTxn}
          onClose={() => setSelectedBranch(null)}
        />
      )}

      <div style={{ height: '44px', marginBottom: '12px', background: hov ? `${regionColors[hov.region || 'Unknown']}18` : 'transparent', border: `1px solid ${hov ? regionColors[hov.region || 'Unknown'] + '40' : 'transparent'}`, borderRadius: '8px', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '20px', transition: 'all .2s' }}>
        {hov ? (
          <>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: regionColors[hov.region || 'Unknown'], flexShrink: 0 }} />
            <div style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500, minWidth: '140px' }}>{hov.branch_name}</div>
            <div style={{ fontSize: '.65rem', color: t.text3 }}>{hov.region} · {hov.state}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px' }}>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: '.65rem', color: t.gold }}>{fmt(hov.total_net)}g</div><div style={{ fontSize: '.5rem', color: t.text3, textTransform: 'uppercase' }}>Net Wt</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: '.65rem', color: t.green }}>{fmtVal(hov.total_value)}</div><div style={{ fontSize: '.5rem', color: t.text3, textTransform: 'uppercase' }}>Value</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: '.65rem', color: t.blue }}>{Number(hov.txn_count).toLocaleString('en-IN')}</div><div style={{ fontSize: '.5rem', color: t.text3, textTransform: 'uppercase' }}>Txns</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: '.65rem', color: t.purple }}>{Number(hov.avg_purity).toFixed(1)}%</div><div style={{ fontSize: '.5rem', color: t.text3, textTransform: 'uppercase' }}>Purity</div></div>
            </div>
            <div style={{ fontSize: '.62rem', color: t.text3, borderLeft: `1px solid ${t.border}`, paddingLeft: '16px' }}>click to view bills</div>
          </>
        ) : (
          <div style={{ fontSize: '.62rem', color: t.text3 }}>Hover a branch · click to view all bills</div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '6px' }}>
        {sorted.map((b, i) => {
          const color    = regionColors[b.region || 'Unknown']
          const hasData  = b.txn_count > 0
          const pct      = hasData && maxVal > 0 ? Number(b[metric]) / maxVal : 0
          const isHov    = hovered === b.branch_name
          const phPct    = hasData ? (b.physical_count / b.txn_count) * 100 : 0
          const opacity  = hasData ? 0.25 + pct * 0.75 : 0
          return (
            <div key={i}
              onMouseEnter={() => setHovered(b.branch_name)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelectedBranch(b.branch_name)}
              style={{
                background: hasData
                  ? `${color}${Math.round(opacity * 255).toString(16).padStart(2,'0')}`
                  : t.border2,
                border: `1px solid ${isHov ? color : hasData ? color + '30' : t.border}`,
                borderRadius: '6px', padding: '8px 7px',
                cursor: 'pointer', transition: 'border-color .15s, transform .15s',
                transform: isHov ? 'translateY(-2px)' : 'none',
              }}>
              {hasData && <div style={{ fontSize: '.55rem', color: 'rgba(255,255,255,0.85)', fontWeight: 700, marginBottom: '3px' }}>#{i + 1}</div>}
              <div style={{ fontSize: '.65rem', color: hasData ? '#ffffff' : t.text4, fontWeight: hasData ? 700 : 400, lineHeight: 1.2, marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: hasData ? '0 1px 3px rgba(0,0,0,0.5)' : 'none' }}>{b.branch_name}</div>
              <div style={{ fontSize: '.65rem', color: hasData ? '#ffffff' : t.text4, fontWeight: 500, marginBottom: '5px', textShadow: hasData ? '0 1px 3px rgba(0,0,0,0.5)' : 'none' }}>{hasData ? metricLabel(b) : 'No txns'}</div>
              <div style={{ height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                {hasData && <div style={{ height: '100%', width: `${phPct}%`, background: 'rgba(255,255,255,0.7)', borderRadius: '2px' }} />}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '14px', paddingTop: '12px', borderTop: `1px solid ${t.border}` }}>
        {regions.map(r => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: regionColors[r] }} />
            <span style={{ fontSize: '.6rem', color: t.text3 }}>{r}</span>
          </div>
        ))}
        <span style={{ fontSize: '.58rem', color: t.text4, marginLeft: 'auto' }}>bar = physical % · opacity = relative rank · click any branch to view bills</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// SCATTER CHART
// ─────────────────────────────────────────────
function ScatterChart({ branchData, t, fromDate, toDate, filterTxn }) {
  const [hovered,        setHovered]        = useState(null)
  const [activeRegion,   setActiveRegion]   = useState(null)
  const [selectedBranch, setSelectedBranch] = useState(null)
  const W = 740, H = 320, PL = 58, PR = 24, PT = 20, PB = 44

  const regions      = [...new Set((branchData || []).map(b => b.region || 'Unknown'))]
  const regionColors = buildRegionColors(regions)

  const points  = (branchData || []).filter(b => b.total_net > 0 && b.avg_purity > 0)
  const maxTxns = Math.max(...points.map(b => Number(b.txn_count)))

  const minPurity = Math.min(...points.map(b => Number(b.avg_purity)))
  const maxPurity = Math.max(...points.map(b => Number(b.avg_purity)))

  // Log scale for X to spread the dense cluster
  const nets    = points.map(b => Number(b.total_net))
  const logMin  = Math.log10(Math.max(1, Math.min(...nets)))
  const logMax  = Math.log10(Math.max(1, Math.max(...nets)))

  const chartW = W - PL - PR
  const chartH = H - PT - PB

  const bx = (b) => PL + ((Math.log10(Math.max(1, Number(b.total_net))) - logMin) / ((logMax - logMin) || 1)) * chartW
  const by = (b) => PT + chartH - ((Number(b.avg_purity) - minPurity) / ((maxPurity - minPurity) || 1)) * chartH
  const br = (b) => Math.max(5, Math.min(20, (Number(b.txn_count) / maxTxns) * 17 + 5))

  // Y ticks
  const yTicks = 5
  const yRange = maxPurity - minPurity || 1

  // X ticks — log-spaced
  const xTickVals = Array.from({ length: 6 }, (_, i) => Math.pow(10, logMin + (i / 5) * (logMax - logMin)))

  const hovBranch = hovered ? points.find(b => b.branch_name === hovered) : null
  const selColor  = selectedBranch ? (regionColors[(points.find(b => b.branch_name === selectedBranch)?.region) || 'Unknown'] || t.gold) : t.gold

  return (
    <div style={{ width: '100%' }}>
      {selectedBranch && (
        <BranchBillsModal
          branch={selectedBranch}
          branchInfo={points.find(b => b.branch_name === selectedBranch)}
          color={selColor}
          t={t}
          fromDate={fromDate}
          toDate={toDate}
          filterTxn={filterTxn}
          onClose={() => setSelectedBranch(null)}
        />
      )}

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Y grid + labels */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minPurity + (yRange / yTicks) * i
          const y   = PT + chartH - (i / yTicks) * chartH
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={t.border} strokeWidth="1" strokeDasharray="3 4" />
              <text x={PL - 6} y={y + 4} textAnchor="end" fontSize="9" fill={t.text3}>{val.toFixed(1)}%</text>
            </g>
          )
        })}

        {/* X grid + labels (log-spaced) */}
        {xTickVals.map((val, i) => {
          const x = PL + ((Math.log10(Math.max(1, val)) - logMin) / ((logMax - logMin) || 1)) * chartW
          return (
            <g key={i}>
              <line x1={x} y1={PT} x2={x} y2={PT + chartH} stroke={t.border} strokeWidth="1" strokeDasharray="3 4" />
              <text x={x} y={PT + chartH + 14} textAnchor="middle" fontSize="9" fill={t.text3}>{Math.round(val)}g</text>
            </g>
          )
        })}

        {/* Axes */}
        <line x1={PL} y1={PT} x2={PL} y2={PT + chartH} stroke={t.border2} strokeWidth="1.5" />
        <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke={t.border2} strokeWidth="1.5" />
        <text x={PL + chartW / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={t.text4}>Net Weight (g) — log scale</text>
        <text x={11} y={PT + chartH / 2} textAnchor="middle" fontSize="9" fill={t.text4} transform={`rotate(-90 11 ${PT + chartH / 2})`}>Avg Purity %</text>

        {/* Bubbles — hovered on top */}
        {[...points.filter(b => b.branch_name !== hovered), ...points.filter(b => b.branch_name === hovered)].map((b) => {
          const x       = bx(b), y = by(b), radius = br(b)
          const color   = regionColors[b.region || 'Unknown']
          const isHov   = hovered === b.branch_name
          const dimmed  = (activeRegion && b.region !== activeRegion) || (hovered && !isHov)
          const tipW = 190, tipH = 62
          const tipX = x + radius + 8 + tipW > W ? x - radius - 8 - tipW : x + radius + 8
          const tipY = Math.max(PT, Math.min(PT + chartH - tipH, y - tipH / 2))
          return (
            <g key={b.branch_name}
              onMouseEnter={() => setHovered(b.branch_name)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelectedBranch(b.branch_name)}
              style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y}
                r={isHov ? radius + 3 : radius}
                fill={color}
                opacity={dimmed ? 0.1 : isHov ? 1 : 0.72}
                stroke={isHov ? '#fff' : color}
                strokeWidth={isHov ? 2 : 0.8}
                strokeOpacity={dimmed ? 0 : 0.5}
                style={{ transition: 'opacity .15s' }} />
              {isHov && (
                <g>
                  <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="6"
                    fill={t.card} stroke={color} strokeWidth="1.5"
                    style={{ filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.5))' }} />
                  <text x={tipX + 10} y={tipY + 17} fontSize="10.5" fill={t.text1} fontWeight="700">{b.branch_name}</text>
                  <text x={tipX + 10} y={tipY + 32} fontSize="9" fill={color}>{b.region}</text>
                  <text x={tipX + 10} y={tipY + 47} fontSize="9" fill={t.text3}>
                    {fmt(b.total_net)}g net · {Number(b.avg_purity).toFixed(1)}% purity · {b.txn_count} txns
                  </text>
                  <text x={tipX + 10} y={tipY + 58} fontSize="8" fill={t.text4}>click to view bills</text>
                </g>
              )}
            </g>
          )
        })}
      </svg>

      {/* Interactive legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
        {regions.map(r => {
          const active = activeRegion === r
          return (
            <div key={r}
              onClick={() => setActiveRegion(active ? null : r)}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', padding: '3px 8px', borderRadius: '20px', border: `1px solid ${active ? regionColors[r] : 'transparent'}`, background: active ? `${regionColors[r]}18` : 'transparent', opacity: activeRegion && !active ? 0.4 : 1, transition: 'all .15s' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: regionColors[r] }} />
              <span style={{ fontSize: '.65rem', color: active ? regionColors[r] : t.text3, fontWeight: active ? 600 : 400 }}>{r}</span>
            </div>
          )
        })}
        <span style={{ fontSize: '.6rem', color: t.text4, marginLeft: '4px' }}>● size = txn count · click region to highlight</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// SECTION TITLE
// ─────────────────────────────────────────────
function SectionTitle({ title, t, badge, noMargin }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: noMargin ? 0 : '14px' }}>
      <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 500 }}>{title}</div>
      {badge && <div style={{ fontSize: '.48rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', background: t.border, padding: '2px 6px', borderRadius: '4px' }}>{badge}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
export default function ReportBranches({ branchData, allBranchMeta, stateData, topBills, t, fromDate, toDate, filterTxn }) {
  const [topMetric,        setTopMetric]        = useState('total_net')
  const [branchSort,       setBranchSort]        = useState('total_net')
  const [treemetric,       setTreeMetric]        = useState('total_net')
  const [drillState,       setDrillState]        = useState(null)
  const [drillRegion,      setDrillRegion]       = useState(null)
  const [drillCluster,     setDrillCluster]      = useState(null)
  const [topBillsRegion,   setTopBillsRegion]    = useState('')
  const [expanded,         setExpanded]          = useState(null)
  const openPanel  = (id) => setExpanded(id)
  const closePanel = () => setExpanded(null)

  const s = getStyles(t || {})
  if (!t) return null
  const P = (id, extra = {}) => ({ id, expanded, onExpand: openPanel, onClose: closePanel, t, cardStyle: { ...s.card, marginBottom: 0, ...extra } })

  // ── DRILLDOWN: derive state + region summaries from branchData ──
  const stateMap = {}
  ;(branchData || []).forEach(b => {
    const st = b.state || 'Unknown'
    if (!stateMap[st]) stateMap[st] = { state: st, total_net: 0, total_gross: 0, total_value: 0, txn_count: 0, physical_count: 0, takeover_count: 0, branch_names: new Set() }
    stateMap[st].total_net      += Number(b.total_net    || 0)
    stateMap[st].total_gross    += Number(b.total_gross  || 0)
    stateMap[st].total_value    += Number(b.total_value  || 0)
    stateMap[st].txn_count      += Number(b.txn_count    || 0)
    stateMap[st].physical_count += Number(b.physical_count  || 0)
    stateMap[st].takeover_count += Number(b.takeover_count  || 0)
    stateMap[st].branch_names.add(b.branch_name)
  })
  const derivedStates = Object.values(stateMap)
    .map(s2 => ({ ...s2, branch_count: s2.branch_names.size }))
    .sort((a, b) => b.total_net - a.total_net)

  // Region summaries for selected state
  const regionMap = {}
  ;(branchData || []).filter(b => !drillState || b.state === drillState).forEach(b => {
    const rg = b.region || 'Unknown'
    if (!regionMap[rg]) regionMap[rg] = { region: rg, total_net: 0, total_gross: 0, total_value: 0, txn_count: 0, physical_count: 0, takeover_count: 0, branch_names: new Set() }
    regionMap[rg].total_net      += Number(b.total_net    || 0)
    regionMap[rg].total_gross    += Number(b.total_gross  || 0)
    regionMap[rg].total_value    += Number(b.total_value  || 0)
    regionMap[rg].txn_count      += Number(b.txn_count    || 0)
    regionMap[rg].physical_count += Number(b.physical_count  || 0)
    regionMap[rg].takeover_count += Number(b.takeover_count  || 0)
    regionMap[rg].branch_names.add(b.branch_name)
  })
  const derivedRegions = Object.values(regionMap)
    .map(r2 => ({ ...r2, branch_count: r2.branch_names.size }))
    .sort((a, b) => b.total_net - a.total_net)

  // Filtered branches for table (shown only when region is selected)
  const drillBranches = (branchData || []).filter(b => {
    if (drillCluster) return b.cluster === drillCluster && b.region === drillRegion
    if (drillRegion)  return b.region  === drillRegion
    if (drillState)   return b.state   === drillState
    return true
  })
  const sortedBranches = [...drillBranches].sort((a, b) => b[branchSort] - a[branchSort])
  const top10          = [...(branchData || [])].sort((a, b) => b[topMetric] - a[topMetric]).slice(0, 10)

  // Region options for selected state
  const regions = [...new Set(
    (branchData || [])
      .filter(b => drillState ? b.state === drillState : true)
      .map(b => b.region)
      .filter(Boolean)
  )]

  // Cluster options for selected region
  const clusters = [...new Set(
    (branchData || [])
      .filter(b => drillRegion ? b.region === drillRegion : true)
      .map(b => b.cluster)
      .filter(Boolean)
  )]

  const pill = (active) => ({
    padding: '4px 12px', borderRadius: '20px', fontSize: '.62rem', cursor: 'pointer', border: 'none',
    background: active ? t.gold : t.border, color: active ? '#000' : t.text3, fontWeight: active ? 500 : 400,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── ROW 1: DONUT + TOP 10 BILLS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        <Panel {...P('region-donut')}>
          <SectionTitle title="Region-wise Net Weight Split" t={t} />
          <RegionDonut branchData={branchData} t={t} />
        </Panel>

        <Panel {...P('top-bills')}>
          {(() => {
            const allRegions   = [...new Set((topBills || []).map(b => b.region).filter(Boolean))].sort()
            const filtered     = (topBills || []).filter(b => !topBillsRegion || b.region === topBillsRegion).slice(0, 10)
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' }}>
                  <SectionTitle title="Top 10 Bills" t={t} badge="by net weight" noMargin />
                  {allRegions.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '.58rem', color: t.text4 }}>Region</span>
                      <select
                        value={topBillsRegion}
                        onChange={e => setTopBillsRegion(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{ background: t.card2 || t.card, border: `1px solid ${topBillsRegion ? t.gold + '80' : t.border}`, borderRadius: '7px', padding: '4px 10px', color: topBillsRegion ? t.gold : t.text3, fontSize: '.62rem', cursor: 'pointer', outline: 'none' }}
                      >
                        <option value="">All Regions</option>
                        {allRegions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {topBillsRegion && (
                        <button onClick={e => { e.stopPropagation(); setTopBillsRegion('') }} style={{ background: 'none', border: 'none', color: t.text4, fontSize: '.72rem', cursor: 'pointer', padding: '0 2px' }}>✕</button>
                      )}
                    </div>
                  )}
                </div>
                {filtered.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 90px 70px 55px 65px 60px', gap: '0 8px', padding: '0 0 8px 0', borderBottom: `1px solid ${t.border}`, marginBottom: '2px' }}>
                      {['#', 'Branch · Customer', 'Gross Value', 'Net Wt', 'Purity', 'Type', 'Date'].map(h => (
                        <div key={h} style={{ fontSize: '.55rem', color: t.text2, textTransform: 'uppercase', letterSpacing: '.08em', textAlign: ['Gross Value','Net Wt','Purity','Type','Date'].includes(h) ? 'right' : 'left' }}>{h}</div>
                      ))}
                    </div>
                    {filtered.map((b, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '20px 1fr 90px 70px 55px 65px 60px', gap: '0 8px', padding: '9px 0', borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}40` : 'none', alignItems: 'center' }}>
                        <div style={{ fontSize: '.68rem', color: t.text3, fontWeight: 500 }}>{i + 1}</div>
                        <div>
                          <div style={{ fontSize: '.75rem', color: t.gold, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.branch_name}</div>
                          <div style={{ fontSize: '.65rem', color: t.text2, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.customer_name || '—'}</div>
                        </div>
                        <div style={{ fontSize: '.72rem', color: t.green, textAlign: 'right', fontWeight: 500 }}>{fmtVal(b.total_amount)}</div>
                        <div style={{ fontSize: '.75rem', color: t.gold, textAlign: 'right', fontWeight: 500 }}>{Number(b.net_weight || 0).toFixed(2)}g</div>
                        <div style={{ fontSize: '.72rem', color: t.purple, textAlign: 'right', fontWeight: 400 }}>{Number(b.purity || 0).toFixed(1)}%</div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '.6rem', padding: '3px 7px', borderRadius: '4px', fontWeight: 600, background: b.transaction_type === 'PHYSICAL' ? `${t.gold}25` : `${t.blue}25`, color: b.transaction_type === 'PHYSICAL' ? t.gold : t.blue }}>
                            {b.transaction_type === 'PHYSICAL' ? 'PHY' : 'TKO'}
                          </span>
                        </div>
                        <div style={{ fontSize: '.65rem', color: t.text2, textAlign: 'right' }}>{b.purchase_date ? new Date(b.purchase_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ textAlign: 'center', color: t.text4, padding: '40px', fontSize: '.75rem' }}>No data for selected region</div>}
              </>
            )
          })()}
        </Panel>
      </div>

      {/* ── TOP 10 BY METRIC ── */}
      {(() => {
        const allRegionsTop = [...new Set((branchData || []).map(b => b.region).filter(Boolean))].sort()
        const top10RegionColors = buildRegionColors(allRegionsTop)
        const [top10Region, setTop10Region] = [drillRegion, setDrillRegion]
        const filteredTop10 = top10Region
          ? [...(branchData || [])].filter(b => b.region === top10Region).sort((a, b) => b[topMetric] - a[topMetric]).slice(0, 10)
          : top10
        const subMetric = topMetric === 'total_net' ? 'txn_count' : topMetric === 'total_value' ? 'total_net' : 'total_net'
        const subLabel  = topMetric === 'total_net' ? 'txns' : topMetric === 'total_value' ? 'net wt' : 'net wt'
        return (
          <Panel {...P('top10')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 500 }}>Top 10 Branches</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {allRegionsTop.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '.58rem', color: t.text4 }}>Region</span>
                    <select
                      value={top10Region || ''}
                      onChange={e => { e.stopPropagation(); setTop10Region(e.target.value || null) }}
                      onClick={e => e.stopPropagation()}
                      style={{ background: t.card2 || t.card, border: `1px solid ${top10Region ? t.gold + '80' : t.border}`, borderRadius: '7px', padding: '4px 10px', color: top10Region ? t.gold : t.text3, fontSize: '.62rem', cursor: 'pointer', outline: 'none' }}
                    >
                      <option value="">All Regions</option>
                      {allRegionsTop.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {top10Region && (
                      <button onClick={e => { e.stopPropagation(); setTop10Region(null) }} style={{ background: 'none', border: 'none', color: t.text4, fontSize: '.72rem', cursor: 'pointer', padding: '0 2px' }}>✕</button>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[['Net Wt', 'total_net'], ['Value', 'total_value'], ['Txns', 'txn_count']].map(([l, v]) => (
                    <button key={v} style={pill(topMetric === v)} onClick={(e) => { e.stopPropagation(); setTopMetric(v) }}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
            {filteredTop10.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredTop10.map((b, i) => {
                  const max         = filteredTop10[0]?.[topMetric] || 1
                  const w           = (b[topMetric] / max) * 100
                  const barColor    = top10RegionColors[b.region] || t.gold
                  const metricLabel = topMetric === 'total_net'   ? `${fmt(b[topMetric])}g`
                                    : topMetric === 'total_value' ? fmtVal(b[topMetric])
                                    : Number(b[topMetric]).toLocaleString('en-IN')
                  const subVal      = subMetric === 'txn_count'
                                    ? `${Number(b.txn_count).toLocaleString('en-IN')} ${subLabel}`
                                    : `${fmt(b.total_net)}g ${subLabel}`
                  const isTop3      = i < 3
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Rank badge */}
                      <div style={{
                        width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isTop3 ? `${barColor}25` : t.border2,
                        border: isTop3 ? `1px solid ${barColor}70` : 'none',
                        fontSize: '.58rem', fontWeight: 700,
                        color: isTop3 ? barColor : t.text4,
                      }}>{i + 1}</div>

                      {/* Branch name + sub */}
                      <div style={{ width: '150px', flexShrink: 0 }}>
                        <div style={{ fontSize: '.72rem', color: t.text1, fontWeight: isTop3 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.branch_name}</div>
                        <div style={{ fontSize: '.55rem', color: t.text4, marginTop: '1px' }}>{b.region || b.state || '—'} · {subVal}</div>
                      </div>

                      {/* Bar track */}
                      <div style={{ flex: 1, position: 'relative', height: '20px', background: t.border2, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${w}%`, background: `linear-gradient(90deg, ${barColor}55, ${barColor}cc)`, borderRadius: '4px', transition: 'width .5s ease' }} />
                      </div>

                      {/* Value label — always visible outside bar */}
                      <div style={{ width: '72px', flexShrink: 0, textAlign: 'right', fontSize: '.68rem', color: t.text1, fontWeight: 600 }}>
                        {metricLabel}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : <div style={{ textAlign: 'center', color: t.text4, padding: '40px', fontSize: '.75rem' }}>No data</div>}
          </Panel>
        )
      })()}

      {/* ── BRANCH HEATMAP ── */}
      <Panel {...P('treemap')} noExpand={true}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 500 }}>All Branches — Performance Heatmap</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[['Net Wt', 'total_net'], ['Value', 'total_value'], ['Txns', 'txn_count']].map(([l, v]) => (
              <button key={v} style={pill(treemetric === v)} onClick={(e) => { e.stopPropagation(); setTreeMetric(v) }}>{l}</button>
            ))}
          </div>
        </div>
        <BranchHeatmap branchData={branchData} allBranchMeta={allBranchMeta} metric={treemetric} t={t} fromDate={fromDate} toDate={toDate} filterTxn={filterTxn} />
      </Panel>

      {/* ── SCATTER ── */}
      <Panel {...P('scatter')}>
        <SectionTitle title="Branch Performance — Net Weight vs Avg Purity" t={t} badge="bubble = txn count" />
        <ScatterChart branchData={branchData} t={t} fromDate={fromDate} toDate={toDate} filterTxn={filterTxn} />
      </Panel>

      {/* ── DRILLDOWN ── */}
      <Panel {...P('drilldown')}>
        {/* Breadcrumb + sort */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '.5rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '8px' }}>Drilldown — State → Region → Branch</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button style={s.drillBtn(!drillState)} onClick={(e) => { e.stopPropagation(); setDrillState(null); setDrillRegion(null); setDrillCluster(null) }}>All States</button>
              {drillState  && <><span style={{ color: t.text4, fontSize: '.8rem' }}>›</span><button style={s.drillBtn(!!drillState && !drillRegion)} onClick={(e) => { e.stopPropagation(); setDrillRegion(null); setDrillCluster(null) }}>{drillState}</button></>}
              {drillRegion && <><span style={{ color: t.text4, fontSize: '.8rem' }}>›</span><button style={s.drillBtn(!!drillRegion && !drillCluster)} onClick={(e) => { e.stopPropagation(); setDrillCluster(null) }}>{drillRegion}</button></>}
              {drillCluster && <><span style={{ color: t.text4, fontSize: '.8rem' }}>›</span><button style={s.drillBtn(true)}>{drillCluster}</button></>}
            </div>
          </div>
          {drillRegion && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {[['Net Wt', 'total_net'], ['Value', 'total_value'], ['Txns', 'txn_count']].map(([l, v]) => (
                <button key={v} style={pill(branchSort === v)} onClick={(e) => { e.stopPropagation(); setBranchSort(v) }}>{l}</button>
              ))}
            </div>
          )}
        </div>

        {/* LEVEL 1 — State rows */}
        {!drillState && (
          <div style={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${t.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['#', 'State', 'Branches', 'Txns', 'Gross Wt', 'Net Wt', 'Avg Purity', 'Value', 'Physical', 'Takeover', 'Avg / Txn'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {derivedStates.map((s2, i) => (
                  <tr key={i}
                    onClick={(e) => { e.stopPropagation(); setDrillState(s2.state) }}
                    style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}20`, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}10`}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}20`}>
                    <td style={{ ...s.td, color: t.text4 }}>{i + 1}</td>
                    <td style={{ ...s.td, color: t.text1, fontWeight: 500 }}>{s2.state}</td>
                    <td style={{ ...s.td, color: t.text3 }}>{s2.branch_count}</td>
                    <td style={s.td}>{Number(s2.txn_count).toLocaleString('en-IN')}</td>
                    <td style={s.td}>{fmt(s2.total_gross)}g</td>
                    <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{fmt(s2.total_net)}g</td>
                    <td style={s.td}>—</td>
                    <td style={{ ...s.td, color: t.green }}>{fmtVal(s2.total_value)}</td>
                    <td style={{ ...s.td, color: t.gold }}>{Number(s2.physical_count).toLocaleString('en-IN')}</td>
                    <td style={{ ...s.td, color: t.blue }}>{Number(s2.takeover_count).toLocaleString('en-IN')}</td>
                    <td style={s.td}>{fmt(s2.total_net / (s2.txn_count || 1))}g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* LEVEL 2 — Region rows for selected state */}
        {drillState && !drillRegion && (() => {
          const regColors = buildRegionColors(derivedRegions.map(x => x.region))
          return (
            <div style={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${t.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['#', 'Region', 'Branches', 'Txns', 'Gross Wt', 'Net Wt', 'Value', 'Physical', 'Takeover', 'Avg / Txn'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {derivedRegions.map((r2, i) => {
                    const rc = regColors[r2.region] || t.gold
                    return (
                      <tr key={i}
                        onClick={(e) => { e.stopPropagation(); setDrillRegion(r2.region) }}
                        style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}20`, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = `${rc}12`}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}20`}>
                        <td style={{ ...s.td, color: t.text4 }}>{i + 1}</td>
                        <td style={{ ...s.td, fontWeight: 500 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: rc, flexShrink: 0 }} />
                            <span style={{ color: rc }}>{r2.region}</span>
                          </div>
                        </td>
                        <td style={{ ...s.td, color: t.text3 }}>{r2.branch_count}</td>
                        <td style={s.td}>{Number(r2.txn_count).toLocaleString('en-IN')}</td>
                        <td style={s.td}>{fmt(r2.total_gross)}g</td>
                        <td style={{ ...s.td, color: rc, fontWeight: 500 }}>{fmt(r2.total_net)}g</td>
                        <td style={{ ...s.td, color: t.green }}>{fmtVal(r2.total_value)}</td>
                        <td style={{ ...s.td, color: t.gold }}>{Number(r2.physical_count).toLocaleString('en-IN')}</td>
                        <td style={{ ...s.td, color: t.blue }}>{Number(r2.takeover_count).toLocaleString('en-IN')}</td>
                        <td style={s.td}>{fmt(r2.total_net / (r2.txn_count || 1))}g</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}

        {/* LEVEL 3 — Branch table for selected region */}
        {drillRegion && (
          <>
            {/* Cluster filter pills */}
            {clusters.length > 1 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ fontSize: '.6rem', color: t.text4, alignSelf: 'center' }}>Cluster:</span>
                <button style={pill(!drillCluster)} onClick={(e) => { e.stopPropagation(); setDrillCluster(null) }}>All</button>
                {clusters.map(c => (
                  <button key={c} style={pill(drillCluster === c)} onClick={(e) => { e.stopPropagation(); setDrillCluster(c) }}>{c}</button>
                ))}
              </div>
            )}
            <div style={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${t.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['#', 'Branch', 'Cluster', 'Txns', 'Gross Wt', 'Net Wt', 'Avg Purity', 'Value', 'Physical', 'Takeover', 'Avg / Txn'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedBranches.map((b, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}20` }}>
                      <td style={{ ...s.td, color: t.text4 }}>{i + 1}</td>
                      <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{b.branch_name}</td>
                      <td style={{ ...s.td, color: t.text3 }}>{b.cluster || '—'}</td>
                      <td style={s.td}>{Number(b.txn_count).toLocaleString('en-IN')}</td>
                      <td style={s.td}>{fmt(b.total_gross)}g</td>
                      <td style={{ ...s.td, color: t.gold }}>{fmt(b.total_net)}g</td>
                      <td style={s.td}>{Number(b.avg_purity).toFixed(1)}%</td>
                      <td style={{ ...s.td, color: t.green }}>{fmtVal(b.total_value)}</td>
                      <td style={{ ...s.td, color: t.gold }}>{Number(b.physical_count).toLocaleString('en-IN')}</td>
                      <td style={{ ...s.td, color: t.blue }}>{Number(b.takeover_count).toLocaleString('en-IN')}</td>
                      <td style={s.td}>{fmt(b.total_net / (b.txn_count || 1))}g</td>
                    </tr>
                  ))}
                  {sortedBranches.length === 0 && (
                    <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '40px' }}>No branches found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

    </div>
  )
}