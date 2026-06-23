'use client'

// Billed vs Paid — case-wise reconciliation (Accounts module).
// Compares what each case shows as PURCHASED (billed) against what actually
// left our bank (CRM payout, and the live RazorpayX payout when linked), and
// flags whether the final payment went to the penny-drop-verified account.

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istToday, istDaysAgo } from '../../lib/dateIst'

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script'); s.src = src
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

const fmtMoney = (n) => n == null ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN')
const fmtDate  = (d) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]} ${y}` }

export default function BilledVsPaid() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }

  const today = istToday()
  const [from, setFrom] = useState(istDaysAgo(7))
  const [to,   setTo]   = useState(today)
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [q,   setQ]   = useState('')
  const [filter, setFilter] = useState('all')   // all | mismatch | acct | unpaid

  const run = useCallback(async (f = from, t2 = to) => {
    setLoading(true); setErr(null)
    try {
      const r = await authedFetch(`/api/billed-vs-paid?from=${f}&to=${t2}`)
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setRes(j)
    } catch (e) { setErr(String(e?.message || e)) }
    finally { setLoading(false) }
  }, [from, to])

  useEffect(() => { run() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const all = res?.rows || []
    const term = q.trim().toLowerCase()
    return all.filter(r => {
      if (filter === 'mismatch' && !(r.paid != null && Math.abs(r.diff) > 1)) return false
      if (filter === 'acct'     && r.acct_match !== false) return false
      if (filter === 'unpaid'   && !(r.paid == null || r.paid === 0)) return false
      if (!term) return true
      return [r.app_id, r.customer, r.branch, r.region, r.utr].some(v => String(v || '').toLowerCase().includes(term))
    })
  }, [res, q, filter])

  const s = res?.summary

  async function download() {
    if (!rows.length) return
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
    const XLSX = window.XLSX
    const header = ['#', 'Bill / App ID', 'Customer', 'Branch', 'Region', 'CRM', 'Purchase Date',
      'Billed (₹)', 'Paid – CRM (₹)', 'Paid – Bank (₹)', 'Payout Status', 'Diff (₹)',
      'Account Match', 'Final A/c', 'Verified A/c', 'UTR', 'Processor']
    const aoa = [header, ...rows.map((r, i) => [
      i + 1, r.app_id, r.customer, r.branch, r.region, r.crm.toUpperCase(), r.purchase_date,
      Math.round(r.billed), r.paid_crm == null ? '' : Math.round(r.paid_crm),
      r.paid_bank == null ? '' : Math.round(r.paid_bank), r.payout_status || '',
      r.diff == null ? '' : Math.round(r.diff),
      r.acct_match == null ? '' : (r.acct_match ? 'MATCH' : 'MISMATCH'),
      r.fin_acct, r.pen_acct, r.utr, r.processor,
    ])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Billed vs Paid')
    XLSX.writeFile(wb, `Billed-vs-Paid_${from}_to_${to}.xlsx`)
  }

  const Stat = ({ label, value, color, sub }) => (
    <div style={{ ...card, padding: '14px 16px', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, color: color || t.text1, fontWeight: 700, marginTop: 4, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: t.text4, marginTop: 2 }}>{sub}</div>}
    </div>
  )

  const th = { textAlign: 'left', padding: '9px 10px', fontSize: 10, color: t.text4, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: `1px solid ${t.border}` }
  const td = { padding: '9px 10px', fontSize: 12, color: t.text2, borderBottom: `1px solid ${t.border}40`, whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Billed vs Paid</div>
          <div style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>
            Case-wise: purchased value vs money actually paid from our bank, and whether it went to the verified account.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, color: t.text1 }} />
          <span style={{ color: t.text4, fontSize: 12 }}>→</span>
          <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)}
            style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, color: t.text1 }} />
          <button onClick={() => run()} disabled={loading}
            style={{ background: loading ? t.card2 : t.gold, color: loading ? t.text4 : '#1a0a00', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Loading…' : 'Run'}
          </button>
          <button onClick={download} disabled={!rows.length}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 12, color: rows.length ? t.text2 : t.text4, cursor: rows.length ? 'pointer' : 'default', fontWeight: 600 }}>
            ↓ Excel
          </button>
        </div>
      </div>

      {/* Razorpay-link status */}
      {res && !res.razorpay_linked && (
        <div style={{ ...card, padding: '10px 14px', borderColor: `${t.orange}50`, background: `${t.orange}0c`, fontSize: 11.5, color: t.orange }}>
          ⚠ RazorpayX not linked — the <strong>Paid – Bank</strong> column is blank. Add <code>RAZORPAY_KEY_ID</code>, <code>RAZORPAY_KEY_SECRET</code> and <code>RAZORPAYX_ACCOUNT_NUMBER</code> on Railway to verify the real money-out against the bank. Until then, <strong>Paid – CRM</strong> (what the CRM recorded) is shown.
        </div>
      )}
      {res?.warnings?.length > 0 && (
        <div style={{ ...card, padding: '10px 14px', borderColor: `${t.red}50`, background: `${t.red}0c`, fontSize: 11, color: t.red }}>
          {res.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {err && <div style={{ ...card, padding: 14, color: t.red, fontSize: 12 }}>{err}</div>}

      {/* Summary */}
      {s && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Stat label="Cases" value={s.cases} sub={`${fmtDate(res.from)} → ${fmtDate(res.to)}`} />
          <Stat label="Total Billed" value={fmtMoney(s.total_billed)} color={t.gold} />
          <Stat label={res.razorpay_linked ? 'Paid (Bank)' : 'Paid (CRM)'} value={fmtMoney(res.razorpay_linked ? s.total_paid_bank : s.total_paid_crm)} color={t.green} />
          <Stat label="Amount Mismatch" value={s.amount_mismatch} color={s.amount_mismatch ? t.red : t.text2} sub="billed ≠ paid" />
          <Stat label="Account Mismatch" value={s.account_mismatch} color={s.account_mismatch ? t.red : t.text2} sub="paid ≠ verified a/c" />
          <Stat label="Unpaid" value={s.unpaid} color={s.unpaid ? t.orange : t.text2} />
        </div>
      )}

      {/* Filter + search */}
      {res && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {[['all', 'All'], ['mismatch', 'Amount mismatch'], ['acct', 'Account mismatch'], ['unpaid', 'Unpaid']].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ background: filter === k ? `${t.gold}1d` : 'transparent', border: `1px solid ${filter === k ? `${t.gold}80` : t.border}`, color: filter === k ? t.gold : t.text3, borderRadius: 99, padding: '5px 13px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bill / customer / branch / UTR…"
            style={{ flex: 1, minWidth: 200, background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, color: t.text1, outline: 'none' }} />
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: 80, textAlign: 'center' }}><GoldSpinner /></div>
      ) : res && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Customer · Bill</th>
              <th style={th}>Branch</th>
              <th style={th}>Date</th>
              <th style={{ ...th, textAlign: 'right' }}>Billed</th>
              <th style={{ ...th, textAlign: 'right' }}>Paid (CRM)</th>
              <th style={{ ...th, textAlign: 'right' }}>Paid (Bank)</th>
              <th style={{ ...th, textAlign: 'right' }}>Diff</th>
              <th style={{ ...th, textAlign: 'center' }}>Account</th>
              <th style={th}>UTR · Processor</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const mism = r.paid != null && Math.abs(r.diff) > 1
                return (
                  <tr key={r.app_id + i} style={{ background: r.acct_match === false ? `${t.red}0c` : mism ? `${t.orange}08` : 'transparent' }}>
                    <td style={td}>
                      <div style={{ color: t.text1, fontWeight: 600 }}>{r.customer || '—'}</div>
                      <div style={{ fontSize: 10.5, color: t.text4, fontFamily: 'monospace' }}>{r.app_id} · <span style={{ color: r.crm === 'new' ? t.gold : t.text4 }}>{r.crm}</span></div>
                    </td>
                    <td style={td}>{r.branch || '—'}<div style={{ fontSize: 10, color: t.text4 }}>{r.region || ''}</div></td>
                    <td style={{ ...td, fontSize: 11 }}>{fmtDate(r.purchase_date)}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.gold }}>{fmtMoney(r.billed)}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtMoney(r.paid_crm)}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmtMoney(r.paid_bank)}
                      {r.payout_status && <div style={{ fontSize: 9, color: /processed/i.test(r.payout_status) ? t.green : t.red, textTransform: 'uppercase', fontWeight: 700 }}>{r.payout_status}</div>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: r.diff == null ? t.text4 : Math.abs(r.diff) > 1 ? t.red : t.green }}>
                      {r.diff == null ? '—' : (r.diff > 0 ? '+' : '') + fmtMoney(r.diff).replace('₹', '₹')}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {r.acct_match == null
                        ? <span style={{ color: t.text4 }}>—</span>
                        : r.acct_match
                          ? <span style={{ color: t.green, fontWeight: 800 }} title={`Paid to verified a/c ${r.fin_acct}`}>✓</span>
                          : <span style={{ color: t.red, fontWeight: 800 }} title={`Paid to ${r.fin_acct} · verified ${r.pen_acct}`}>✗</span>}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 10.5 }}>{r.utr || '—'}<div style={{ fontSize: 9.5, color: t.text4 }}>{r.processor}</div></td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: t.text4, padding: 40 }}>No cases for this range / filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
