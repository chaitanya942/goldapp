'use client'

// Finance & Accounts → Finance Performance. How long each payment request
// waits before a finance employee actions it — penny drop, final payment,
// release payment, manual payment — with employee / branch / region /
// transaction-type / request-type / time filters. Data: /api/finance-performance.

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istNow, istStr, istLastWeekRange } from '../../lib/dateIst'

const START = '2026-06-15'
const TYPES = [['PENNY_DROP', 'Penny drop'], ['FINAL_PAYMENT', 'Final payment'], ['RELEASE_PAYMENT', 'Release payment'], ['MANUAL_PAYMENT', 'Manual payment']]
const TYPE_LABEL = Object.fromEntries(TYPES)
const PERIODS = [['yesterday', 'Yesterday'], ['week', 'This Week'], ['last_week', 'Last Week'], ['mtd', 'MTD'], ['prev', 'Prev Month'], ['all', 'Since 15 Jun'], ['custom', 'Custom']]
const THRESHOLDS = [[0, 'Any time'], [10, '> 10 min'], [15, '> 15 min'], [20, '> 20 min']]

function rangeFor(key, custom) {
  const now = istNow(), y = now.getUTCFullYear(), m = now.getUTCMonth(), today = istStr(now)
  const pad = (n) => String(n).padStart(2, '0')
  let r
  if (key === 'yesterday') { const d = istStr(new Date(now - 86400000)); r = { from: d, to: d } }
  else if (key === 'week') { const dow = now.getUTCDay(); r = { from: istStr(new Date(now - (dow === 0 ? 6 : dow - 1) * 86400000)), to: today } }
  else if (key === 'last_week') r = istLastWeekRange()
  else if (key === 'mtd') r = { from: `${y}-${pad(m + 1)}-01`, to: today }
  else if (key === 'prev') { const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y; r = { from: `${py}-${pad(pm + 1)}-01`, to: `${py}-${pad(pm + 1)}-${pad(new Date(Date.UTC(py, pm + 1, 0)).getUTCDate())}` } }
  else if (key === 'all') r = { from: START, to: today }
  else { const to = custom.to && custom.to < today ? custom.to : today; r = { from: custom.from && custom.from <= to ? custom.from : to, to } }
  return r.from < START ? { ...r, from: START } : r
}

const fmtMin = (v) => (v == null ? '—' : v >= 120 ? `${(v / 60).toFixed(1)} h` : `${v.toFixed(1)} min`)

export default function FinancePerformance() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const today = istStr(istNow())
  const [period, setPeriod] = useState('week')
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today })
  const [types, setTypes] = useState([])
  const [employee, setEmployee] = useState(''), [branch, setBranch] = useState(''), [region, setRegion] = useState(''), [txnType, setTxnType] = useState('')
  const [min, setMin] = useState(0)
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const { from, to } = rangeFor(period, custom)

  const params = useCallback(() => {
    const p = new URLSearchParams({ from, to })
    if (types.length) p.set('types', types.join(','))
    if (employee) p.set('employee', employee); if (branch) p.set('branch', branch); if (region) p.set('region', region)
    if (txnType) p.set('txn_type', txnType); if (min) p.set('min', String(min))
    return p
  }, [from, to, types, employee, branch, region, txnType, min])

  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true }))
    authedFetch(`/api/finance-performance?${params()}`)
      .then(async r => { const j = await r.json().catch(() => null); if (!r.ok || !j) throw new Error(j?.error || `HTTP ${r.status}`); return j })
      .then(j => live && setState({ loading: false, data: j, error: null }))
      .catch(e => live && setState(s => ({ loading: false, data: s.data, error: e.message })))
    return () => { live = false }
  }, [params])

  const downloadCsv = async () => {
    const p = params(); p.set('format', 'csv')
    const r = await authedFetch(`/api/finance-performance?${p}`)
    if (!r.ok) return
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `finance-performance_${from}_to_${to}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const d = state.data
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12 }
  const pill = (on) => ({ padding: '5px 12px', borderRadius: 20, border: `1px solid ${on ? t.gold + '80' : t.border}`, background: on ? `${t.gold}20` : 'transparent', color: on ? t.gold : t.text3, fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 })
  const sel = { background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 8px', fontSize: 12, maxWidth: 220 }
  const th = { padding: '8px 10px', textAlign: 'right', fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: 12, color: t.text2, borderBottom: `1px solid ${t.border}`, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  const row = { display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', alignItems: 'center' }

  const SummaryTable = ({ title, list, keyLabel, labelFn = (k) => k }) => (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: t.text2, borderBottom: `1px solid ${t.border}` }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>{keyLabel}</th><th style={th}>Requests</th><th style={th}>Avg</th><th style={th}>Median</th><th style={th}>90th %ile</th><th style={th}>Max</th>
            <th style={th}>&gt; 10 min</th><th style={th}>&gt; 15 min</th><th style={th}>&gt; 20 min</th><th style={th}>View bill (median)</th><th style={th}>First click (median)</th>
          </tr></thead>
          <tbody>
            {list.map(x => (
              <tr key={x.key}>
                <td style={{ ...td, textAlign: 'left', color: t.text1, fontWeight: 600 }}>{labelFn(x.key)}{x.designation ? <span style={{ color: t.text4, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{x.designation}</span> : null}</td>
                <td style={td}>{x.count.toLocaleString('en-IN')}</td><td style={td}>{fmtMin(x.avg_min)}</td><td style={td}>{fmtMin(x.median_min)}</td>
                <td style={td}>{fmtMin(x.p90_min)}</td><td style={td}>{fmtMin(x.max_min)}</td>
                <td style={{ ...td, color: x.over10 ? (t.orange || t.gold) : t.text3 }}>{x.over10}</td>
                <td style={{ ...td, color: x.over15 ? (t.orange || t.gold) : t.text3 }}>{x.over15}</td>
                <td style={{ ...td, color: x.over20 ? t.red : t.text3 }}>{x.over20}</td>
                {[x.view_bill_median_min, x.first_click_median_min].map((v, i) => <td key={i} style={{ ...td, color: v == null ? t.text4 : t.text2 }}>{v == null ? 'not recorded' : fmtMin(v)}</td>)}
              </tr>
            ))}
            {!list.length && <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: t.text3, padding: 18 }}>No requests for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1 }}>Finance Performance</div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4, maxWidth: 760, lineHeight: 1.5 }}>
            Finance employees only. Time from when a payment request lands in the queue to when it&apos;s actioned — final payment (penny drop done → payout) and release (agreement signed → paid) measure the finance employee. Penny drop (Razorpay check: API request sent → approved) and manual payment are shown as processing time, not attributed to branch staff. Bill-view and first-click times appear once the CRM logs them.
          </div>
        </div>
        <button onClick={downloadCsv} disabled={!d?.case_count}
          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 12, color: d?.case_count ? t.text2 : t.text4, cursor: d?.case_count ? 'pointer' : 'default', fontWeight: 600 }}>↓ CSV</button>
      </div>

      <div style={row}>
        {PERIODS.map(([k, l]) => <button key={k} onClick={() => setPeriod(k)} style={pill(period === k)}>{l}</button>)}
        {period === 'custom' ? ['from', 'to'].map((k, i) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: i ? 0 : 6 }}>
            {i === 1 && <span style={{ color: t.text3, fontSize: 11.5 }}>→</span>}
            <input type="date" value={custom[k]} min={k === 'from' ? START : custom.from} max={k === 'from' ? custom.to : today}
              onChange={e => e.target.value && setCustom(c => ({ ...c, [k]: e.target.value }))}
              style={{ ...sel, colorScheme: 'light dark' }} />
          </span>
        )) : <span style={{ fontSize: 11.5, color: t.text3, marginLeft: 6, whiteSpace: 'nowrap' }}>{from === to ? from : `${from} → ${to}`}</span>}
      </div>
      <div style={row}>
        <button onClick={() => setTypes([])} style={pill(!types.length)}>All requests</button>
        {TYPES.map(([k, l]) => <button key={k} onClick={() => setTypes(ts => ts.includes(k) ? ts.filter(x => x !== k) : [...ts, k])} style={pill(types.includes(k))}>{l}</button>)}
        <span style={{ width: 1, height: 18, background: t.border, margin: '0 6px', flexShrink: 0 }} />
        {THRESHOLDS.map(([v, l]) => <button key={v} onClick={() => setMin(v)} style={pill(min === v)}>{l}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={employee} onChange={e => setEmployee(e.target.value)} style={sel}><option value="">All employees</option>{(d?.options.employees || []).map(x => <option key={x} value={x}>{x}</option>)}</select>
        <select value={region} onChange={e => { setRegion(e.target.value); setBranch('') }} style={sel}><option value="">All regions</option>{(d?.options.regions || []).map(x => <option key={x} value={x}>{x}</option>)}</select>
        <select value={branch} onChange={e => setBranch(e.target.value)} style={sel}><option value="">All branches</option>{(d?.options.branches || []).map(x => <option key={x} value={x}>{x}</option>)}</select>
        <select value={txnType} onChange={e => setTxnType(e.target.value)} style={sel}><option value="">All transaction types</option>{(d?.options.txnTypes || []).map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select>
      </div>

      {state.error && <div style={{ color: t.red, fontSize: 12.5 }}>Couldn&apos;t load: {state.error}</div>}
      {!d && state.loading && <div style={{ color: t.text3, fontSize: 13 }}>Loading… (a long range can take ~20s the first time)</div>}

      {d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: state.loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          <SummaryTable title={`By request type · ${d.case_count.toLocaleString('en-IN')} requests`} list={d.by_type} keyLabel="Request type" labelFn={k => TYPE_LABEL[k] || k} />
          <SummaryTable title={`By employee · ${d.by_employee.length}`} list={d.by_employee} keyLabel="Employee" />

          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: t.text2, borderBottom: `1px solid ${t.border}` }}>
              Requests, slowest first {d.case_count > d.cases.length ? `· top ${d.cases.length} of ${d.case_count.toLocaleString('en-IN')} (all in CSV)` : ''}
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Request', 'App ID', 'Txn type', 'Branch', 'Employee', 'Landed', 'Actioned', 'In queue', 'View bill', 'First click', 'Bank confirm', 'UTR', 'Screenshot'].map((h, i) =>
                    <th key={h} style={{ ...th, textAlign: i < 7 ? 'left' : 'right', position: 'sticky', top: 0, background: t.card }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.cases.map((c, i) => (
                    <tr key={`${c.code}-${c.req}-${i}`} title={c.basis}>
                      <td style={{ ...td, textAlign: 'left', color: t.text1 }}>{TYPE_LABEL[c.req]}</td>
                      <td style={{ ...td, textAlign: 'left', fontFamily: 'monospace' }}>{c.code}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{(c.txn_type || '').replace(/_/g, ' ')}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{c.branch}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{c.employee}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{c.landed_ist ? c.landed_ist.slice(5, 16) : '—'}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{c.actioned_ist ? c.actioned_ist.slice(5, 16) : '—'}</td>
                      <td style={{ ...td, fontWeight: 700, color: c.wait_min > 20 ? t.red : c.wait_min > 10 ? (t.orange || t.gold) : t.text1 }}>{fmtMin(c.wait_min)}</td>
                      <td style={td}>{fmtMin(c.view_bill_min)}</td><td style={td}>{fmtMin(c.first_click_min)}</td>
                      <td style={td}>{fmtMin(c.bank_min)}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{c.utr || '—'}</td>
                      <td style={td}>{c.screenshots ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
