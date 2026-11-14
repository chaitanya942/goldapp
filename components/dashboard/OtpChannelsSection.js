'use client'

// Dashboard section: Telesales (TS) vs Direct Walk-in (DW), from CRM OTP
// generation — OTPs issued per channel, how many walked in, how many became
// purchases, by region / branch / day. Follows the dashboard's period and
// location (region / state / cluster / branch) filter, and the CSV download
// carries the same filters. Data from 1 Oct 2026. Data: /api/otp-channels (lib/otpChannels.js).

import { useState, useEffect, useMemo, useCallback } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istNow, istStr, istLastWeekRange } from '../../lib/dateIst'
import { toCsv } from '../../lib/billedVsPaidFormat'

const DATA_START = '2026-10-01'
const PERIODS = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' }, { key: 'last_week', label: 'Last Week' },
  { key: 'mtd', label: 'MTD' }, { key: 'prev', label: 'Prev Month' }, { key: 'ytd', label: 'YTD' },
  { key: 'custom', label: 'Custom' },
]

// Same periods as the dashboard (+ Custom); ranges never start before 1 Oct
// 2026 and never end after today.
function rangeFor(key, custom) {
  const now = istNow(), y = now.getUTCFullYear(), m = now.getUTCMonth(), today = istStr(now)
  const pad = (n) => String(n).padStart(2, '0')
  let r
  if (key === 'yesterday') { const d = istStr(new Date(now - 86400000)); r = { from: d, to: d } }
  else if (key === 'week') { const dow = now.getUTCDay(), off = dow === 0 ? 6 : dow - 1; r = { from: istStr(new Date(now - off * 86400000)), to: today } }
  else if (key === 'last_week') r = istLastWeekRange()
  else if (key === 'mtd') r = { from: `${y}-${pad(m + 1)}-01`, to: today }
  else if (key === 'prev') { const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y, last = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate(); r = { from: `${py}-${pad(pm + 1)}-01`, to: `${py}-${pad(pm + 1)}-${pad(last)}` } }
  else if (key === 'ytd') r = { from: m >= 3 ? `${y}-04-01` : `${y - 1}-04-01`, to: today }
  else if (key === 'custom') {
    const to = custom?.to && custom.to < today ? custom.to : today
    r = { from: custom?.from && custom.from <= to ? custom.from : to, to }
  }
  else r = { from: today, to: today }
  if (r.from < DATA_START) r = { ...r, from: DATA_START }
  return r.to < DATA_START ? { from: null, to: null } : r
}

const fmtN   = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))
const fmtPct = (p) => (p == null ? '—' : `${(p * 100).toFixed(p >= 0.995 ? 0 : 1)}%`)
const fmtCr  = (v) => (!v ? '₹0' : v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : `₹${(v / 1e5).toFixed(1)} L`)
const fmtDay = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }

const FILTER_LABEL = { region: 'Region', state: 'State', cluster: 'Cluster', branch: 'Branch' }

export default function OtpChannelsSection({ t, isMobile, period: dashPeriod = null, filterType = null, filterValue = null }) {
  const [open, setOpen] = useState(true)
  const [period, setPeriod] = useState(dashPeriod || 'mtd')
  // The dashboard's period picker drives this section; its own pills (incl. Custom) can still override.
  useEffect(() => { if (dashPeriod) setPeriod(dashPeriod) }, [dashPeriod])
  const loc = filterType && filterValue ? { type: filterType, value: filterValue } : null
  const [custom, setCustom] = useState(() => { const t2 = istStr(istNow()); return { from: `${t2.slice(0, 7)}-01`, to: t2 } })
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [showAll, setShowAll] = useState(false)
  const { from, to } = rangeFor(period, custom)
  const today = istStr(istNow())

  const load = useCallback(async () => {
    if (!from) { setState({ loading: false, data: null, error: null }); return }
    setState(s => ({ ...s, loading: true }))
    try {
      const res = await authedFetch(`/api/otp-channels?from=${from}&to=${to}${loc ? `&filter_type=${loc.type}&filter_value=${encodeURIComponent(loc.value)}` : ''}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) throw new Error(json?.error || `Server error (HTTP ${res.status})`)
      setState({ loading: false, data: json, error: null })
    } catch (e) { setState(s => ({ loading: false, data: s.data, error: e.message })) }
  }, [from, to, loc?.type, loc?.value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) load() }, [open, load])

  const d = state.data
  const branches = useMemo(() => (showAll ? d?.branches || [] : (d?.branches || []).slice(0, 12)), [d, showAll])

  const pill = (active) => ({
    padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? t.gold + '80' : t.border}`,
    background: active ? `${t.gold}20` : 'transparent', color: active ? t.gold : t.text3,
    fontSize: 11.5, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  })
  const th = { padding: '8px 10px', textAlign: 'right', fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: 12.5, color: t.text2, borderBottom: `1px solid ${t.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const C = { TS: t.blue, DW: t.gold }

  const ChannelCard = ({ ch, label }) => {
    const x = d?.totals?.[ch]
    return (
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderTop: `2px solid ${C[ch]}`, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C[ch], textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{label} <span style={{ color: t.text4 }}>· {ch}</span></div>
        <div style={{ fontSize: 24, fontWeight: 700, color: t.text1, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtN(x?.otps)} <span style={{ fontSize: 12, color: t.text3, fontWeight: 500 }}>OTPs</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginTop: 10 }}>
          {[['Walked in', x?.walked_in, x?.walkin_rate, null, 'of OTPs'], ['Purchased', x?.purchased, x?.purchase_rate, null, 'of walk-ins'], ['Value', null, null, x?.purchase_value]].map(([lab, n, rate, val, of]) => (
            <div key={lab} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{lab}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: t.text1, fontVariantNumeric: 'tabular-nums' }}>{val != null ? fmtCr(val) : fmtN(n)}</div>
              {rate != null && <div style={{ fontSize: 10.5, color: t.text3 }}>{fmtPct(rate)} {of}</div>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const maxDay = Math.max(1, ...(d?.days || []).map(x => Math.max(x.TS, x.DW)))

  // Plain CSV of everything loaded for the period: summary, regions, branches, daily OTPs.
  const downloadCsv = () => {
    if (!d) return
    const pct = (p) => (p == null ? '' : (p * 100).toFixed(1))
    const inr = (v) => Math.round(Number(v) || 0)
    const rate = (a, b) => (b ? a / b : null)
    const chCols = (x = {}) => [x.otps || 0, x.walked_in || 0, pct(rate(x.walked_in, x.otps)), x.purchased || 0, pct(rate(x.purchased, x.walked_in)), inr(x.purchase_value)]
    const chHead = (p) => [`${p} OTPs`, `${p} Walked In`, `${p} Walk-in Rate %`, `${p} Purchased`, `${p} Purchase Rate %`, `${p} Purchase Value (INR)`]
    const aoa = [
      ['Telesales vs Direct Walk-in (CRM OTP)'], ['Period', PERIODS.find(p => p.key === period)?.label || period, d.from, 'to', d.to],
      ['Filter', d.filter ? `${FILTER_LABEL[d.filter.type]}: ${d.filter.value}` : 'All Data'], [],
      ['Channel', 'Prefix', 'OTPs', 'Walked In', 'Walk-in Rate %', 'Purchased', 'Purchase Rate %', 'Purchase Value (INR)'],
      ['Telesales', 'TS', ...chCols(d.totals?.TS)],
      ['Direct Walk-in', 'DW', ...chCols(d.totals?.DW)],
      [],
      ['By Region'], ['Region', ...chHead('TS'), ...chHead('DW')],
      ...(d.regions || []).map(r => [r.region, ...chCols(r.TS), ...chCols(r.DW)]),
      [],
      ['By Branch'], ['Branch', 'Region', ...chHead('TS'), ...chHead('DW')],
      ...(d.branches || []).map(b => [b.branch, b.region, ...chCols(b.TS), ...chCols(b.DW)]),
      [],
      ['Daily OTPs'], ['Date', 'TS OTPs', 'DW OTPs'],
      ...(d.days || []).map(x => [x.date, x.TS || 0, x.DW || 0]),
    ].map(row => row.map(v => (typeof v === 'string' ? v.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim() : v)))
    const blob = new Blob([toCsv(aoa)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `telesales-vs-direct-walkin${d.filter ? '_' + String(d.filter.value).replace(/[^A-Za-z0-9]+/g, '-') : ''}_${d.from}_to_${d.to}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div style={{ marginTop: 14, border: `1px solid ${t.border2 || t.border}`, borderRadius: 20, background: `linear-gradient(160deg,${t.card2},${t.card3 || t.card2})`, boxShadow: t.shadow, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '14px 16px' : '16px 24px', cursor: 'pointer', userSelect: 'none', borderBottom: open ? `1px solid ${t.border}` : 'none' }}>
        <div style={{ width: 3, height: 20, borderRadius: 2, background: `linear-gradient(180deg,${t.blue},${t.gold})`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 12.5 : 14, color: t.text2, letterSpacing: isMobile ? '.08em' : '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Telesales vs Direct Walk-in</div>
          {open && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>By CRM OTP (TS / DW) · OTPs by day generated, walk-ins by walk-in day, purchases by payment day · from 1 Oct 2026</div>}
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
                    <input type="date" value={custom[k] || ''}
                      min={k === 'from' ? DATA_START : (custom.from || DATA_START)}
                      max={k === 'from' ? (custom.to || today) : today}
                      onChange={e => e.target.value && setCustom(c => ({ ...c, [k]: e.target.value }))}
                      style={{ background: t.card, color: t.text1, border: `1px solid ${t.border}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, colorScheme: 'light dark' }} />
                  </span>
                ))}
              </span>
            ) : (
              <span style={{ fontSize: 11.5, color: t.text3, marginLeft: 6, whiteSpace: 'nowrap' }}>{from ? (from === to ? from : `${from} → ${to}`) : 'No data before 1 Oct 2026'}</span>
            )}
            {loc && <span style={{ fontSize: 11.5, color: t.gold, marginLeft: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>· {FILTER_LABEL[loc.type]}: {loc.value}</span>}
            {d && <button onClick={downloadCsv} title="Download this period as CSV" style={{ ...pill(false), marginLeft: 'auto', color: t.gold, borderColor: `${t.gold}60` }}>↓ CSV</button>}
          </div>

          {state.error && !d && <div style={{ fontSize: 13, color: t.red }}>Couldn&apos;t load: {state.error}</div>}
          {!d && state.loading && <div style={{ fontSize: 13, color: t.text3 }}>Loading…</div>}

          {d && (
            <div style={{ opacity: state.loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                <ChannelCard ch="TS" label="Telesales" />
                <ChannelCard ch="DW" label="Direct Walk-in" />
              </div>

              {d.days.length > 1 && (
                <div style={{ marginTop: 12, background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, fontWeight: 700, color: t.text2 }}>
                    <span>OTPs per day</span>
                    <span style={{ display: 'flex', gap: 12, fontSize: 11, color: t.text3, fontWeight: 500 }}>
                      {['TS', 'DW'].map(c => <span key={c}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C[c], marginRight: 5 }} />{c === 'TS' ? 'Telesales' : 'Direct Walk-in'}</span>)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 130, overflowX: 'auto' }}>
                    {d.days.map(x => (
                      <div key={x.date} title={`${x.date}: TS ${x.TS}, DW ${x.DW}`} style={{ flex: '1 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 108 }}>
                          {['TS', 'DW'].map(c => <div key={c} style={{ width: d.days.length > 20 ? 6 : 10, height: `${(x[c] / maxDay) * 108}px`, background: C[c], borderRadius: '3px 3px 0 0' }} />)}
                        </div>
                        <div style={{ fontSize: 9.5, color: t.text3, marginTop: 4 }}>{fmtDay(x.date)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {[{ title: 'By region', key: 'region', list: d.regions }, { title: `By branch · ${d.branches.length}`, key: 'branch', list: branches }].map(sec => (
                <div key={sec.key} style={{ marginTop: 12, background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: t.text2, borderBottom: `1px solid ${t.border}` }}>{sec.title}</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, textAlign: 'left' }}>{sec.key === 'region' ? 'Region' : 'Branch'}</th>
                          <th style={{ ...th, color: C.TS }}>TS OTPs</th><th style={{ ...th, color: C.TS }}>TS walk-ins</th><th style={{ ...th, color: C.TS }}>TS purchased</th>
                          <th style={{ ...th, color: C.DW }}>DW walk-ins</th><th style={{ ...th, color: C.DW }}>DW purchased</th>
                          <th style={th}>TS share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec.list.map(x => {
                          const tot = x.TS.otps + x.DW.otps
                          return (
                            <tr key={x[sec.key]}>
                              <td style={{ ...td, textAlign: 'left', color: t.text1, fontWeight: 600 }}>{x[sec.key]}{sec.key === 'branch' && !isMobile && x.region ? <span style={{ color: t.text4, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{x.region}</span> : null}</td>
                              <td style={td}>{fmtN(x.TS.otps)}</td>
                              <td style={td}>{fmtN(x.TS.walked_in)} <span style={{ color: t.text4, fontSize: 11 }}>{fmtPct(x.TS.otps ? x.TS.walked_in / x.TS.otps : null)}</span></td>
                              <td style={td}>{fmtN(x.TS.purchased)}</td>
                              <td style={td}>{fmtN(x.DW.walked_in)}</td>
                              <td style={td}>{fmtN(x.DW.purchased)}</td>
                              <td style={td}>{fmtPct(tot ? x.TS.otps / tot : null)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {sec.key === 'branch' && d.branches.length > 12 && (
                    <button onClick={() => setShowAll(v => !v)} style={{ width: '100%', padding: '9px 0', border: 'none', borderTop: `1px solid ${t.border}`, background: 'transparent', color: t.gold, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {showAll ? 'Show top 12' : `Show all ${d.branches.length} branches`}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
