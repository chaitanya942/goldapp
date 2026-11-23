'use client'

// Dashboard section: the walk-in journey funnel as one table —
//   Jarvis walk-in  →  OTP generated (Telesales / Direct)  →  Actual walk-ins (Telesales / Direct)
// as columns, with regions as rows and every branch nested under its region.
// Sundays are excluded (branches closed). One shared date filter (defaults to
// yesterday, because Jarvis camera counts are only complete through yesterday)
// drives the table and the two expandable detail panels below. Follows the
// dashboard's location filter and has its own region + branch filters.
// Data: /api/walkin-funnel (lib/otpChannels + lib/jarvisFootfallData).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istNow, istStr, istLastWeekRange } from '../../lib/dateIst'

const DATA_START = '2026-10-01'
const PERIODS = [
  { key: 'yesterday', label: 'Yesterday' }, { key: 'last7', label: 'Last 7 Days' },
  { key: 'week', label: 'This Week' }, { key: 'last_week', label: 'Last Week' },
  { key: 'mtd', label: 'MTD' }, { key: 'custom', label: 'Custom' },
]
const FILTER_LABEL = { region: 'Region', state: 'State', cluster: 'Cluster', branch: 'Branch' }
const KEYS = ['jarvis_group', 'jarvis_unique', 'otp_TS', 'otp_DW', 'walk_TS', 'walk_DW']

// Ranges never start before 1 Oct 2026 and never end after yesterday (Jarvis).
function rangeFor(key, custom) {
  const now = istNow(), y = now.getUTCFullYear(), m = now.getUTCMonth()
  const pad = (n) => String(n).padStart(2, '0')
  const yday = istStr(new Date(now - 86400000))
  let r
  if (key === 'last7') r = { from: istStr(new Date(now - 7 * 86400000)), to: yday }
  else if (key === 'week') { const dow = now.getUTCDay(), off = dow === 0 ? 6 : dow - 1; r = { from: istStr(new Date(now - off * 86400000)), to: yday } }
  else if (key === 'last_week') r = istLastWeekRange()
  else if (key === 'mtd') r = { from: `${y}-${pad(m + 1)}-01`, to: yday }
  else if (key === 'custom') { const to = custom?.to && custom.to <= yday ? custom.to : yday; r = { from: custom?.from && custom.from <= to ? custom.from : to, to } }
  else r = { from: yday, to: yday }
  if (r.from < DATA_START) r = { ...r, from: DATA_START }
  if (r.to > yday) r = { ...r, to: yday }
  return r.to < DATA_START ? { from: null, to: null } : r
}

const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))
const fmtPctR = (p) => (p == null ? '' : `${Math.round(p * 100)}%`)
const pct = (a, b) => (b > 0 ? a / b : null)
const sumCells = (list) => { const o = Object.fromEntries(KEYS.map(k => [k, 0])); for (const x of list) for (const k of KEYS) o[k] += x[k] || 0; return o }

export default function WalkinAnalysisSection({ t, isMobile, filterType = null, filterValue = null }) {
  const [open, setOpen] = useState(true)
  const [period, setPeriod] = useState('yesterday')
  const [custom, setCustom] = useState(() => { const yday = istStr(new Date(istNow() - 86400000)); return { from: yday, to: yday } })
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [regionSel, setRegionSel] = useState(null)
  const [branchSel, setBranchSel] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())   // regions in here are collapsed; default all expanded
  const loc = filterType && filterValue ? { type: filterType, value: filterValue } : null
  const { from, to } = rangeFor(period, custom)
  const yday = istStr(new Date(istNow() - 86400000))

  const load = useCallback(async () => {
    if (!from) { setState({ loading: false, data: null, error: null }); return }
    setState(s => ({ ...s, loading: true }))
    try {
      const res = await authedFetch(`/api/walkin-funnel?from=${from}&to=${to}${loc ? `&filter_type=${loc.type}&filter_value=${encodeURIComponent(loc.value)}` : ''}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) throw new Error(json?.error || `Server error (HTTP ${res.status})`)
      setState({ loading: false, data: json, error: null })
    } catch (e) { setState(s => ({ loading: false, data: s.data, error: e.message })) }
  }, [from, to, loc?.type, loc?.value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) load() }, [open, load])

  const d = state.data
  const jarvis = !!d?.jarvisAvailable
  const C = { TS: t.blue, DW: t.gold }

  const allBranches = useMemo(() => {
    if (!d) return []
    const names = new Set()
    for (const r of d.regions) { if (regionSel && r.region !== regionSel) continue; for (const b of r.branches) names.add(b.branch) }
    return [...names].sort()
  }, [d, regionSel])

  // Apply the section's own region + branch filters; region subtotals follow the visible branches.
  const view = useMemo(() => {
    if (!d) return []
    let regs = d.regions
    if (regionSel) regs = regs.filter(r => r.region === regionSel)
    if (branchSel) regs = regs.map(r => ({ ...r, branches: r.branches.filter(b => b.branch === branchSel) })).filter(r => r.branches.length)
    return regs.map(r => ({ region: r.region, branches: r.branches, ...sumCells(r.branches) }))
  }, [d, regionSel, branchSel])

  const grand = useMemo(() => sumCells(view.flatMap(r => r.branches)), [view])
  const empty = d && !KEYS.some(k => grand[k] > 0)

  const pill = (active) => ({
    padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? t.gold + '80' : t.border}`,
    background: active ? `${t.gold}20` : 'transparent', color: active ? t.gold : t.text3,
    fontSize: 11.5, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  })
  const th = { padding: '8px 10px', textAlign: 'right', fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', background: t.card, position: 'sticky', top: 0 }
  const td = { padding: '7px 10px', fontSize: 12.5, color: t.text2, borderBottom: `1px solid ${t.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const ncols = 1 + (jarvis ? 1 : 0) + 4

  // Each cell: count on top, its % underneath. OTP % is of Jarvis footfall;
  // actual-walk-in % is of that channel's OTPs (conversion).
  const numCell = (val, p, color) => (
    <td style={{ ...td, color }}>
      {fmtN(val)}
      {p != null && <div style={{ fontSize: 10.5, color: t.text4, fontWeight: 400 }}>{fmtPctR(p)}</div>}
    </td>
  )
  const dataCells = (x) => {
    const f = x.jarvis_group
    return <>
      {jarvis && (
        <td style={{ ...td, color: t.blue }}>
          {fmtN(x.jarvis_group)}{x.jarvis_unique ? <span style={{ color: t.text4, fontSize: 11, marginLeft: 4 }}>/ {fmtN(x.jarvis_unique)}</span> : null}
          {f > 0 && <div style={{ fontSize: 10.5, color: t.text4, fontWeight: 400 }}>{fmtPctR(pct(x.walk_TS + x.walk_DW, f))} walk-in</div>}
        </td>
      )}
      {numCell(x.otp_TS, pct(x.otp_TS, f), C.TS)}
      {numCell(x.otp_DW, pct(x.otp_DW, f), C.DW)}
      {numCell(x.walk_TS, pct(x.walk_TS, x.otp_TS), C.TS)}
      {numCell(x.walk_DW, pct(x.walk_DW, x.otp_DW), C.DW)}
    </>
  }

  return (
    <div style={{ marginTop: 14, border: `1px solid ${t.border2 || t.border}`, borderRadius: 20, background: `linear-gradient(160deg,${t.card2},${t.card3 || t.card2})`, boxShadow: t.shadow, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '14px 16px' : '16px 24px', cursor: 'pointer', userSelect: 'none', borderBottom: open ? `1px solid ${t.border}` : 'none' }}>
        <div style={{ width: 3, height: 20, borderRadius: 2, background: `linear-gradient(180deg,${t.blue},${t.gold})`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 12.5 : 14, color: t.text2, letterSpacing: isMobile ? '.08em' : '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Walk-in Analysis</div>
          {open && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>Jarvis walk-in → OTP (Telesales / Direct) → Actual walk-ins, by region &amp; branch · Sundays excluded · defaults to yesterday</div>}
        </div>
        <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: `${t.gold}12`, border: `1px solid ${t.gold}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.gold, fontSize: 11, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .3s' }}>▼</div>
      </div>

      {open && (
        <div style={{ padding: isMobile ? '14px' : '18px 24px 22px' }}>
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 10, alignItems: 'center' }}>
            {PERIODS.map(p => <button key={p.key} onClick={() => setPeriod(p.key)} style={pill(period === p.key)}>{p.label}</button>)}
            {period === 'custom' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6, flexShrink: 0 }}>
                {['from', 'to'].map((k, i) => (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {i === 1 && <span style={{ fontSize: 11.5, color: t.text3 }}>→</span>}
                    <input type="date" value={custom[k] || ''} min={k === 'from' ? DATA_START : (custom.from || DATA_START)} max={k === 'to' ? yday : (custom.to || yday)}
                      onChange={e => e.target.value && setCustom(c => ({ ...c, [k]: e.target.value }))}
                      style={{ background: t.card, color: t.text1, border: `1px solid ${t.border}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, colorScheme: 'light dark' }} />
                  </span>
                ))}
              </span>
            ) : (
              <span style={{ fontSize: 11.5, color: t.text3, marginLeft: 6, whiteSpace: 'nowrap' }}>{from ? (from === to ? from : `${from} → ${to}`) : 'No data before 1 Oct 2026'}</span>
            )}
            {loc && <span style={{ fontSize: 11.5, color: t.gold, marginLeft: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>· {FILTER_LABEL[loc.type]}: {loc.value}</span>}
          </div>

          {/* Section region + branch filters */}
          {d && (
            <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14, alignItems: 'center' }}>
              <button onClick={() => { setRegionSel(null); setBranchSel(null) }} style={pill(!regionSel)}>All regions</button>
              {d.regions.map(r => <button key={r.region} onClick={() => { setRegionSel(r.region); setBranchSel(null) }} style={pill(regionSel === r.region)}>{r.region}</button>)}
              <select value={branchSel || ''} onChange={e => setBranchSel(e.target.value || null)} style={{ marginLeft: 6, background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 8, padding: '5px 8px', fontSize: 12, flexShrink: 0 }}>
                <option value="">All branches</option>
                {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}

          {state.error && !d && <div style={{ fontSize: 13, color: t.red }}>Couldn&apos;t load: {state.error}</div>}
          {!d && state.loading && <div style={{ fontSize: 13, color: t.text3 }}>Loading…</div>}

          {d && (
            <div style={{ opacity: state.loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              {empty ? (
                <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '18px', fontSize: 13, color: t.text3, textAlign: 'center' }}>
                  No walk-in activity for {from === to ? from : `${from} → ${to}`} (Sundays excluded) — branches may have been closed. Pick another day above.
                </div>
              ) : (
                <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th rowSpan={2} style={{ ...th, textAlign: 'left' }}>Region / Branch</th>
                          {jarvis && <th rowSpan={2} style={th}>Jarvis walk-in<div style={{ fontSize: 9, color: t.text4, fontWeight: 500 }}>group / unique</div></th>}
                          <th colSpan={2} style={{ ...th, textAlign: 'center', borderLeft: `1px solid ${t.border}` }}>OTP generated</th>
                          <th colSpan={2} style={{ ...th, textAlign: 'center', borderLeft: `1px solid ${t.border}` }}>Actual walk-ins</th>
                        </tr>
                        <tr>
                          <th style={{ ...th, color: C.TS, borderLeft: `1px solid ${t.border}` }}>Telesales</th>
                          <th style={{ ...th, color: C.DW }}>Direct</th>
                          <th style={{ ...th, color: C.TS, borderLeft: `1px solid ${t.border}` }}>Telesales</th>
                          <th style={{ ...th, color: C.DW }}>Direct</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Grand total */}
                        <tr style={{ background: `${t.gold}0c` }}>
                          <td style={{ ...td, textAlign: 'left', color: t.text1, fontWeight: 800 }}>All regions</td>
                          {dataCells(grand)}
                        </tr>
                        {view.map(r => {
                          const show = !collapsed.has(r.region)
                          return (
                            <RegionGroup key={r.region} r={r} show={show}
                              toggle={() => setCollapsed(s => { const n = new Set(s); n.has(r.region) ? n.delete(r.region) : n.add(r.region); return n })}
                              t={t} td={td} dataCells={dataCells} />
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '9px 14px', borderTop: `1px solid ${t.border}`, fontSize: 11.5, color: t.text3, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    <span>% under OTP = of Jarvis footfall · % under Actual walk-ins = of that channel&apos;s OTPs{jarvis ? ' · % under Jarvis = footfall that became a walk-in' : ''}. Click a region to collapse its branches.</span>
                    {d.no_otp > 0 && <span style={{ color: t.text4 }}>· {fmtN(d.no_otp)} actual walk-ins had no OTP (not in Telesales/Direct)</span>}
                    {!jarvis && <span style={{ color: t.text4 }}>· Jarvis footfall not available for your account</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RegionGroup({ r, show, toggle, t, td, dataCells }) {
  return (
    <>
      <tr onClick={toggle} style={{ cursor: 'pointer', background: t.card2 || t.card }}>
        <td style={{ ...td, textAlign: 'left', color: t.text1, fontWeight: 700 }}>
          <span style={{ display: 'inline-block', width: 12, color: t.text3, fontSize: 10 }}>{show ? '▾' : '▸'}</span>
          {r.region} <span style={{ color: t.text4, fontWeight: 400, fontSize: 11 }}>· {r.branches.length}</span>
        </td>
        {dataCells(r)}
      </tr>
      {show && r.branches.map(b => (
        <tr key={b.branch}>
          <td style={{ ...td, textAlign: 'left', color: t.text2, paddingLeft: 28 }}>{b.branch}</td>
          {dataCells(b)}
        </tr>
      ))}
    </>
  )
}
