'use client'

// Shared data + formatting helpers for the live Simulation map / HO view.

import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from '../../lib/authedFetch'

export const SIM_REFRESH_MS = 60 * 1000

export function useSimData() {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const load = useCallback(async (silent = false) => {
    if (!silent) setState(s => ({ ...s, loading: true }))
    try {
      const res = await authedFetch('/api/simulation')
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) throw new Error(json?.error || `Server error (HTTP ${res.status})`)
      setState({ loading: false, data: json, error: null })
      // Fill in map coordinates for any newly-added branch (≤5 per call).
      if (json.unplaced?.length) {
        authedFetch('/api/simulation?action=geocode_missing', { method: 'POST' })
          .then(r => r.json()).then(j => { if (j?.placed?.length) load(true) }).catch(() => {})
      }
    } catch (err) {
      setState(s => ({ loading: false, data: s.data, error: err.message }))
    }
  }, [])
  useEffect(() => {
    load()
    const id = setInterval(() => { if (!document.hidden) load(true) }, SIM_REFRESH_MS)
    return () => clearInterval(id)
  }, [load])
  return { ...state, reload: () => load(true) }
}

// Share of the expected journey done (dispatch → TAT), for drawing a truck
// part-way along its route. Real GPS isn't available, so this is an estimate.
export function transitProgress(c, now = Date.now()) {
  if (c.status === 'received') return 1
  const tat = (c.tat_hours || 24) * 3600e3
  const elapsed = now - new Date(c.dispatched_at).getTime()
  return Math.max(0.06, Math.min(0.94, elapsed / tat))
}

export const etaOf = (c) => (c.tat_hours ? new Date(new Date(c.dispatched_at).getTime() + c.tat_hours * 3600e3) : null)

export const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))
export const fmtG = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} g`)
export const fmtINR = (n) => {
  if (!n) return '—'
  const v = Number(n)
  return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${v.toLocaleString('en-IN')}`
}
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
export const consLabel = (c) => (c.type === 'EXTERNAL' ? 'To Head Office' : `To hub ${c.to || ''}`.trim())
