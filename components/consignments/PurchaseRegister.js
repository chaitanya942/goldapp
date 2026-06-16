'use client'

// Purchase Register — unified daily-bills export across both CRMs (old MySQL +
// new Postgres), in the legacy 25-column format. Pick a date range, see the
// counts, and download the CSV. Sits under the Collection Audit module.

import { useState, useCallback, useEffect } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istToday, istDaysAgo } from '../../lib/dateIst'

export default function PurchaseRegister() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }

  const today = istToday()
  const [from, setFrom] = useState(today)
  const [to,   setTo]   = useState(today)
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState(null)   // { total, oldCount, newCount, csv, errors, from, to }
  const [err, setErr] = useState(null)

  const run = useCallback(async (f = from, t2 = to) => {
    setLoading(true); setErr(null); setRes(null)
    try {
      const r = await authedFetch(`/api/purchase-register?from=${f}&to=${t2}`)
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setRes(j)
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { run(today, today) }, [])   // auto-load today on mount

  const download = () => {
    if (!res?.csv) return
    const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = res.from === res.to ? `purchase-register-${res.from}.csv` : `purchase-register-${res.from}_to_${res.to}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const quick = (label, f, t2) => (
    <button onClick={() => { setFrom(f); setTo(t2); run(f, t2) }}
      style={{ background: 'transparent', border: `1px solid ${t.border2 || t.border}`, color: t.text2, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
      {label}
    </button>
  )

  const stat = (label, value, color) => (
    <div style={{ ...card, padding: '16px 18px', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 10.5, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || t.text1, marginTop: 6, fontFamily: 'monospace' }}>{value}</div>
    </div>
  )

  const inputStyle = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '7px 10px', color: t.text1, fontSize: 13, colorScheme: theme === 'dark' ? 'dark' : 'light' }

  return (
    <div style={{ padding: '8px 4px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: t.text1, margin: 0 }}>Purchase Register</h1>
        <p style={{ fontSize: 13, color: t.text3, marginTop: 4 }}>
          Daily approved/completed bills across <strong>both CRMs</strong>, in the standard 25-column report — download as CSV (opens in Excel).
        </p>
      </div>

      {/* Controls */}
      <div style={{ ...card, padding: '16px 18px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14, marginTop: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 10.5, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>From</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 10.5, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>To</span>
          <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={inputStyle} />
        </label>
        <button onClick={() => run()} disabled={loading}
          style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Loading…' : 'Generate'}
        </button>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {quick('Today', today, today)}
          {quick('Yesterday', istDaysAgo(1), istDaysAgo(1))}
          {quick('Last 7d', istDaysAgo(6), today)}
        </div>
      </div>

      {/* Results */}
      {loading && <div style={{ padding: 40, textAlign: 'center' }}><GoldSpinner /></div>}

      {err && !loading && (
        <div style={{ ...card, padding: 16, marginTop: 14, borderColor: `${t.red}55`, background: `${t.red}10`, color: t.red, fontSize: 13 }}>
          Couldn’t build the register: {err}
        </div>
      )}

      {res && !loading && (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
            {stat('Total bills', res.total, t.gold)}
            {stat('New CRM', res.newCount, t.blue)}
            {stat('Old CRM', res.oldCount, t.text2)}
          </div>

          {res.errors && (
            <div style={{ ...card, padding: 12, marginTop: 12, borderColor: `${t.orange || '#e58a3b'}55`, background: `${(t.orange||'#e58a3b')}10`, color: t.orange || '#e58a3b', fontSize: 12.5 }}>
              ⚠ Partial result — one source failed: {res.errors.join(' · ')}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={download} disabled={!res.total}
              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 9, padding: '10px 22px', fontSize: 14, fontWeight: 800, cursor: res.total ? 'pointer' : 'default', opacity: res.total ? 1 : 0.5, boxShadow: `0 2px 8px ${t.gold}44` }}>
              ↓ Download CSV ({res.total} rows)
            </button>
            <span style={{ fontSize: 12, color: t.text4 }}>
              {res.from === res.to ? res.from : `${res.from} → ${res.to}`} · 25 columns
            </span>
          </div>

          <div style={{ fontSize: 11.5, color: t.text4, marginTop: 14, lineHeight: 1.5 }}>
            Note: <em>Bank Branch</em> isn’t stored in the new CRM (blank for new-CRM rows), and <em>Bank Name</em> is the payment rail/processor. Old-CRM <em>Service Charge Amount</em> is computed from the % when not stored.
          </div>
        </>
      )}
    </div>
  )
}
