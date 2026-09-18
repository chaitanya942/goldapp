// lib/useDashboardAuditLog.js
//
// Logs "viewed the dashboard" events to /api/dashboard-audit-log so
// super_admin can see who viewed which dashboard/section, under what
// region/branch/period/filters, and when (see sql/dashboard_audit_log.sql).
//
// Fires once on mount, then again whenever the tracked context changes
// (debounced) — a region/branch/period/section change is treated as a new
// "viewing" event, without spamming a row per keystroke/click.
//
// Never throws into the caller's render path: failures are swallowed, same
// as HeatmapTracker.js's tracking calls.

import { useEffect, useRef } from 'react'
import { authedFetch } from './authedFetch'

const LOG_URL = '/api/dashboard-audit-log'
const DEBOUNCE_MS = 800
const SESSION_KEY = 'dashboard_audit_session_id'

function getSessionId() {
  if (typeof window === 'undefined') return null
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36)
      window.sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function useDashboardAuditLog({ page, section, region, branch, period, filters } = {}) {
  const timerRef = useRef(null)
  const firstRef = useRef(true)

  const key = JSON.stringify({ page, section, region, branch, period, filters })

  useEffect(() => {
    if (!page || typeof window === 'undefined') return

    const send = () => {
      authedFetch(LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, section, region, branch, period, filters, sessionId: getSessionId() }),
      }).catch(() => {})
    }

    if (firstRef.current) {
      firstRef.current = false
      send()
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(send, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page])
}
