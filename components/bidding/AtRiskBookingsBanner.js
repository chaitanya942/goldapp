'use client'

// AtRiskBookingsBanner — 7pm IST "booked but not shipped" alert.
//
// Renders a red banner whenever today's bookings include rows whose
// attached bills are still at_branch past the source branch's
// pickup_time + 2h grace. Same at_risk logic the Bookings tab pill uses;
// just a global surface so anyone with bidding access sees it without
// needing to be on the Bidding Volume page.
//
// NOT DISMISSIBLE — consistent with the next-day StuckBookingsBanner.
// The banner stays visible until every at-risk booking is resolved
// (consignment fired or booking unbooked) — the count flipping to zero
// is the ONLY thing that hides it. This matches the rule "if they get
// the notification they just can't close it, the notification will be
// there till they take an action."
//
// Gating:
//   - Only mounts when canSee('consignment-bidding') OR role === 'super_admin'
//   - Only first appears when IST time >= 19:00 (configurable via FIRE_HOUR_IST)
//   - Live-updates count + branch breakdown; auto-hides when count = 0
//     (no acknowledgement step — anyone who fixes a booking on any
//     device clears it for everyone).
//
// Button:
//   • Open Bookings → deep-links into Consignments → Bidding Volume →
//     Bookings tab so ops can take action via the per-row at-risk buttons
//     we already built.
//
// Poll cadence: every 5 minutes while visible. Outside 18:30–23:59 IST
// we still tick once on mount so a user who logs in at 9pm picks up
// today's state without waiting for the next poll.

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
  if (!summary)   return null
  // Visibility rule: actionable only — show when there's something to fix
  // AND we're past 7pm IST. Hides automatically the moment count hits 0
  // (anyone fixing on any device clears the banner for everyone).
  const liveCount = summary.count || 0
  if (liveCount === 0)            return null
  if (istHour() < FIRE_HOUR_IST)  return null

  const onOpenBookings = () => {
    setActiveNav('consignment-bidding')
  }

  const branchSummary = (summary.by_branch || [])
    .slice(0, 6)
    .map(b => `${b.branch_name} (${b.bills} · ${fmtG(b.weight_g)})`)
    .join(', ')
  const moreBranches = Math.max(0, (summary.by_branch || []).length - 6)

  const accent = t.red
  const icon   = '⚠'

  return (
    <div role="alert" aria-live="polite"
      style={{
        margin: '12px 16px 0',
        background: `linear-gradient(135deg, ${accent}18 0%, ${accent}05 70%)`,
        border: `1px solid ${accent}55`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: '14px 18px',
        display: 'flex', alignItems: 'flex-start', gap: 14,
        boxShadow: `0 4px 18px ${accent}15`,
        animation: 'atRiskFadeIn .25s ease-out',
      }}>
      <div style={{
        flexShrink: 0,
        width: 32, height: 32, borderRadius: '50%',
        background: `${accent}25`, color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 800,
      }}>{icon}</div>

      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.55 }}>
        <div style={{ fontSize: 13.5, color: t.text1, fontWeight: 800, letterSpacing: '.01em' }}>
          Hey — you have {liveCount} booking{liveCount === 1 ? '' : 's'} placed today that haven't been dispatched yet.
        </div>
        <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>
          <strong style={{ color: t.text1 }}>{summary.totals?.bills || 0}</strong> bill{(summary.totals?.bills || 0) === 1 ? '' : 's'} ·{' '}
          <strong style={{ color: t.text1, fontFamily: 'monospace' }}>{fmtG(summary.totals?.weight_g)}</strong> still at branch
          {branchSummary && (
            <span style={{ color: t.text3 }}> · {branchSummary}{moreBranches > 0 ? ` +${moreBranches} more` : ''}</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4 }}>
          Bills booked today are expected at HO tomorrow. Either create the consignment now so they make tonight's truck, or unbook them if you placed the bid by mistake. This banner won't clear until every row is resolved.
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
