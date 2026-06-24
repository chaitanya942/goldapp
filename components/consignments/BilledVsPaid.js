'use client'

// Billed vs Paid — case-wise reconciliation (Accounts module).
// Per case: each payment (Penny Drop / Release / Final), the customer's
// Account / IFSC / PAN / UTR, what the case shows as purchased (Billed), and
// what actually left our bank (CRM payout + live RazorpayX payouts matched by
// UTR / App-ID — a single final payment may be many split payouts). Rows that
// don't fully reconcile are flagged.

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

const money  = (n) => n == null ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN')
const fmtDate = (d) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]} ${y}` }

// Per-row reconciliation issues → drives the Status column + row highlight.
function issues(r) {
  const out = []
  if (r.paid == null || r.paid === 0)          out.push({ k: 'unpaid', label: 'Unpaid' })
  if (r.paid != null && Math.abs(r.diff) > 1)  out.push({ k: 'amount', label: 'Amount ≠' })
  if (r.acct_match === false)                  out.push({ k: 'acct',   label: 'Wrong a/c' })
  if (r.payout_sum_match === false)            out.push({ k: 'psum',   label: 'Payout ≠' })
  if (r.payout_acct_match === false)           out.push({ k: 'pacct',  label: 'Payout a/c' })
  return out
}

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
  const [filter, setFilter] = useState('all')   // all | flagged | acct | payout | unpaid

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
      const iss = issues(r)
      if (filter === 'flagged' && !iss.length) return false
      if (filter === 'acct'    && r.acct_match !== false) return false
      if (filter === 'payout'  && !(r.payout_sum_match === false || r.payout_acct_match === false)) return false
      if (filter === 'unpaid'  && !(r.paid == null || r.paid === 0)) return false
      if (!term) return true
      return [r.app_id, r.customer, r.branch, r.region, r.pan, r.utr, ...(r.utrs || [])].some(v => String(v || '').toLowerCase().includes(term))
    })
  }, [res, q, filter])

  const s = res?.summary

  async function download() {
    if (!rows.length) return
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
    const XLSX = window.XLSX
    const header = ['#', 'Customer', 'Bill / App ID', 'Branch', 'Region', 'CRM', 'Purchase Date',
      'Penny Drop (₹)', 'Release (₹)', 'Final (₹)', 'Billed (₹)',
      'Paid – CRM (₹)', 'Paid – Bank (₹)', 'Payouts', 'Payout Status',
      'Diff (₹)', 'Account No', 'IFSC', 'PAN', 'UTR(s)',
      'Account Match', 'Payout Sum Match', 'Payout A/c Match', 'Issues']
    const aoa = [header, ...rows.map((r, i) => [
      i + 1, r.customer, r.app_id, r.branch, r.region, r.crm.toUpperCase(), r.purchase_date,
      r.penny == null ? '' : Math.round(r.penny), r.release == null ? '' : Math.round(r.release), r.final == null ? '' : Math.round(r.final),
      Math.round(r.billed),
      r.paid_crm == null ? '' : Math.round(r.paid_crm), r.paid_bank == null ? '' : Math.round(r.paid_bank),
      r.payout_count || '', r.payout_status || '',
      r.diff == null ? '' : Math.round(r.diff), r.fin_acct || r.pen_acct, r.fin_ifsc || r.pen_ifsc, r.pan, (r.utrs || []).join(' '),
      r.acct_match == null ? '' : (r.acct_match ? 'MATCH' : 'MISMATCH'),
      r.payout_sum_match == null ? '' : (r.payout_sum_match ? 'MATCH' : 'MISMATCH'),
      r.payout_acct_match == null ? '' : (r.payout_acct_match ? 'MATCH' : 'MISMATCH'),
      issues(r).map(x => x.label).join('; '),
    ])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Billed vs Paid')
    XLSX.writeFile(wb, `Billed-vs-Paid_${from}_to_${to}.xlsx`)
  }

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

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Billed vs Paid</div>
          <div style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>
            Case-wise: each payment, customer bank/PAN/UTR, billed value, and the real money paid from our bank (RazorpayX) — flagged where it doesn't reconcile.
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
          ⚠ No RazorpayX payouts captured yet — <strong>Paid – Bank</strong> and payout validation are off. Point the Razorpay <strong>webhook</strong> at <code>/api/razorpay-webhook</code> (set <code>RAZORPAY_WEBHOOK_SECRET</code> on Railway) so payouts flow into the app; run the one-time backfill for history. No money-capable API key is stored. Until payouts arrive, <strong>Paid – CRM</strong> (what the CRM recorded) is shown.
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
          <Stat label="Total Billed" value={money(s.total_billed)} color={t.gold} />
          <Stat label={res.razorpay_linked ? 'Paid (Bank)' : 'Paid (CRM)'} value={money(res.razorpay_linked ? s.total_paid_bank : s.total_paid_crm)} color={t.green} />
          <Stat label="Amount ≠" value={s.amount_mismatch} color={s.amount_mismatch ? t.red : t.text2} sub="billed ≠ paid" />
          <Stat label="Wrong A/c" value={s.account_mismatch} color={s.account_mismatch ? t.red : t.text2} sub="paid ≠ verified" />
          {res.razorpay_linked && <Stat label="Payout ≠" value={s.payout_mismatch} color={s.payout_mismatch ? t.red : t.text2} sub="bank vs CRM" />}
          <Stat label="Unpaid" value={s.unpaid} color={s.unpaid ? t.orange : t.text2} />
        </div>
      )}

      {/* Filter + search */}
      {res && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {[['all', 'All'], ['flagged', 'Flagged'], ['acct', 'Wrong account'], ['payout', 'Payout mismatch'], ['unpaid', 'Unpaid']].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ background: filter === k ? `${t.gold}1d` : 'transparent', border: `1px solid ${filter === k ? `${t.gold}80` : t.border}`, color: filter === k ? t.gold : t.text3, borderRadius: 99, padding: '5px 13px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bill / customer / branch / PAN / UTR…"
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
              <th style={{ ...th, textAlign: 'right' }}>Penny</th>
              <th style={{ ...th, textAlign: 'right' }}>Release</th>
              <th style={{ ...th, textAlign: 'right' }}>Final</th>
              <th style={{ ...th, textAlign: 'right' }}>Billed</th>
              <th style={{ ...th, textAlign: 'right' }}>Paid (Bank)</th>
              <th style={th}>Account · IFSC</th>
              <th style={th}>PAN</th>
              <th style={th}>UTR</th>
              <th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const iss = issues(r)
                const bg = iss.some(x => ['acct', 'pacct'].includes(x.k)) ? `${t.red}10`
                         : iss.length ? `${t.orange}0c` : 'transparent'
                const acct = r.fin_acct || r.pen_acct
                const ifsc = r.fin_ifsc || r.pen_ifsc
                return (
                  <tr key={r.app_id + i} style={{ background: bg }}>
                    <td style={td}>
                      <div style={{ color: t.text1, fontWeight: 600 }}>{r.customer || '—'}</div>
                      <div style={{ fontSize: 10, color: t.text4, fontFamily: 'monospace' }}>{r.app_id} · <span style={{ color: r.crm === 'new' ? t.gold : t.text4 }}>{r.crm}</span></div>
                    </td>
                    <td style={td}>{r.branch || '—'}<div style={{ fontSize: 9.5, color: t.text4 }}>{r.region}</div></td>
                    <td style={{ ...num, color: r.penny ? t.green : t.text4 }} title={r.penny ? 'Penny-drop verified' : 'No penny drop'}>{r.penny == null ? '—' : (r.penny > 0 ? '✓' : '—')}</td>
                    <td style={num}>{money(r.release)}</td>
                    <td style={num}>{money(r.final)}</td>
                    <td style={{ ...num, color: t.gold }}>{money(r.billed)}</td>
                    <td style={num}>
                      {res.razorpay_linked ? money(r.paid_bank) : <span style={{ color: t.text4 }} title="CRM-recorded">{money(r.paid_crm)}*</span>}
                      {r.payout_count > 0 && <div style={{ fontSize: 9, color: t.text4 }}>{r.payout_count} payout{r.payout_count === 1 ? '' : 's'}{r.payout_status ? ` · ${r.payout_status}` : ''}</div>}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 10.5 }}>
                      {acct || '—'}<div style={{ fontSize: 9.5, color: t.text4 }}>{ifsc || ''}</div>
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 10.5 }}>{r.pan || '—'}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 10 }}>
                      {r.utr || '—'}{r.utr_count > 1 && <span style={{ color: t.text4 }}> +{r.utr_count - 1}</span>}
                    </td>
                    <td style={td}>
                      {iss.length === 0
                        ? <span style={{ color: t.green, fontWeight: 700, fontSize: 11 }}>✓ OK</span>
                        : <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {iss.map(x => (
                              <span key={x.k} style={{ fontSize: 9, fontWeight: 800, color: ['acct','pacct'].includes(x.k) ? t.red : t.orange, background: `${['acct','pacct'].includes(x.k) ? t.red : t.orange}1c`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{x.label}</span>
                            ))}
                          </div>}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: t.text4, padding: 40 }}>No cases for this range / filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
