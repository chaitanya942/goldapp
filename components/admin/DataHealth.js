'use client'

// Admin → Data Health (super_admin): runs the accuracy checks from
// lib/dataHealth.js on demand. The cron worker runs the same checks every
// 30 min, re-syncs automatically when data is missing, and emails
// DATA_HEALTH_EMAILS when a check fails.

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

export default function DataHealth() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [state, setState] = useState({ loading: true, data: null, error: null })

  const run = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))
    try {
      const res = await authedFetch('/api/data-health')
      const j = await res.json().catch(() => null)
      if (!res.ok || !j) throw new Error(j?.error || `HTTP ${res.status}`)
      setState({ loading: false, data: j, error: null })
    } catch (e) { setState(s => ({ loading: false, data: s.data, error: e.message })) }
  }, [])
  useEffect(() => { run() }, [run])

  const d = state.data
  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1 }}>Data Health</div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4, lineHeight: 1.5 }}>
            Checks that purchases, walk-ins, the Telesales / Direct Walk-in split and Jarvis footfall match their sources. Runs automatically every 30 minutes; missing data triggers a re-sync, and failures are emailed.
          </div>
        </div>
        <button onClick={run} disabled={state.loading}
          style={{ background: state.loading ? t.card2 : t.gold, color: state.loading ? t.text4 : '#1a0a00', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: state.loading ? 'default' : 'pointer' }}>
          {state.loading ? 'Checking…' : 'Run checks now'}
        </button>
      </div>
      {state.error && <div style={{ color: t.red, fontSize: 12.5 }}>Couldn&apos;t run checks: {state.error}</div>}
      {d && (
        <>
          <div style={{ fontSize: 12, color: d.ok ? t.green : t.red, fontWeight: 700 }}>
            {d.ok ? 'All checks passing' : 'Some checks are failing'} · {new Date(d.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
          </div>
          {d.results.map(r => (
            <div key={r.key} style={{ background: t.card, border: `1px solid ${r.ok ? t.border : t.red + '60'}`, borderLeft: `3px solid ${r.ok ? t.green : t.red}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: r.ok ? t.green : t.red }}>{r.ok ? 'OK' : 'FAILING'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.text1 }}>{r.label}</span>
              </div>
              <div style={{ fontSize: 12, color: t.text2, marginTop: 6, lineHeight: 1.5, wordBreak: 'break-word' }}>{r.detail}</div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
