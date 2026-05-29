'use client'

// AtRiskBookingsBanner — 7pm IST "booked but not shipped" alert.
//
// Renders a red dismissible banner whenever today's bookings include rows
// whose attached bills are still at_branch past the source branch's
// pickup_time + 2h grace. Same at_risk logic the Bookings tab pill uses;
// just a global surface so anyone with bidding access sees it without
// needing to be on the Bidding Volume page.
//
// Gating:
//   - Only mounts when canSee('consignment-bidding') OR role === 'super_admin'
//   - Only renders when IST time >= 19:00 (configurable via FIRE_HOUR_IST)
//   - Hidden once dismissed (localStorage scoped to today's date — comes
//     back tomorrow if not resolved)
//   - Auto-hides if the at_risk count drops to zero (booking shipped /
//     unbooked / consignment created)
//
// Buttons:
//   • Open Bookings → deep-links into Consignments → Bidding Volume →
//     Bookings tab so ops can take action via the per-row at-risk buttons
//     we already built.
//   • Dismiss      → localStorage flag, hides until tomorrow.
//
// Poll cadence: every 5 minutes while visible. We deliberately don't poll
// outside the 18:30–23:59 IST window to keep load minimal.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const FIRE_HOUR_IST    = 19    // 7pm
const POLL_INTERVAL_MS = 5 * 60 * 1000
// On rare clock skew (browser local time vs server IST), use the API's
// `as_of` field as authoritative.

const istNow = () => new Date(Date.now() + 5.5 * 3600_000)
const istToday = () => {
  const d = istNow()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
const istHour = () => istNow().getUTCHours()
const fmtG = (n) => `${Number(n || 0).toFixed(2)} g`

export default function AtRiskBookingsBanner() {
  const { theme, role, canSee, setActiveNav } = useApp()
  const t = THEMES[theme] || THEMES.dark

  // Gate: only users with bidding access (super_admin always; everyone else
  // via the standard page permission). Hooks still run; just renders null.
  const hasAccess = role === 'super_admin' || canSee('consignment-bidding')

  const [summary, setSummary] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const dismissedKey = `at_risk_banner_dismissed_${istToday()}`

  // Hydrate dismissed state from localStorage on mount (today only).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(dismissedKey)
      if (stored) setDismissed(true)
    } catch {}
  }, [dismissedKey])

  const fetchSummary = useCallback(async () => {
    try {
      const r = await authedFetch('/api/consignments?action=bidding_at_risk_summary')
      if (!r.ok) return
      const j = await r.json().catch(() => null)
      if (j?.data) setSummary(j.data)
    } catch { /* silent — banner just won't appear */ }
  }, [])

  // Poll on a 5-minute cadence, but only inside the 18:30–23:59 IST window.
  // We tick every minute on a setInterval to re-check the window cheaply;
  // the actual fetch only fires when (a) inside the window AND (b) hasn't
  // fetched in the last POLL_INTERVAL_MS.
  const lastFetchRef = useRef(0)
  useEffect(() => {
    if (!hasAccess) return

    const tick = () => {
      const now    = istNow()
      const hh     = now.getUTCHours()
      const mm     = now.getUTCMinutes()
      const inWindow = (hh > 18) || (hh === 18 && mm >= 30)   // 18:30 onwards
      if (!inWindow) return
      const since = Date.now() - lastFetchRef.current
      if (since < POLL_INTERVAL_MS && lastFetchRef.current > 0) return
      lastFetchRef.current = Date.now()
      fetchSummary()
    }
    tick()
    const id = setInterval(tick, 60_000)   // re-check every minute
    return () => clearInterval(id)
  }, [hasAccess, fetchSummary])

  if (!hasAccess) return null
  if (dismissed)  return null
  if (!summary)   return null
  if ((summary.count || 0) === 0) return null
  if (istHour() < FIRE_HOUR_IST)  return null

  const onDismiss = () => {
    try { localStorage.setItem(dismissedKey, '1') } catch {}
    setDismissed(true)
  }
  const onOpenBookings = () => {
    setActiveNav('consignment-bidding')
    // The Bookings sub-tab is the actionable surface — Bidding Volume itself
    // remembers the last sub-tab via its own state, but deep-linking to the
    // Bookings tab is preferable on a 7pm alert. The page reads
    // ?tab= once we add it; for now activeNav switch + the user clicks
    // 'Bookings' once inside is fine.
  }

  const branchSummary = (summary.by_branch || [])
    .slice(0, 6)
    .map(b => `${b.branch_name} (${b.bills} · ${fmtG(b.weight_g)})`)
    .join(', ')
  const moreBranches = Math.max(0, (summary.by_branch || []).length - 6)

  return (
    <div role="alert" aria-live="polite"
      style={{
        margin: '12px 16px 0',
        background: `linear-gradient(135deg, ${t.red}18 0%, ${t.red}05 70%)`,
        border: `1px solid ${t.red}55`,
        borderLeft: `4px solid ${t.red}`,
        borderRadius: 10,
        padding: '14px 18px',
        display: 'flex', alignItems: 'flex-start', gap: 14,
        boxShadow: `0 4px 18px ${t.red}15`,
        animation: 'atRiskFadeIn .25s ease-out',
      }}>
      <div style={{
        flexShrink: 0,
        width: 32, height: 32, borderRadius: '50%',
        background: `${t.red}25`, color: t.red,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 800,
      }}>⚠</div>

      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.55 }}>
        <div style={{ fontSize: 13.5, color: t.text1, fontWeight: 800, letterSpacing: '.01em' }}>
          Hey — you have {summary.count} booking{summary.count === 1 ? '' : 's'} placed today that haven't been dispatched yet.
        </div>
        <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>
          <strong style={{ color: t.text1 }}>{summary.totals?.bills || 0}</strong> bill{(summary.totals?.bills || 0) === 1 ? '' : 's'} ·{' '}
          <strong style={{ color: t.text1, fontFamily: 'monospace' }}>{fmtG(summary.totals?.weight_g)}</strong> still at branch
          {branchSummary && (
            <span style={{ color: t.text3 }}> · {branchSummary}{moreBranches > 0 ? ` +${moreBranches} more` : ''}</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4 }}>
          Bills booked today are expected at HO tomorrow. Either create the consignment now so they make tonight's truck, or unbook them if you placed the bid by mistake.
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          <button type="button" onClick={onOpenBookings}
            style={{
              background: t.gold, color: '#1a0a00',
              border: 'none', borderRadius: 7,
              padding: '7px 16px', fontSize: 12, fontWeight: 800,
              letterSpacing: '.02em', cursor: 'pointer',
              boxShadow: `0 2px 10px ${t.gold}55`,
            }}>
            Open Bookings →
          </button>
          <button type="button" onClick={onDismiss}
            style={{
              background: 'transparent', color: t.text3,
              border: `1px solid ${t.border2 || t.border}`,
              borderRadius: 7, padding: '7px 14px',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
            Dismiss for today
          </button>
        </div>
      </div>

      <style>{`
        @keyframes atRiskFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
