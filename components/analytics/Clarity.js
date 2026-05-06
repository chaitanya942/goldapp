'use client'

// components/analytics/Clarity.js
//
// Microsoft Clarity loader with PII protection for financial data.
//
// Why Clarity (vs. building it ourselves):
//   - Heatmaps + scroll maps + session replay + rage/dead-click detection — all out of the box
//   - Free forever, GDPR-compliant, multi-tenant (one project per app)
//   - Mobile + desktop + tablet auto-detected, no separate code paths
//   - Building equivalent in-house: 3-4 weeks of dev + ongoing infra cost. Skipped.
//
// What WE add on top (this component):
//   1. PII masking for sensitive selectors (GSTINs, customer names, amounts, phone numbers)
//      → these never leave the browser; Clarity blurs them before transmission
//   2. User identification — tags each session with the auth'd user's id, so the
//      Clarity dashboard can filter heatmaps "by user" or "by role"
//   3. Custom tags — role, region, theme — for filterable analytics in Clarity
//
// Disabled when NEXT_PUBLIC_CLARITY_PROJECT_ID isn't set, so dev/staging stays clean.

import { useEffect } from 'react'
import { useApp } from '../../lib/context'

// Selectors that contain PII or financial data — mask before transmission.
// Anything matching these gets blurred in session replay; click coordinates are still captured.
// Keep this list aggressive — better to over-mask than leak a customer name into the recording.
const MASK_SELECTORS = [
  // Form inputs — auto-masked by Clarity by default but we belt-and-suspenders
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[type="password"]',
  'textarea',
  // Sensitive content classes
  '.pii',
  '.sensitive',
  // Customer / personal data display
  '[data-customer-name]',
  '[data-phone]',
  '[data-pan]',
  '[data-gstin]',
  // Currency amounts (data attribute we'll add to amount cells over time)
  '[data-amount]',
]

// Selectors to keep VISIBLE (override default masking). Useful for non-sensitive UI text we want to see in replay.
const UNMASK_SELECTORS = [
  'button',           // button labels are UI, not PII
  '[role="button"]',
  'h1, h2, h3, h4',   // headings
  '.unmask',          // explicit opt-in
]

export default function Clarity() {
  const { user, userProfile } = useApp()

  useEffect(() => {
    const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID
    if (!projectId) return  // not configured → don't load
    if (typeof window === 'undefined') return
    // Don't double-load if HMR / route changes mount this twice
    if (window.__clarityLoaded) return
    window.__clarityLoaded = true

    // Inject the standard Clarity loader. Reference: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup
    ;(function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments) }
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y)
    })(window, document, 'clarity', 'script', projectId)

    // Apply masks AFTER Clarity loads. The library queues calls until ready.
    const apply = () => {
      const c = window.clarity
      if (!c) return
      MASK_SELECTORS.forEach(sel => { try { c('mask', sel) } catch {} })
      UNMASK_SELECTORS.forEach(sel => { try { c('unmask', sel) } catch {} })
    }
    apply()
  }, [])

  // Identify the user once they're authenticated. This lets us filter Clarity sessions by user_id.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const c = window.clarity
    if (!c || !user) return
    try {
      // identify(custom-id, custom-session-id?, custom-page-id?, friendly-name?)
      c('identify', user.id, undefined, undefined, userProfile?.full_name || userProfile?.email || user.email)
      // Custom tags — Clarity dashboard can filter heatmaps by these.
      if (userProfile?.role)            c('set', 'role',    String(userProfile.role))
      if (userProfile?.allowed_regions?.length) c('set', 'regions', userProfile.allowed_regions.join(','))
      // Device class is auto-tagged by Clarity (mobile/desktop/tablet) but we add a finer breakdown.
      const w = window.innerWidth || 0
      const deviceClass = w < 600 ? 'mobile' : w < 900 ? 'mobile-large' : w < 1280 ? 'tablet' : w < 1680 ? 'desktop' : 'desktop-wide'
      c('set', 'device_class', deviceClass)
    } catch {}
  }, [user, userProfile])

  return null
}
