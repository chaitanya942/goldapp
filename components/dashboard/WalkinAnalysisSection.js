'use client'

// Dashboard section: the day's walk-in funnel in one place —
//   Jarvis store footfall  →  OTPs generated (Telesales / Direct Walk-in)
//   →  CRM punch-ins (walk-ins, by channel)  +  the attribution between stages.
// One shared date filter (defaults to yesterday, because Jarvis camera counts
// are only complete through yesterday) drives the funnel and the two expandable
// detail panels below (the full Telesales-vs-Direct-Walk-in breakdown and the
// Jarvis footfall-by-branch table). Follows the dashboard's location filter.
// Data: /api/walkin-funnel (lib/otpChannels + lib/jarvisFootfallData).

import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istNow, istStr, istLastWeekRange } from '../../lib/dateIst'
import OtpChannelsSection from './OtpChannelsSection'
import JarvisFootfallSection from './JarvisFootfallSection'

const DATA_START = '2026-10-01'
const PERIODS = [
  { key: 'yesterday', label: 'Yesterday' }, { key: 'last7', label: 'Last 7 Days' },
  { key: 'week', label: 'This Week' }, { key: 'last_week', label: 'Last Week' },
  { key: 'mtd', label: 'MTD' }, { key: 'custom', label: 'Custom' },
]
const FILTER_LABEL = { region: 'Region', state: 'State', cluster: 'Cluster', branch: 'Branch' }

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
const fmtPctR = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`)

export default function WalkinAnalysisSection({ t, isMobile, filterType = null, filterValue = null }) {
  const [open, setOpen] = useState(true)
  const [period, setPeriod] = useState('yesterday')
  const [custom, setCustom] = useState(() => { const yday = istStr(new Date(istNow() - 86400000)); return { from: yday, to: yday } })
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [showOtp, setShowOtp] = useState(false)
  const [showJarvis, setShowJarvis] = useState(false)
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
  const C = { TS: t.blue, DW: t.gold, jarvis: t.blue, otp: t.purple || t.blue, punch: t.green || t.gold }

  const pill = (active) => ({
    padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? t.gold + '80' : t.border}`,
    background: active ? `${t.gold}20` : 'transparent', color: active ? t.gold : t.text3,
    fontSize: 11.5, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  })

  // Funnel stages, scaled to the largest stage so the bars read as a funnel.
  const jGroup = d?.jarvis?.available ? d.jarvis.group : null
  const stages = d ? [
    ...(d.jarvis?.available ? [{
      key: 'jarvis', color: C.jarvis, label: 'Jarvis walk-ins', value: d.jarvis.group,
      note: `camera branches${d.jarvis.cameraBranches ? ` · ${d.jarvis.cameraBranches}` : ''}`,
      split: [{ label: 'Group', value: d.jarvis.group, color: t.blue }, { label: 'Unique', value: d.jarvis.footfall, color: t.text4 }],
    }] : []),
    { key: 'otp', color: C.otp, label: 'OTPs generated', value: d.otp.total,
      split: [{ label: 'Telesales', value: d.otp.TS, color: C.TS }, { label: 'Direct Walk-in', value: d.otp.DW, color: C.DW }] },
    { key: 'punch', color: C.punch, label: 'CRM punch-ins (walk-ins)', value: d.punch.total,
      split: [{ label: 'Telesales', value: d.punch.TS, color: C.TS }, { label: 'Direct Walk-in', value: d.punch.DW, color: C.DW }, ...(d.punch.no_otp ? [{ label: 'No OTP', value: d.punch.no_otp, color: t.text4 }] : [])] },
  ] : []
  const maxStage = Math.max(1, ...stages.map(s => s.value || 0))

  // Conversion between consecutive stages.
  const conv = (a, b) => (a > 0 ? b / a : null)

  const Split = ({ parts }) => {
    const total = parts.reduce((s, p) => s + (p.value || 0), 0) || 1
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 11, color: t.text2 }}>
        {parts.map(p => (
          <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: p.color }} />
            {p.label} <b style={{ color: t.text1, fontWeight: 700 }}>{fmtN(p.value)}</b> <span style={{ color: t.text4 }}>({Math.round(((p.value || 0) / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    )
  }

  const detailBox = (shown, setShown, label, color, child) => (
    <div style={{ marginTop: 12, background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div onClick={() => setShown(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', userSelect: 'none', borderBottom: shown ? `1px solid ${t.border}` : 'none' }}>
        <div style={{ width: 3, height: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: t.text2 }}>{label}</div>
        <div style={{ color: t.text3, fontSize: 11, transform: shown ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .3s' }}>▼</div>
      </div>
      {shown && <div style={{ padding: isMobile ? '12px' : '14px 16px' }}>{child}</div>}
    </div>
  )

  return (
    <div style={{ marginTop: 14, border: `1px solid ${t.border2 || t.border}`, borderRadius: 20, background: `linear-gradient(160deg,${t.card2},${t.card3 || t.card2})`, boxShadow: t.shadow, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '14px 16px' : '16px 24px', cursor: 'pointer', userSelect: 'none', borderBottom: open ? `1px solid ${t.border}` : 'none' }}>
        <div style={{ width: 3, height: 20, borderRadius: 2, background: `linear-gradient(180deg,${t.blue},${t.gold})`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 12.5 : 14, color: t.text2, letterSpacing: isMobile ? '.08em' : '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Walk-in Analysis</div>
          {open && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>Jarvis footfall → OTPs (Telesales / Direct) → CRM punch-ins, with attribution · defaults to yesterday</div>}
        </div>
        <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: `${t.gold}12`, border: `1px solid ${t.gold}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.gold, fontSize: 11, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .3s' }}>▼</div>
      </div>

      {open && (
        <div style={{ padding: isMobile ? '14px' : '18px 24px 22px' }}>
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14, alignItems: 'center' }}>
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

          {state.error && !d && <div style={{ fontSize: 13, color: t.red }}>Couldn&apos;t load: {state.error}</div>}
          {!d && state.loading && <div style={{ fontSize: 13, color: t.text3 }}>Loading…</div>}

          {d && (() => {
            const empty = !d.otp.total && !d.punch.total && !(d.jarvis?.group || 0) && !(d.jarvis?.footfall || 0)
            return (
            <div style={{ opacity: state.loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              {empty && (
                <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '18px', fontSize: 13, color: t.text3, textAlign: 'center' }}>
                  No walk-in activity recorded for {from === to ? from : `${from} → ${to}`} — branches may have been closed that day. Pick another day above.
                </div>
              )}
              {!empty && <>
              {/* ── Funnel ── */}
              <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: isMobile ? '14px' : '16px 18px' }}>
                {stages.map((sg, i) => {
                  const prev = i > 0 ? stages[i - 1] : null
                  const c = prev ? conv(prev.value, sg.value) : null
                  return (
                    <div key={sg.key}>
                      {prev && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0 7px 2px', color: t.text3, fontSize: 11.5 }}>
                          <span style={{ color: t.text4 }}>↓</span>
                          <span><b style={{ color: t.text1, fontWeight: 700 }}>{fmtPctR(c)}</b> {prev.key === 'jarvis' ? 'of footfall generated an OTP' : 'of OTPs became a walk-in'}</span>
                        </div>
                      )}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: sg.color }}>{sg.label}{sg.note ? <span style={{ color: t.text4, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{sg.note}</span> : null}</span>
                          <span style={{ fontSize: 18, fontWeight: 700, color: t.text1, fontVariantNumeric: 'tabular-nums' }}>{fmtN(sg.value)}</span>
                        </div>
                        <div style={{ height: 12, borderRadius: 6, background: t.border, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(2, (sg.value / maxStage) * 100)}%`, height: '100%', background: sg.color, borderRadius: 6, transition: 'width .5s ease' }} />
                        </div>
                        <Split parts={sg.split} />
                      </div>
                    </div>
                  )
                })}
                {!d.jarvis?.available && (
                  <div style={{ marginTop: 10, fontSize: 11, color: t.text4 }}>Jarvis footfall isn&apos;t available for your account — funnel starts at OTPs.</div>
                )}
              </div>

              {/* ── Per-channel attribution ── */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginTop: 12 }}>
                {[['TS', 'Telesales'], ['DW', 'Direct Walk-in']].map(([ch, label]) => {
                  const o = d.otp[ch], p = d.punch[ch], rate = conv(o, p)
                  return (
                    <div key={ch} style={{ background: t.card, border: `1px solid ${t.border}`, borderTop: `2px solid ${C[ch]}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: C[ch], textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{label} <span style={{ color: t.text4 }}>· {ch}</span></div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginTop: 8 }}>
                        {[['OTPs', o], ['Walk-ins', p], ['Conversion', null, rate]].map(([lab, n, r]) => (
                          <div key={lab} style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{lab}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, fontVariantNumeric: 'tabular-nums' }}>{r !== undefined ? fmtPctR(r) : fmtN(n)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              </>}

              {/* ── Expandable detail (shared date) ── */}
              {detailBox(showOtp, setShowOtp, 'Telesales vs Direct Walk-in — full breakdown', t.gold,
                <OtpChannelsSection t={t} isMobile={isMobile} embedded fromTo={{ from, to }} filterType={filterType} filterValue={filterValue} />)}
              {d.jarvis?.available && detailBox(showJarvis, setShowJarvis, 'Jarvis footfall — by branch', t.blue,
                <JarvisFootfallSection t={t} isMobile={isMobile} embedded fromTo={{ from, to }} />)}
            </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
