'use client'

// Dashboard section: Jarvis (Staqu) store-camera footfall, gender/age split,
// and comparison with walk-ins punched in the CRM — by day and by branch.

import { useState, useEffect, useMemo } from 'react'
import {
  useJarvisFootfall, jarvisRange, jarvisYesterday, summarizeFootfall, JARVIS_PERIODS,
  punchColor, fmtN, fmtPctR, fmtTime, FootfallCountToggle, JARVIS_COUNT_DEFAULT,
} from './jarvisFootfall'
import { JARVIS_SECTION_ID, JARVIS_OPEN_EVENT } from './JarvisFootfallCard'

const SORTS = {
  gap: (a, b) => b.gap - a.gap,
  footfall: (a, b) => b.footfall - a.footfall,
  walkins: (a, b) => b.walkins - a.walkins,
  punch: (a, b) => (a.punch ?? 9) - (b.punch ?? 9),
  branch: (a, b) => a.branch.localeCompare(b.branch),
}

function Tile({ t, label, value, sub, color, children }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>{label}</div>
      {value != null && <div style={{ fontSize: 22, fontWeight: 700, color: color || t.text1, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>}
      {sub && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{sub}</div>}
      {children}
    </div>
  )
}

function SplitBar({ t, parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 6, overflow: 'hidden', background: t.border }}>
        {parts.map(p => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 11, color: t.text2 }}>
        {parts.map(p => (
          <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: p.color }} />
            {p.label} {fmtN(p.value)} ({Math.round((p.value / total) * 100)}%)
          </span>
        ))}
      </div>
    </div>
  )
}

function DailyChart({ t, days }) {
  const max = Math.max(1, ...days.map(d => Math.max(d.footfall, d.walkins)))
  const H = 120
  const barW = days.length <= 10 ? 24 : days.length <= 20 ? 14 : 9
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: t.text2 }}>Daily footfall vs walk-ins</div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: t.text3 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: t.blue, marginRight: 5 }} />Footfall</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: t.gold, marginRight: 5 }} />Walk-ins</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: H + 34, overflowX: 'auto' }}>
        {days.map(d => {
          const p = d.footfall > 0 ? d.walkins / d.footfall : null
          return (
            <div key={d.date} title={`${d.date}: footfall ${d.footfall}, walk-ins ${d.walkins}`} style={{ flex: '1 0 30px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 9.5, color: punchColor(t, p), fontWeight: 700, marginBottom: 3 }}>{fmtPctR(p)}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: H }}>
                <div style={{ width: barW, height: `${(d.footfall / max) * H}px`, background: t.blue, borderRadius: '3px 3px 0 0', transition: 'height .5s ease' }} />
                <div style={{ width: barW, height: `${(d.walkins / max) * H}px`, background: t.gold, borderRadius: '3px 3px 0 0', transition: 'height .5s ease' }} />
              </div>
              <div style={{ fontSize: 9.5, color: t.text3, marginTop: 4, whiteSpace: 'nowrap' }}>{d.date.slice(8)}/{d.date.slice(5, 7)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function JarvisFootfallSection({ t, isMobile }) {
  const [open, setOpen] = useState(false)
  const [period, setPeriod] = useState('yesterday')
  const [custom, setCustom] = useState(() => jarvisRange('week'))
  const [region, setRegion] = useState(null)
  const [branch, setBranch] = useState(null)
  const [sort, setSort] = useState('gap')
  const [count, setCount] = useState(JARVIS_COUNT_DEFAULT)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(JARVIS_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(JARVIS_OPEN_EVENT, onOpen)
  }, [])

  const range = jarvisRange(period, custom)
  const { from, to } = range
  const yday = jarvisYesterday()
  const { data, loading, error, reload } = useJarvisFootfall(open ? from : null, open ? to : null)
  const rows = from ? (data?.rows || []) : []
  const s = useMemo(() => summarizeFootfall(rows, { region, branch, count }), [rows, region, branch, count])
  const branchOptions = useMemo(() => [...new Set(rows.filter(r => r.footfall != null && (!region || r.region === region)).map(r => r.branch))].sort(), [rows, region])
  const sortedBranches = useMemo(() => [...s.branches].sort(SORTS[sort]), [s.branches, sort])
  const visibleBranches = showAll ? sortedBranches : sortedBranches.slice(0, 15)
  const synced = fmtTime(data?.lastSyncedAt)

  const pill = (active) => ({
    padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? t.blue + '80' : t.border}`,
    background: active ? `${t.blue}20` : 'transparent', color: active ? t.blue : t.text3,
    fontSize: 11.5, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  })
  const th = (key, label, align = 'right') => (
    <th onClick={key ? () => setSort(key) : undefined} style={{ padding: '8px 10px', textAlign: align, fontSize: 10.5, color: sort === key ? t.blue : t.text3, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, borderBottom: `1px solid ${t.border}`, cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: t.card }}>
      {label}{sort === key ? ' ↓' : ''}
    </th>
  )
  const td = { padding: '7px 10px', fontSize: 12.5, color: t.text2, borderBottom: `1px solid ${t.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  let body = null
  if (open) {
    if (!from) {
      body = <div style={{ fontSize: 13, color: t.text3 }}>{range.note}. Today is excluded until the day is complete.</div>
    } else if (data?.tableMissing) {
      body = <div style={{ fontSize: 13, color: t.text3 }}>Footfall storage isn&apos;t set up yet — run <code>sql/jarvis_footfall.sql</code> in the Supabase SQL editor, then data starts filling in within ~20 minutes.</div>
    } else if (!data && loading) {
      body = <div style={{ fontSize: 13, color: t.text3 }}>Loading footfall…</div>
    } else if (!data && error) {
      body = <div style={{ fontSize: 13, color: t.red }}>Couldn&apos;t load footfall: {error}</div>
    } else {
      body = (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10 }}>
            <Tile t={t} label={count === 'group' ? 'Group footfall' : 'Unique footfall'} value={fmtN(s.footfall)} color={t.blue} sub={`${s.reporting}/${s.cameras} cameras reporting`} />
            <Tile t={t} label="CRM walk-ins" value={fmtN(s.walkins)} color={t.gold} sub={`${fmtN(s.fresh)} fresh · ${fmtN(s.rewalkins)} re-walk-in`} />
            <Tile t={t} label="Punch rate" value={fmtPctR(s.punch)} color={punchColor(t, s.punch)} sub="walk-ins ÷ footfall" />
            <Tile t={t} label="Not punched" value={fmtN(Math.max(0, s.gap))} color={s.gap > 0 ? (t.orange || t.gold) : t.green} sub="footfall − walk-ins" />
            <Tile t={t} label="Gender">
              {s.genderKnown
                ? <SplitBar t={t} parts={[
                    { label: 'Male', value: s.male, color: t.blue },
                    { label: 'Female', value: s.female, color: t.purple || t.gold },
                    ...(s.unclassified > 0 ? [{ label: 'Unclassified', value: s.unclassified, color: t.text4 }] : []),
                  ]} />
                : <div style={{ fontSize: 12, color: t.text3, marginTop: 6 }}>Not reported</div>}
            </Tile>
          </div>

          {count === 'group' && s.groupFallback > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: t.text2, background: `${t.orange || t.gold}12`, border: `1px solid ${t.orange || t.gold}35`, borderRadius: 10, padding: '8px 12px' }}>
              {s.groupFallback === s.camDays
                ? 'Jarvis isn’t sending group counts for this period yet, so unique footfall is shown. Group counts fill in automatically once Jarvis provides them.'
                : `${s.groupFallback} of ${s.camDays} store-days have no group count from Jarvis — their unique footfall is used.`}
            </div>
          )}

          {s.pendingStaff > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: t.text2, background: `${t.orange || t.gold}12`, border: `1px solid ${t.orange || t.gold}35`, borderRadius: 10, padding: '8px 12px' }}>
              Jarvis hasn&apos;t removed staff from {s.pendingStaff} store-day{s.pendingStaff > 1 ? 's' : ''} yet, so those footfall counts may be high. They update automatically once Jarvis finishes.
            </div>
          )}

          {s.days.length > 1 && <div style={{ marginTop: 12 }}><DailyChart t={t} days={s.days} /></div>}

          <div style={{ marginTop: 12, background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text2 }}>Branches with cameras · {s.branches.length}</div>
              <div style={{ fontSize: 11, color: t.text3 }}>Click a column to sort</div>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: showAll ? 520 : undefined, overflowY: showAll ? 'auto' : 'visible' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {th('branch', 'Branch', 'left')}
                    {!isMobile && th(null, 'Region', 'left')}
                    {th('footfall', count === 'group' ? 'Group footfall' : 'Unique footfall')}
                    {th('walkins', 'Walk-ins')}
                    {th('punch', 'Punch %')}
                    {th('gap', 'Not punched')}
                    {!isMobile && th(null, 'Male / Female')}
                    {th(null, 'Flags', 'left')}
                  </tr>
                </thead>
                <tbody>
                  {visibleBranches.map(b => (
                    <tr key={b.branch}>
                      <td style={{ ...td, textAlign: 'left', color: t.text1, fontWeight: 600 }}>{b.branch}</td>
                      {!isMobile && <td style={{ ...td, textAlign: 'left', color: t.text3 }}>{b.region || '—'}</td>}
                      <td style={{ ...td, color: t.blue }}>{fmtN(b.footfall)}</td>
                      <td style={{ ...td, color: t.gold }}>{fmtN(b.walkins)}</td>
                      <td style={{ ...td, color: punchColor(t, b.punch), fontWeight: 700 }}>{fmtPctR(b.punch)}</td>
                      <td style={{ ...td, color: b.gap > 0 ? t.text1 : t.text3 }}>{fmtN(b.gap)}</td>
                      {!isMobile && <td style={td}>{fmtN(b.male)} / {fmtN(b.female)}</td>}
                      <td style={{ ...td, textAlign: 'left' }}>
                        {b.deadDays > 0 && <Flag t={t} color={t.red} text={`Camera 0 on ${b.deadDays} day${b.deadDays > 1 ? 's' : ''} with walk-ins`} />}
                        {b.punch != null && b.punch > 1 && <Flag t={t} color={t.purple || t.blue} text="Walk-ins > footfall" />}
                        {b.pendingDays > 0 && <Flag t={t} color={t.text3} text={`Incl. staff · ${b.pendingDays}d`} />}
                        {b.partialDays > 0 && <Flag t={t} color={t.text3} text={`Partial camera data · ${b.partialDays}d`} />}
                      </td>
                    </tr>
                  ))}
                  {visibleBranches.length === 0 && (
                    <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: t.text3, padding: 18 }}>No camera footfall for this selection yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {sortedBranches.length > 15 && (
              <button onClick={() => setShowAll(v => !v)} style={{ width: '100%', padding: '9px 0', border: 'none', borderTop: `1px solid ${t.border}`, background: 'transparent', color: t.blue, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {showAll ? 'Show top 15' : `Show all ${sortedBranches.length} branches`}
              </button>
            )}
          </div>

          {[
            { list: s.offline, color: t.red, title: `${s.offline.length} camera${s.offline.length > 1 ? 's' : ''} sent no data for this period (${fmtN(s.offline.reduce((a, b) => a + b.walkins, 0))} walk-ins, not compared)` },
            { list: s.noCamera, color: t.text2, title: `${s.noCamera.length} branches have CRM walk-ins but no Jarvis camera (${fmtN(s.noCamera.reduce((a, b) => a + b.walkins, 0))} walk-ins, not compared)` },
          ].filter(g => g.list.length > 0).map(g => (
            <details key={g.title} style={{ marginTop: 10, background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '10px 14px' }}>
              <summary style={{ fontSize: 12, color: g.color, cursor: 'pointer', fontWeight: 600 }}>{g.title}</summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {g.list.map(n => (
                  <span key={n.branch} style={{ fontSize: 11.5, color: t.text2, background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '3px 8px' }}>{n.branch} · {n.walkins}</span>
                ))}
              </div>
            </details>
          ))}

          <div style={{ marginTop: 10, fontSize: 11, color: t.text3, lineHeight: 1.6 }}>
            {count === 'group'
              ? 'Group footfall = Jarvis group count — people entering together count once (same basis as the Jarvis dashboard). '
              : 'Unique footfall = every person the Jarvis camera counted entering, companions included. '}
            Staff are removed once Jarvis&apos; staff-reduction run completes.
            Walk-ins = CRM transactions opened that day + re-walk-ins (opened earlier, closed that day) — same basis as the Walked-in tile.
            Only branch-days with camera data are compared.
            {data?.crm && data.crm.new !== 'ok' && (
              <span style={{ color: t.red }}> CRM unavailable — walk-ins may be understated.</span>
            )}
          </div>
        </>
      )
    }
  }

  return (
    <div id={JARVIS_SECTION_ID} style={{ marginTop: 14, border: `1px solid ${t.border2 || t.border}`, borderRadius: 20, background: `linear-gradient(160deg,${t.card2},${t.card3 || t.card2})`, boxShadow: t.shadow, overflow: 'hidden', scrollMarginTop: 80 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: open ? (isMobile ? '14px 16px' : '18px 24px') : (isMobile ? '10px 16px' : '12px 24px'), cursor: 'pointer', userSelect: 'none', borderBottom: open ? `1px solid ${t.border}` : 'none', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 20, borderRadius: 2, background: `linear-gradient(180deg,${t.blue},${t.blue}40)`, boxShadow: `0 0 8px ${t.blue}60` }} />
          <div style={{ fontSize: 14, color: t.text2, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Jarvis · Store Footfall</div>
        </div>
        {open && synced && <div style={{ fontSize: 11, color: t.text3 }}>synced {synced}</div>}
        {open && (
          <button onClick={e => { e.stopPropagation(); reload() }} style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${t.border}`, background: t.card, color: t.text3, fontSize: 12, cursor: 'pointer' }}>↻</button>
        )}
        <div style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: 8, background: `${t.blue}12`, border: `1px solid ${t.blue}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.blue, fontSize: 11, transition: 'transform .35s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</div>
      </div>

      {open && (
        <div style={{ padding: isMobile ? '14px 14px 18px' : '18px 24px 22px' }}>
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 8 }}>
            {JARVIS_PERIODS.map(p => <button key={p.key} onClick={() => setPeriod(p.key)} style={pill(period === p.key)}>{p.label}</button>)}
            {period === 'custom' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6, flexShrink: 0 }}>
                {['from', 'to'].map((k, i) => (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {i === 1 && <span style={{ fontSize: 11.5, color: t.text3 }}>→</span>}
                    <input type="date" value={custom[k] || ''} max={k === 'from' ? (custom.to || yday) : yday} min={k === 'to' ? custom.from : undefined}
                      onChange={e => e.target.value && setCustom(c => ({ ...c, [k]: e.target.value }))}
                      style={{ background: t.card, color: t.text1, border: `1px solid ${t.border}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, colorScheme: 'light dark' }} />
                  </span>
                ))}
              </span>
            ) : (
              <span style={{ fontSize: 11.5, color: t.text3, alignSelf: 'center', marginLeft: 6, whiteSpace: 'nowrap' }}>{from ? `${from === to ? from : `${from} → ${to}`}${range.hint ? ` · ${range.hint}` : ''}` : range.note}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14, alignItems: 'center' }}>
            <FootfallCountToggle t={t} value={count} onChange={setCount} />
            <span style={{ width: 1, height: 18, background: t.border, margin: '0 6px', flexShrink: 0 }} />
            <button onClick={() => { setRegion(null); setBranch(null) }} style={pill(!region)}>All regions</button>
            {s.regions.length > 0 && [...new Set(rows.map(r => r.region).filter(Boolean))].sort().map(r => (
              <button key={r} onClick={() => { setRegion(r); setBranch(null) }} style={pill(region === r)}>{r}</button>
            ))}
            <select value={branch || ''} onChange={e => setBranch(e.target.value || null)} style={{ marginLeft: 6, background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 8, padding: '5px 8px', fontSize: 12 }}>
              <option value="">All branches</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          {body}
        </div>
      )}
    </div>
  )
}

function Flag({ t, color, text }) {
  return <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, color, background: `${color}1c`, borderRadius: 6, padding: '2px 7px', marginRight: 4, marginBottom: 2 }}>{text}</span>
}
