'use client'

// 50L+ Transactions — Finance & Accounts.
// Customers (matched by mobile) whose cumulative final amount this financial
// year exceeds ₹50,00,000, and their bills in the chosen window, in the Billed
// vs Paid case-wise format plus FY-cumulative columns. Data: /api/fifty-lakh.

import { useState, useCallback, useEffect, useMemo, Fragment } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istToday } from '../../lib/dateIst'
import { bvpIssues } from '../../lib/billedVsPaidFormat'
import { fiftyLakhCsv } from '../../lib/fiftyLakhFormat'

const money   = (n) => n == null ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN')
const lakh    = (n) => n == null ? '—' : '₹' + (Number(n) / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + 'L'
const fmtDate = (d) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]} ${y}` }

export default function FiftyLakhTransactions() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }

  const today = istToday()
  const [from, setFrom] = useState('2026-06-15')
  const [to,   setTo]   = useState(today)
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [q,   setQ]   = useState('')

  const run = useCallback(async (f = from, t2 = to) => {
    setLoading(true); setErr(null)
    try {
      const r = await authedFetch(`/api/fifty-lakh?from=${f}&to=${t2}`)
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setRes(j)
    } catch (e) { setErr(String(e?.message || e)) }
    finally { setLoading(false) }
  }, [from, to])

  useEffect(() => { run() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (res?.rows || []).filter(r => !term ||
      [r.app_id, r.customer, r.customer_name, ...(r.customer_names || []), ...(r.mobiles || []), r.branch, r.region, r.utr, ...(r.utrs || [])].some(v => String(v || '').toLowerCase().includes(term)))
  }, [res, q])

  function download() {
    if (!rows.length) return
    const blob = new Blob([fiftyLakhCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `50L-plus-transactions_${res.from}_to_${res.to}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const s = res?.summary
  const Stat = ({ label, value, color, sub }) => (
    <div style={{ ...card, padding: '14px 16px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 19, color: color || t.text1, fontWeight: 700, marginTop: 4, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: t.text4, marginTop: 2 }}>{sub}</div>}
    </div>
  )
  const th = { textAlign: 'left', padding: '9px 10px', fontSize: 9.5, color: t.text4, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: `1px solid ${t.border}` }
  const td = { padding: '8px 10px', fontSize: 11.5, color: t.text2, borderBottom: `1px solid ${t.border}40`, whiteSpace: 'nowrap', verticalAlign: 'top' }
  const num = { ...td, textAlign: 'right', fontFamily: 'monospace' }
  const dateInput = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, color: t.text1 }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>50L+ Transactions</div>
          <div style={{ fontSize: 11, color: t.text3, marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>
            Customers whose total final amount this financial year (from {fmtDate(res?.fy_start || '2026-04-01')}, old + new CRM) is more than ₹50,00,000, with their bills in the selected window grouped under their name. A customer = same mobile, or the same full name at the same branch.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={dateInput} />
          <span style={{ color: t.text4, fontSize: 12 }}>→</span>
          <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={dateInput} />
          <button onClick={() => run()} disabled={loading}
            style={{ background: loading ? t.card2 : t.gold, color: loading ? t.text4 : '#1a0a00', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Loading…' : 'Run'}
          </button>
          <button onClick={download} disabled={!rows.length}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 12, color: rows.length ? t.text2 : t.text4, cursor: rows.length ? 'pointer' : 'default', fontWeight: 600 }}>
            ↓ CSV
          </button>
        </div>
      </div>

      {res?.warnings?.length > 0 && (
        <div style={{ ...card, padding: '10px 14px', borderColor: `${t.red}50`, background: `${t.red}0c`, fontSize: 11, color: t.red }}>
          {res.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      {err && <div style={{ ...card, padding: 14, color: t.red, fontSize: 12 }}>{err}</div>}

      {s && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Stat label="Customers over ₹50L" value={s.customers} sub={`${s.customers_in_window} with bills in window · ${s.multi_mobile_customers} with 2+ mobiles`} color={t.gold} />
          <Stat label="Bills in window" value={s.bills} sub={`${fmtDate(res.from)} → ${fmtDate(res.to)}`} />
          <Stat label="Window value" value={lakh(s.window_total)} color={t.green} sub="final amount" />
          <Stat label="FY bills checked" value={s.fy_bills_scanned.toLocaleString('en-IN')} sub={s.unidentified_bills ? `${s.unidentified_bills} without a mobile` : 'all matched by mobile'} />
        </div>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, mobile, App ID, branch, UTR…"
        style={{ ...dateInput, padding: '8px 12px', maxWidth: 360 }} />

      <div style={{ ...card, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['#', 'Customer', 'Mobile', 'App ID', 'Branch', 'Date', 'Final', 'FY cumulative', 'FY total', 'Paid', 'Account / IFSC', 'UTR(s)', 'Issues'].map(h =>
                <th key={h} style={['Final', 'FY cumulative', 'FY total', 'Paid'].includes(h) ? { ...th, textAlign: 'right' } : th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const iss = bvpIssues(r)
              const newCustomer = i === 0 || rows[i - 1].customer_id !== r.customer_id
              return (
                <Fragment key={r.app_id}>
                  {newCustomer && (
                    <tr style={{ background: `${t.gold}0c` }}>
                      <td colSpan={13} style={{ ...td, padding: '10px 10px 8px', borderBottom: `1px solid ${t.gold}30`, whiteSpace: 'normal' }}>
                        <span style={{ color: t.text1, fontWeight: 700, fontSize: 12.5 }}>{r.customer_name}</span>
                        <span style={{ color: t.gold, fontWeight: 700, fontFamily: 'monospace', marginLeft: 10 }}>FY total {lakh(r.fy_total)}</span>
                        <span style={{ color: t.text3, marginLeft: 10 }}>{r.fy_bills} bill{r.fy_bills === 1 ? '' : 's'} this FY · {(r.mobiles || []).join(', ')}</span>
                        {(r.customer_names || []).length > 1 && <span style={{ color: t.text4, marginLeft: 10, fontSize: 10.5 }}>also as: {r.customer_names.filter(n => n !== r.customer_name).join(', ')}</span>}
                      </td>
                    </tr>
                  )}
                  <tr style={{ background: r.crossed_here ? `${t.gold}10` : 'transparent' }}>
                    <td style={{ ...td, color: t.text4 }}>{i + 1}</td>
                    <td style={{ ...td, color: t.text2 }}>{r.customer}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.mobile}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.app_id}</td>
                    <td style={td}>{r.branch}</td>
                    <td style={td}>{fmtDate(r.purchase_date)}</td>
                    <td style={num}>{money(r.billed)}</td>
                    <td style={{ ...num, color: r.fy_running > 5e6 ? t.gold : t.text2 }}>
                      {money(r.fy_running)}{r.crossed_here && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: t.gold }}>CROSSED 50L</span>}
                    </td>
                    <td style={{ ...num, color: t.text3 }}>{lakh(r.fy_total)}</td>
                    <td style={num}>{money(r.paid)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{(r.fin_acct || r.pen_acct) || '—'}{(r.fin_ifsc || r.pen_ifsc) ? ` · ${r.fin_ifsc || r.pen_ifsc}` : ''}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{(r.utrs || []).join(' ') || '—'}</td>
                    <td style={td}>{iss.length ? iss.map(x => <span key={x.k} style={{ fontSize: 10, fontWeight: 700, color: t.red, background: `${t.red}14`, borderRadius: 5, padding: '2px 6px', marginRight: 4 }}>{x.label}</span>) : <span style={{ color: t.green, fontSize: 11 }}>OK</span>}</td>
                  </tr>
                </Fragment>
              )
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={13} style={{ ...td, textAlign: 'center', padding: 22, color: t.text4 }}>{res ? 'No bills match.' : 'Run the report to load.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: t.text4 }}>The CSV lists each customer's bills under a heading row (name, all mobiles, FY total), with every Billed vs Paid case-wise column plus customer group, mobiles, name variants, FY cumulative, FY total, FY bill count and the bill that crossed ₹50L.</div>
    </div>
  )
}
