'use client'

// components/analytics/HeatmapTracker.js
//
// Sends click + scroll + pageview events to /api/heatmap/track for the in-app
// heatmap viewer. Runs alongside Clarity (Clarity owns recordings; we own the
// in-app aggregated heatmap).
//
// Events are batched (max 30 per request, flushed every 5s or before unload).
// Coordinates stored as percentages (0-100) so we can render across mixed viewports.

import { useEffect } from 'react'
import { useApp } from '../../lib/context'

const TRACK_URL = '/api/heatmap/track'
const PROJECT   = 'goldapp'
const FLUSH_MS  = 5000
const MAX_BATCH = 30
const TEXT_LIMIT = 50

function deviceClass(w) {
  if (w < 600)  return 'mobile'
  if (w < 900)  return 'mobile-large'
  if (w < 1280) return 'tablet'
  if (w < 1680) return 'desktop'
  return 'desktop-wide'
}

function genSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Strip text content if it might contain PII (long, contains digits patterns, currency symbol)
function safeText(el) {
  let t = (el?.innerText || el?.textContent || '').trim()
  if (!t) return null
  if (t.length > TEXT_LIMIT) t = t.slice(0, TEXT_LIMIT)
  // Skip text containing currency markers or all-digit blocks (likely amounts / phone / GSTIN / PAN)
  if (/₹|\$|€|£/.test(t)) return null
  if (/\b\d{4,}\b/.test(t)) return null
  return t
}

export default function HeatmapTracker() {
  const { user } = useApp()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.__heatmapTrackerActive) return
    window.__heatmapTrackerActive = true

    const sessionId = genSessionId()
    let queue = []
    let flushTimer = null

    const enqueue = (ev) => {
      queue.push(ev)
      if (queue.length >= MAX_BATCH) flushNow()
      else if (!flushTimer) flushTimer = setTimeout(flushNow, FLUSH_MS)
    }

    const flushNow = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      if (queue.length === 0) return
      const events = queue.slice(0, MAX_BATCH)
      queue = queue.slice(MAX_BATCH)
      // Use sendBeacon when available so events flush reliably even on page unload.
      const body = JSON.stringify({ project: PROJECT, events })
      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([body], { type: 'application/json' })
          navigator.sendBeacon(TRACK_URL, blob)
        } else {
          fetch(TRACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
        }
      } catch {}
    }

    const baseEvent = (extra) => {
      const w = window.innerWidth || 0
      const h = window.innerHeight || 0
      const path = window.location.pathname || '/'
      // Internal nav state: useful suffix so admin tabs show as separate "pages" in the viewer.
      const navHash = window.__APP_NAV ? `#${window.__APP_NAV}` : ''
      return {
        session_id:   sessionId,
        user_id:      user?.id || null,
        page_path:    path + navHash,
        page_title:   document.title || null,
        viewport_w:   w,
        viewport_h:   h,
        device_class: deviceClass(w),
        scroll_y_pct: h > 0 ? clamp((window.scrollY / Math.max(1, document.documentElement.scrollHeight - h)) * 100, 0, 100) : 0,
        ...extra,
      }
    }

    const onClick = (e) => {
      const w = window.innerWidth, h = window.innerHeight
      if (!w || !h) return
      const x = e.clientX, y = e.clientY
      const target = e.target instanceof Element ? e.target : null
      const closestInteractive = target?.closest?.('button, a, [role="button"], input, select, textarea, label, [data-track]') || target
      enqueue(baseEvent({
        event_type: 'click',
        x_px: x, y_px: y,
        x_pct: clamp((x / w) * 100, 0, 100),
        y_pct: clamp((y / h) * 100, 0, 100),
        el_tag:   closestInteractive?.tagName?.toLowerCase() || null,
        el_id:    closestInteractive?.id || null,
        el_class: typeof closestInteractive?.className === 'string' ? closestInteractive.className.slice(0, 200) : null,
        el_text:  safeText(closestInteractive),
      }))
    }

    let lastScrollFlush = 0
    const onScroll = () => {
      const now = Date.now()
      if (now - lastScrollFlush < 1000) return  // throttle scroll events to 1/sec
      lastScrollFlush = now
      enqueue(baseEvent({ event_type: 'scroll' }))
    }

    // Pageview on initial mount.
    enqueue(baseEvent({ event_type: 'pageview' }))

    // Listen.
    document.addEventListener('click',  onClick,  { passive: true, capture: true })
    window.addEventListener('scroll',   onScroll, { passive: true })
    window.addEventListener('beforeunload', flushNow)
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow() })

    // Also fire a pageview when the in-app nav changes (poll __APP_NAV — set by your app on route change).
    let lastNav = window.__APP_NAV
    const navWatcher = setInterval(() => {
      if (window.__APP_NAV !== lastNav) {
        lastNav = window.__APP_NAV
        enqueue(baseEvent({ event_type: 'pageview' }))
      }
    }, 500)

    return () => {
      document.removeEventListener('click',  onClick, { capture: true })
      window.removeEventListener('scroll',   onScroll)
      window.removeEventListener('beforeunload', flushNow)
      clearInterval(navWatcher)
      flushNow()
      window.__heatmapTrackerActive = false
    }
  }, [user])

  return null
}

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}
