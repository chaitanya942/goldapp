'use client'

// StuckBookingsBanner — persistent "stale booking" alert.
//
// Sibling to AtRiskBookingsBanner, but for a HARDER state: a bill that was
// booked YESTERDAY (or earlier), is still at_branch, and the consignment
// was never created. The deadline for that booking has fully passed —
// either the consignment must fire now (so the stock catches up) or the
// bill must be unbooked so the booked weight goes back into the pool.
//
// Differences from AtRiskBookingsBanner:
//   - NOT dismissible: no close/snooze button. Banner stays visible until
//     every stuck bill is resolved (consignment fired OR unbooked).
//   - Polls every 60s, not 5 minutes — these need immediate action.
//   - Expands inline to a per-bill list with two per-row actions:
//       Create Consignment → deep-link to Branch Stock (consignment-overview)
//       Unbook              → confirm-then-POST to /api/consignments?action=unbook_bills
//   - Fires at any time of day (no 7pm gating) — these are already late.
//
// Gating: same as AtRisk — anyone with consignment-bidding access OR
// super_admin. The API is similarly page-gated for the unbook write.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const POLL_INTERVAL_MS = 60 * 1000

const fmtG = (n) => `${Number(n || 0).toFixed(2)} g`
const fmtDate = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
  } catch { return '' }
}

export default function StuckBookingsBanner() {
  const { theme, role, canSee, setActiveNav } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const hasAccess = role === 'super_admin' || canSee('consignment-bidding')

  const [summary, setSummary]   = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [busyApp, setBusyApp]   = useState(null)   // application_id of in-flight unbook
  const [confirming, setConfirming] = useState(null) // application_id pending confirm
  const [error, setError] = useState(null)
  const lastFetchRef = useRef(0)

  const fetchSummary = useCallback(async () => {
    try {
      lastFetchRef.current = Date.now()
      // Action handler lives in POST; sending GET hit the 'Invalid action'
      // fallthrough in the GET dispatcher and the banner data silently never
      // updated (errors swallowed by the catch below). Switching to POST.
      const r = await authedFetch('/api/consignments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'bidding_stuck_summary' }),
      })
      if (!r.ok) return
      const j = await r.json().catch(() => null)
      if (j?.data) setSummary(j.data)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (!hasAccess) return
    fetchSummary()
    const id = setInterval(fetchSummary, POLL_INTERVAL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') fetchSummary() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [hasAccess, fetchSummary])

  if (!hasAccess)            return null
  if (!summary)              return null
  if ((summary.count || 0) === 0) return null

  const accent = t.gold
  const count  = summary.count || 0

  const onOpenBranchStock = () => {
    setActiveNav('consignment-overview')
  }

  const onUnbook = async (applicationId) => {
    setBusyApp(applicationId)
    setError(null)
    try {
      const r = await authedFetch('/api/consignments?action=unbook_bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_ids: [applicationId] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) {
        setError(j.error || 'Unbook failed.')
        setBusyApp(null)
        return
      }
      setConfirming(null)
      await fetchSummary()
    } catch (e) {
      setError(e.message || 'Unbook failed.')
    } finally {
      setBusyApp(null)
    }
  }

  // Group bills by branch — matches the by_branch summary order so the
  // expanded list scans top-down the same way as the header chip strip.
  const billsByBranch = {}
  for (const b of (summary.bills || [])) {
    if (!billsByBranch[b.branch_name]) billsByBranch[b.branch_name] = []
    billsByBranch[b.branch_name].push(b)
  }
  const branchOrder = (summary.by_branch || []).map(b => b.branch_name)

  return (
    <div role="alert" aria-live="polite"
      style={{
        margin: '12px 16px 0',
        background: `linear-gradient(135deg, ${accent}1a 0%, ${accent}05 70%)`,
        border: `1px solid ${accent}65`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: '14px 18px',
        boxShadow: `0 4px 18px ${accent}1a`,
        animation: 'stuckFadeIn .25s ease-out',
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          flexShrink: 0,
          width: 32, height: 32, borderRadius: '50%',
          background: `${accent}28`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 800,
        }}>!</div>

        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.55 }}>
          <div style={{ fontSize: 13.5, color: t.text1, fontWeight: 800, letterSpacing: '.01em' }}>
            {count} stuck booking{count === 1 ? '' : 's'} — stock still at branch from earlier days.
          </div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>
            <strong style={{ color: t.text1 }}>{summary.totals?.bills || 0}</strong> bill{(summary.totals?.bills || 0) === 1 ? '' : 's'} ·{' '}
            <strong style={{ color: t.text1, fontFamily: 'monospace' }}>{fmtG(summary.totals?.weight_g)}</strong>{' '}
            booked but never dispatched.
            {branchOrder.length > 0 && (
              <span style={{ color: t.text3 }}> · {branchOrder.slice(0, 6).join(', ')}{branchOrder.length > 6 ? ` +${branchOrder.length - 6} more` : ''}</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4 }}>
            Either create the consignment so the stock moves now, or unbook so the booked weight returns to the pool. This won't clear until every row is resolved.
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
            <button type="button" onClick={onOpenBranchStock}
              style={{
                background: accent, color: '#1a0a00',
                border: 'none', borderRadius: 7,
                padding: '7px 16px', fontSize: 12, fontWeight: 800,
                letterSpacing: '.02em', cursor: 'pointer',
                boxShadow: `0 2px 10px ${accent}55`,
              }}>
              Open Branch Stock →
            </button>
            <button type="button" onClick={() => setExpanded(e => !e)}
              style={{
                background: 'transparent',
                color: t.text2,
                border: `1px solid ${t.border2 || t.border}`,
                borderRadius: 7, padding: '7px 14px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
              {expanded ? 'Hide list' : 'Show list'}
            </button>
          </div>
        </div>
      </div>

      {/* Inline error toast for unbook failures */}
      {error && (
        <div style={{
          marginTop: 12, padding: '8px 12px',
          background: `${t.red || '#c03030'}15`,
          border: `1px solid ${t.red || '#c03030'}55`,
          borderRadius: 7,
          fontSize: 11.5, color: t.red || '#c03030',
        }}>
          {error}
        </div>
      )}

      {/* Expanded per-bill list */}
      {expanded && (
        <div style={{
          marginTop: 14,
          background: `${accent}06`,
          border: `1px solid ${accent}25`,
          borderRadius: 9,
          overflow: 'hidden',
        }}>
          {branchOrder.map(branch => {
            const rows = billsByBranch[branch] || []
            if (rows.length === 0) return null
            return (
              <div key={branch}>
                <div style={{
                  padding: '8px 14px',
                  background: `${accent}10`,
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em',
                  color: t.text2, textTransform: 'uppercase',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>{branch}</span>
                  <span style={{ color: t.text3, fontWeight: 600, letterSpacing: '.04em' }}>
                    {rows.length} bill{rows.length === 1 ? '' : 's'}
                  </span>
                </div>
                {rows.map(b => {
                  const isBusy       = busyApp === b.application_id
                  const isConfirming = confirming === b.application_id
                  return (
                    <div key={b.application_id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 14px',
                      borderTop: `1px solid ${accent}15`,
                      fontSize: 11.5,
                      flexWrap: 'wrap',
                    }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ color: t.text1, fontWeight: 700, fontFamily: 'monospace' }}>{b.application_id}</span>
                        <span style={{ color: t.text2, fontFamily: 'monospace' }}>{fmtG(b.net_weight_g)}</span>
                        {b.booking_party && (
                          <span style={{ color: t.text3 }}>· {b.booking_party}</span>
                        )}
                        <span style={{ color: t.text4, fontSize: 10.5 }}>
                          booked {fmtDate(b.booked_at)}
                        </span>
                      </div>
                      {isConfirming ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <span style={{ fontSize: 10.5, color: t.red || '#c03030', alignSelf: 'center', marginRight: 6 }}>
                            Unbook this bill?
                          </span>
                          <button type="button" onClick={() => onUnbook(b.application_id)} disabled={isBusy}
                            style={{
                              background: t.red || '#c03030', color: '#fff',
                              border: 'none', borderRadius: 6,
                              padding: '5px 11px', fontSize: 11, fontWeight: 700,
                              cursor: isBusy ? 'wait' : 'pointer',
                            }}>
                            {isBusy ? 'Unbooking…' : 'Yes, unbook'}
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} disabled={isBusy}
                            style={{
                              background: 'transparent', color: t.text3,
                              border: `1px solid ${t.border2 || t.border}`,
                              borderRadius: 6,
                              padding: '5px 11px', fontSize: 11, fontWeight: 600,
                              cursor: isBusy ? 'wait' : 'pointer',
                            }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" onClick={onOpenBranchStock}
                            style={{
                              background: 'transparent',
                              color: accent,
                              border: `1px solid ${accent}55`,
                              borderRadius: 6,
                              padding: '5px 10px', fontSize: 11, fontWeight: 700,
                              cursor: 'pointer',
                            }}
                            title="Open Branch Stock to fire the consignment for this branch">
                            Create Consignment
                          </button>
                          <button type="button" onClick={() => setConfirming(b.application_id)}
                            style={{
                              background: 'transparent',
                              color: t.red || '#c03030',
                              border: `1px solid ${(t.red || '#c03030')}55`,
                              borderRadius: 6,
                              padding: '5px 10px', fontSize: 11, fontWeight: 700,
                              cursor: 'pointer',
                            }}>
                            Unbook
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes stuckFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
