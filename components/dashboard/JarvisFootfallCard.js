'use client'

// Dashboard card: Jarvis camera footfall vs walk-ins punched in the CRM for the
// latest completed working day (today is never shown — counts are partial).

import { useMemo } from 'react'
import {
  useJarvisFootfall, jarvisRange, jarvisYesterday, summarizeFootfall, punchColor, fmtN, fmtPctR, fmtTime,
} from './jarvisFootfall'

export const JARVIS_SECTION_ID = 'jarvis-footfall-section'
export const JARVIS_OPEN_EVENT = 'jarvis-footfall:open'

function Metric({ t, label, value, sub, color }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || t.text1, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function JarvisFootfallCard({ t, isMobile }) {
  // Latest completed day with store activity — yesterday normally, or the
  // last working day when yesterday was a closed day (Sunday / holiday).
  const yday = jarvisYesterday()
  const { from, to } = jarvisRange('2weeks')
  const { data, loading, error } = useJarvisFootfall(from, to)
  const day = useMemo(() => {
    const active = (data?.rows || [])
      .filter(r => (r.footfall || 0) > 0 || r.walkins_old + r.walkins_new + r.rewalkins > 0)
      .map(r => r.date)
    return active.length ? active.reduce((a, b) => (a > b ? a : b)) : yday
  }, [data, yday])
  const s = useMemo(() => summarizeFootfall((data?.rows || []).filter(r => r.date === day)), [data, day])
  const ydayIsSunday = new Date(`${yday}T00:00:00Z`).getUTCDay() === 0
  const dayLabel = day === yday
    ? `Yesterday · ${fmtDay(day)}`
    : ydayIsSunday ? `Saturday · ${fmtDay(day)} (yesterday was Sunday)` : `Last working day · ${fmtDay(day)} (no store activity yesterday)`

  const openSection = () => {
    window.dispatchEvent(new Event(JARVIS_OPEN_EVENT))
    document.getElementById(JARVIS_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const max = Math.max(s.footfall, s.walkins, 1)
  const pc = punchColor(t, s.punch)
  const synced = fmtTime(data?.lastSyncedAt)

  let body
  if (data?.tableMissing) {
    body = <div style={{ fontSize: 13, color: t.text3 }}>Footfall storage isn&apos;t set up yet — run <code>sql/jarvis_footfall.sql</code> in Supabase.</div>
  } else if (!data && loading) {
    body = <div style={{ fontSize: 13, color: t.text3 }}>Loading footfall…</div>
  } else if (!data && error) {
    body = <div style={{ fontSize: 13, color: t.red }}>Couldn&apos;t load footfall: {error}</div>
  } else if (s.cameras === 0) {
    body = <div style={{ fontSize: 13, color: t.text3 }}>No camera footfall recorded in the last 14 days.</div>
  } else {
    body = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? 14 : 18 }}>
          <Metric t={t} label="Store footfall" value={fmtN(s.footfall)} color={t.blue} sub="Footfall count" />
          <Metric t={t} label="CRM walk-ins" value={fmtN(s.walkins)} color={t.gold} sub={s.rewalkins ? `${fmtN(s.fresh)} fresh · ${fmtN(s.rewalkins)} re-walk-in` : 'punched in CRM'} />
          <Metric t={t} label="Punch rate" value={fmtPctR(s.punch)} color={pc} sub="walk-ins ÷ footfall" />
          <Metric t={t} label="Not punched" value={fmtN(Math.max(0, s.gap))} color={s.gap > 0 ? (t.orange || t.gold) : t.green} sub="footfall − walk-ins" />
        </div>
        <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
          {[['Footfall', s.footfall, t.blue], ['Walk-ins', s.walkins, t.gold]].map(([label, v, c]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 62, fontSize: 11, color: t.text3 }}>{label}</div>
              <div style={{ flex: 1, height: 8, borderRadius: 6, background: t.border, overflow: 'hidden' }}>
                <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: c, borderRadius: 6, transition: 'width .6s ease' }} />
              </div>
              <div style={{ width: 48, textAlign: 'right', fontSize: 12, color: t.text2, fontVariantNumeric: 'tabular-nums' }}>{fmtN(v)}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11.5, color: t.text3 }}>
          {s.genderKnown && <span>♂ {fmtN(s.male)} · ♀ {fmtN(s.female)}{s.unclassified > 0 ? ` · ${fmtN(s.unclassified)} unclassified` : ''}</span>}
          <span>{s.reporting}/{s.cameras} cameras reporting</span>
          {s.offline.length > 0 && <span style={{ color: t.red }}>{s.offline.length} camera{s.offline.length > 1 ? 's' : ''} sent no data</span>}
          {s.pendingStaff > 0 && <span style={{ color: t.orange || t.gold }}>Staff not yet removed at {s.pendingStaff} store{s.pendingStaff > 1 ? 's' : ''} — may be overcounted</span>}
          {s.noCamera.length > 0 && <span>{fmtN(s.noCamera.reduce((a, b) => a + b.walkins, 0))} walk-ins at {s.noCamera.length} branches without a camera (not compared)</span>}
        </div>
      </>
    )
  }

  return (
    <div style={{ background: `linear-gradient(145deg,${t.card},${t.card2})`, border: `1px solid ${t.border}`, borderRadius: 16, padding: isMobile ? '14px 14px' : '18px 20px', boxShadow: t.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `${t.blue}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👥</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text1 }}>Store footfall vs CRM walk-ins</div>
          <div style={{ fontSize: 11.5, color: t.text3 }}>{dayLabel} · Jarvis{synced ? ` · synced ${synced}` : ''}</div>
        </div>
        <button onClick={openSection} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.card, color: t.text2, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Branch breakdown →
        </button>
      </div>
      {body}
    </div>
  )
}
