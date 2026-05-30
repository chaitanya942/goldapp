'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useApp, useRegionAccess } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch, prefetch } from '../../lib/authedFetch'
import { supabase } from '../../lib/supabase'
import { triggerSync } from '../../lib/triggerSync'
import { getCache, setCache } from '../../lib/moduleCache'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'
import { istToday, istNow } from '../../lib/dateIst'

const REGION_ICONS = {
  'Rest of Karnataka': '🏛',
  'Andhra Pradesh':    '🌊',
  'Telangana':         '🌆',
  'Kerala':            '🌴',
}

// Display order for the per-region flash cards. Anything not in this list
// gets sorted alphabetically and appended (defensive for new regions).
const REGION_ORDER = ['Rest of Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana']

const fmt     = (n, d = 3) => n != null ? Number(n).toFixed(d) : '—'
const fmtNum  = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtINR  = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]}`
}
const daysFromNow = (d) => {
  if (!d) return null
  return Math.floor((new Date(d).getTime() - Date.now()) / 86400000)
}
const ageDaysFromDate = (d) => {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function AgeBadge({ days, t }) {
  if (!days && days !== 0) return <span style={{ color: t.text4 }}>—</span>
  const color = days > 7 ? t.red : days > 3 ? t.orange : t.green
  return (
    <span style={{ fontSize: '11px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 700 }}>
      {days}d
    </span>
  )
}

const SORT_COLS = [
  { key: 'today_bills',   label: "Today's Bills",   align: 'right'  },
  { key: 'today_net_wt',  label: "Today's Net Wt",  align: 'right'  },
  { key: 'older_bills',   label: 'Pending Bills',   align: 'right'  },
  { key: 'older_net_wt',  label: 'Pending Net Wt',  align: 'right'  },
  { key: 'oldest_age',    label: 'Oldest Bill',     align: 'center' },
]

export default function ConsignmentOverview() {
  const { theme, setActiveNav, canSee, setConsignmentDeepLink } = useApp()
  const regionAccess = useRegionAccess()
  const t = THEMES[theme]
  const isMobile = useMobile()

  // Seed from in-memory cache so a re-open paints instantly while a fresh
  // fetch runs silently in the background (stale-while-revalidate).
  const [data,         setData]         = useState(() => getCache('co:branch-overview') ?? [])
  const [loading,      setLoading]      = useState(() => !getCache('co:branch-overview'))
  const [search,       setSearch]       = useState('')
  const [activeRegion, setActiveRegion] = useState(null)
  // Scope tab — 'outside' = outstation branches (the historical default),
  // 'bangalore' = Bangalore-only view with hubs as hero cards. Restricted
  // users (no Bangalore access) only see 'outside'. Persisted per-device.
  const [scopeTab, setScopeTab] = useState(() => {
    if (typeof window === 'undefined') return 'outside'
    return window.localStorage.getItem('cstock.scopeTab') || 'outside'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('cstock.scopeTab', scopeTab)
  }, [scopeTab])
  // Active hub on the Bangalore tab — when set, the branch list filters to
  // that hub + every leaf whose hub_branch_name matches.
  const [activeHub, setActiveHub] = useState(null)
  // Clear hub selection when leaving the Bangalore tab so a returning user
  // starts fresh on the All Bangalore view.
  useEffect(() => { if (scopeTab !== 'bangalore') setActiveHub(null) }, [scopeTab])
  // Hub dispatch flow — modal target + busy + result tracking.
  const [dispatchHub,    setDispatchHub]    = useState(null)   // hub name when modal open
  const [dispatchBusy,   setDispatchBusy]   = useState(false)
  const [dispatchResult, setDispatchResult] = useState(null)   // success payload from API
  // Default sort: total net weight desc (largest stockholders first). Management
  // wants to see the biggest exposures at the top without clicking.
  const [sortKey,      setSortKey]      = useState('total_net_wt')
  const [sortDir,      setSortDir]      = useState(-1)   // -1 = desc, 1 = asc
  // Quick-filter chip state. 'all' = no filter; the others apply on top of
  // search + region selection so users can narrow further.
  const [quickFilter,  setQuickFilter]  = useState('all')
  const [lastRefresh,  setLastRefresh]  = useState(null)
  const [tick,         setTick]         = useState(0)   // for live clock
  // Only the flat sortable table is rendered now — the grouped region-card
  // view was retired after ops told us it was rarely used and the toggle
  // just added clutter to the header. The dead 'grouped' render branch
  // below stays compiled-out (viewMode === 'flat' is hard-coded).
  // Region cards default to expanded so the user immediately sees their branches;
  // they can collapse a region to focus elsewhere. Set holds region names.
  const [collapsedRegions, setCollapsedRegions] = useState(() => new Set())
  // Track new-arrival rows for the pulse animation. A bill that lands in the
  // 'today_bills' column between refreshes flashes briefly so the operator
  // notices without staring at the table.
  const [recentlyChanged, setRecentlyChanged] = useState(() => new Set())
  const prevTodayRef = useRef(new Map())
  // Surfaced in a banner when /api/consignments throws or returns an error
  // payload — used to be silently swallowed (spinner stuck forever, or data
  // wiped to []).
  const [loadError, setLoadError] = useState(null)
  // Realtime channel state — drives the LIVE pill's colour so the user can
  // tell at a glance whether updates are actually flowing.
  // 'connecting' (default) → 'connected' once the channel subscribes, or
  // 'error' / 'closed' on failure.
  const [rtState, setRtState] = useState('connecting')

  // `silent` skips the loading toggle so background polls don't blank the
  // list or flip the Refresh button to "Refreshing…" every 15s — operators
  // complained the constant flicker was irritating. First-load + the manual
  // Refresh click still set loading; the new-arrival pulse + the freshness
  // timestamp signal that data is moving.
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      // Pull Bangalore branches into the response only when the Bangalore
      // scope tab is active. Outstation view keeps its lighter payload.
      const qs = scopeTab === 'bangalore' ? '&include_bangalore=true' : ''
      const res  = await authedFetch(`/api/consignments?action=branch_overview${qs}`)
      const json = await res.json()
      // The API returns {data, error} even on 200 when the RPC is missing —
      // surface that instead of silently wiping the screen to "No stock".
      if (json.error) throw new Error(json.error)
      const next = json.data || []
      // Detect branches whose today_bills count rose since the last poll —
      // flash them so the operator notices new arrivals without scanning every
      // row. Use undefined as the "never seen" sentinel so first load doesn't
      // light every branch and a 0 → 1 transition still pulses.
      const prev = prevTodayRef.current
      const isFirstLoad = prev.size === 0
      const justChanged = new Set()
      for (const row of next) {
        const before = prev.get(row.branch_name)
        const now = row.today_bills || 0
        if (!isFirstLoad && before != null && now > before) {
          justChanged.add(row.branch_name)
        }
        prev.set(row.branch_name, now)
      }
      if (justChanged.size) {
        setRecentlyChanged(justChanged)
        setTimeout(() => setRecentlyChanged(new Set()), 6000)
      }
      setCache('co:branch-overview', next)
      setData(next)
      setLastRefresh(new Date())
      setLoadError(null)
    } catch (e) {
      console.error('[branch-overview] load failed:', e)
      setLoadError(e?.message || 'Failed to load branch stock')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [scopeTab])

  // Mount: render Supabase data immediately (don't block on sync). In
  // parallel, force a fresh CRM→Supabase sync — when it lands, refetch
  // silently so any just-approved bills appear. Then poll every 15s,
  // pairing each poll with a sync trigger (shared helper coalesces
  // overlapping calls). Drops the previous 3-min interval where ops sat on
  // stale stock while new approvals piled up in CRM.
  useEffect(() => {
    // If we already have cached rows from a previous mount, refresh silently
    // so the screen never flips to a spinner on re-open.
    const haveCache = !!getCache('co:branch-overview')
    fetchData(haveCache)
    triggerSync({ minIntervalMs: 0 }).then(res => { if (res) fetchData(true) })  // silent: data already on screen
    const interval = setInterval(() => {
      triggerSync()
      fetchData(true)                                                        // silent: background poll
    }, 15 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Supabase Realtime — the 60s cron sync writes new/updated bills into
  // `purchases`; subscribing here closes the 0–15s gap between the sync
  // landing and the next UI poll picking it up. A burst of upserts triggers
  // one debounced refetch so we don't hammer the RPC for every row.
  useEffect(() => {
    let timer = null
    const channel = supabase
      .channel('co-branch-overview-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => fetchData(true), 1200)
      })
      .subscribe((status) => {
        // SUBSCRIBED → green; CHANNEL_ERROR / TIMED_OUT / CLOSED → amber/red so
        // the operator can see when "live" stops being live (e.g. wifi drop).
        if (status === 'SUBSCRIBED')      setRtState('connected')
        else if (status === 'CLOSED')     setRtState('closed')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRtState('error')
        else setRtState('connecting')
      })
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel) }
  }, [fetchData])

  // Live "X min ago" clock — also drives the pickup-alert recomputation.
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const minsAgo = lastRefresh ? Math.floor((Date.now() - lastRefresh.getTime()) / 60000) : null

  // ── Pickup-time alerts ────────────────────────────────────────────────────
  // Ops team wanted a heads-up 30 min before each branch's scheduled pickup so
  // they're not caught flat-footed. We tick every 30s (same interval as the
  // clock), compute mins-until-pickup in IST, and surface a sticky banner with
  // any branches inside the 30-min window. Each entry can be dismissed for the
  // rest of the day — dismissals persist in localStorage keyed to today's IST
  // date so they reset at midnight.
  const [dismissedPickups, setDismissedPickups] = useState({})
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(`pickup-dismissed-${istToday()}`) || '{}')
      setDismissedPickups(stored)
    } catch {}
  }, [])
  const dismissPickup = (branch) => {
    const next = { ...dismissedPickups, [branch]: 1 }
    setDismissedPickups(next)
    try { window.localStorage.setItem(`pickup-dismissed-${istToday()}`, JSON.stringify(next)) } catch {}
  }

  // Re-evaluated every render — cheap (≤73 branches) and `tick` ensures it
  // refreshes every 30s. Keep this list short by capping at the 5 most-imminent.
  const pickupAlerts = useMemo(() => {
    const now = istNow()
    const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes()
    const todayDow = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' })
    return data
      .filter(b => b.pickup_time && !dismissedPickups[b.branch_name])
      // Skip branches that don't pick up today (pickup_days set, today out).
      .filter(b => !(Array.isArray(b.pickup_days) && b.pickup_days.length > 0 && !b.pickup_days.includes(todayDow)))
      .map(b => {
        const [hh, mm] = String(b.pickup_time).split(':').map(Number)
        if (Number.isNaN(hh) || Number.isNaN(mm)) return null
        const diff = (hh * 60 + mm) - currentMins
        if (diff <= 0 || diff > 30) return null
        return { branch: b.branch_name, region: b.region, mins: diff, pickup_time: b.pickup_time }
      })
      .filter(Boolean)
      .sort((a, b) => a.mins - b.mins)
      .slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dismissedPickups, tick])

  // ── Pickup popup notifications ────────────────────────────────────────────
  // Beyond the passive banner above, ops wanted an active popup:
  //   · 30 min before pickup — heads-up popup (always fires once)
  //   · 15 min before pickup — reminder popup, fires ONLY when the branch
  //     still has at_branch stock (i.e. no consignment created since the
  //     30-min alert). If stock = 0 the move already happened → no reminder.
  // Each fire is logged per-branch-per-day in localStorage so it can't
  // repeat. Browser Notification API fires alongside (if permission granted)
  // so the alert lands even when the tab is in the background.
  const pickupLogRef = useRef({})
  const [pickupNotifs, setPickupNotifs] = useState([])
  useEffect(() => {
    try { pickupLogRef.current = JSON.parse(window.localStorage.getItem(`pickup-notif-${istToday()}`) || '{}') } catch {}
    // Ask for browser-notification permission once, up front.
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission() } catch {}
    }
  }, [])

  // Short two-tone chime for the 15-min urgent reminder. Synthesised via Web
  // Audio so we don't ship an audio asset, and so it works even when the OS
  // notification sound is muted. Wrapped in try/catch — some browsers throw
  // until the user has interacted with the page.
  const playChime = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const beep = (freq, t0, dur) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.frequency.value = freq
        osc.type = 'sine'
        osc.connect(gain).connect(ctx.destination)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + t0)
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t0 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur)
        osc.start(ctx.currentTime + t0)
        osc.stop(ctx.currentTime + t0 + dur + 0.05)
      }
      beep(880, 0,    0.18)
      beep(660, 0.22, 0.28)
    } catch {}
  }

  const fireBrowserNotif = (n) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
    const title = n.kind === '30min'
      ? `Pickup in ~30 min · ${n.branch}`
      : `Pickup reminder (15 min) · ${n.branch}`
    try {
      new Notification(title, {
        body: `${n.netWt.toFixed(2)} g net · pickup at ${n.pickup_time}`
          + (n.kind === '15min' ? '\nConsignment not created yet — move the stock now.' : ''),
        tag: n.id,
        requireInteraction: n.kind === '15min',
      })
    } catch {}
  }

  // Trigger evaluation — runs every 30 s tick and on every data refresh.
  useEffect(() => {
    if (!data.length) return
    const now = istNow()
    const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes()
    // Today's weekday in IST (Mon/Tue/…) — used to suppress notifications
    // for branches that don't pick up today.
    const todayDow = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' })
    const fresh = []
    let logChanged = false

    for (const b of data) {
      if (!b.pickup_time) continue
      // Only notify when today is actually a pickup day for the branch.
      // pickup_days set + today excluded → skip. Missing pickup_days → we
      // can't tell, so fall through (treat as daily pickup) rather than
      // hiding the alert on a config gap.
      if (Array.isArray(b.pickup_days) && b.pickup_days.length > 0 && !b.pickup_days.includes(todayDow)) continue
      const [hh, mm] = String(b.pickup_time).split(':').map(Number)
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue
      const mins = (hh * 60 + mm) - currentMins
      if (mins <= 0) continue
      const netWt = Number(b.today_net_wt || 0) + Number(b.older_net_wt || 0)
      if (netWt <= 0) continue                       // nothing at the branch → nothing to pick up

      const log = pickupLogRef.current[b.branch_name] || {}

      // 30-min heads-up — fires once when the branch enters the (15, 30] window.
      if (mins > 15 && mins <= 30 && !log.n30) {
        fresh.push({ branch: b.branch_name, region: b.region, netWt, pickup_time: b.pickup_time, mins, kind: '30min', id: `${b.branch_name}-30` })
        pickupLogRef.current[b.branch_name] = { ...log, n30: true }
        logChanged = true
      }
      // 15-min reminder — fires once in the (0, 15] window. The netWt > 0
      // guard above already means "no consignment created yet", so this is
      // exactly the "no action taken" reminder ops asked for.
      else if (mins > 0 && mins <= 15 && !log.n15) {
        fresh.push({ branch: b.branch_name, region: b.region, netWt, pickup_time: b.pickup_time, mins, kind: '15min', id: `${b.branch_name}-15` })
        pickupLogRef.current[b.branch_name] = { ...(pickupLogRef.current[b.branch_name] || {}), n15: true }
        logChanged = true
      }
    }

    if (fresh.length) {
      setPickupNotifs(prev => {
        const seen = new Set(prev.map(p => p.id))
        return [...prev, ...fresh.filter(f => !seen.has(f.id))]
      })
      fresh.forEach(fireBrowserNotif)
      // Audible chime only for the urgent 15-min reminders — the 30-min
      // heads-up is informational so we don't want to startle ops every time.
      if (fresh.some(f => f.kind === '15min')) playChime()
    }
    if (logChanged) {
      try { window.localStorage.setItem(`pickup-notif-${istToday()}`, JSON.stringify(pickupLogRef.current)) } catch {}
    }
  }, [tick, data])  // eslint-disable-line react-hooks/exhaustive-deps

  const dismissNotif = (id) => setPickupNotifs(prev => prev.filter(n => n.id !== id))

  // ── Column sort toggle ────────────────────────────────────────────────────
  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  // CSV export of the current (filtered + sorted) view. Spreadsheet-friendly
  // for management who wants to slice the data outside the app. Comma values
  // and double-quotes inside a field are quoted/escaped per RFC 4180.
  function exportCsv(rows) {
    const csvEscape = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'Branch','Region','Total Net Wt (g)',
      "Today's Bills","Today's Net Wt (g)","Today's Value (₹)",
      'Pending Bills','Pending Net Wt (g)','Pending Value (₹)',
      'Oldest Bill (days)','Oldest Bill Date',
      'Last Moved (days ago)','Pickup Time','Total Gross Wt (g)',
    ]
    const lines = [headers.map(csvEscape).join(',')]
    for (const b of rows) {
      const totalNet = (Number(b.today_net_wt || 0) + Number(b.older_net_wt || 0)).toFixed(3)
      lines.push([
        b.branch_name, b.region, totalNet,
        b.today_bills || 0, Number(b.today_net_wt || 0).toFixed(3), Number(b.today_gross_value || 0).toFixed(2),
        b.older_bills || 0, Number(b.older_net_wt || 0).toFixed(3), Number(b.older_gross_value || 0).toFixed(2),
        b.oldest_age_days != null ? b.oldest_age_days : '', b.oldest_date || '',
        b.last_moved_days_ago != null ? b.last_moved_days_ago : '', b.pickup_time || '',
        Number(b.total_gross_wt || 0).toFixed(3),
      ].map(csvEscape).join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `branch-stock-overview_${istToday()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Scope-filtered data ───────────────────────────────────────────────────
  // Every downstream computation (regions, hubs, filtered table, KPI tiles)
  // reads scopeData instead of data so the Bangalore tab and Outside tab
  // stay cleanly partitioned. Bangalore tab also strips the leaves whose
  // hub_branch_name doesn't match the active hub when one is selected.
  const scopeData = useMemo(() => {
    if (scopeTab === 'bangalore') {
      const ks = data.filter(b => b.region === 'Bangalore')
      return ks
    }
    return data.filter(b => b.region !== 'Bangalore')
  }, [data, scopeTab])

  // ── Region summary ────────────────────────────────────────────────────────
  // Custom order — Rest of Karnataka first, then Kerala / AP / Telangana.
  // Anything outside the canonical order gets appended alphabetically so a
  // newly-added region doesn't silently disappear.
  const regions = useMemo(() => {
    const all = [...new Set(scopeData.map(b => b.region).filter(Boolean))]
    return [
      ...REGION_ORDER.filter(r => all.includes(r)),
      ...all.filter(r => !REGION_ORDER.includes(r)).sort(),
    ]
  }, [scopeData])
  const regionStats = useMemo(() => regions.reduce((acc, r) => {
    const bs = scopeData.filter(b => b.region === r)
    const today_bills  = bs.reduce((s, b) => s + (b.today_bills   || 0), 0)
    const older_bills  = bs.reduce((s, b) => s + (b.older_bills   || 0), 0)
    const today_net_wt = bs.reduce((s, b) => s + (b.today_net_wt  || 0), 0)
    const older_net_wt = bs.reduce((s, b) => s + (b.older_net_wt  || 0), 0)
    acc[r] = {
      branches:     bs.length,
      active_branches: bs.filter(b => (b.today_bills || 0) + (b.older_bills || 0) > 0).length,
      today_bills, older_bills, today_net_wt, older_net_wt,
      total_bills:  today_bills + older_bills,
      total_net_wt: today_net_wt + older_net_wt,
      gross_wt:     bs.reduce((s, b) => s + b.total_gross_wt, 0),
    }
    return acc
  }, {}), [scopeData, regions])

  // ── Bangalore hubs summary ────────────────────────────────────────────────
  // Bangalore-tab hero cards: one per hub branch. A hub's totals roll up its
  // own stock + every leaf whose hub_branch_name matches. Computed only when
  // we have Bangalore rows; otherwise empty.
  const hubs = useMemo(() => {
    if (scopeTab !== 'bangalore') return []
    return scopeData
      .filter(b => b.is_hub)
      .map(b => b.branch_name)
      .sort()
  }, [scopeData, scopeTab])

  const hubStats = useMemo(() => {
    if (scopeTab !== 'bangalore') return {}
    const out = {}
    for (const hubName of hubs) {
      // hub itself + every leaf pointing to it
      const members = scopeData.filter(b => b.branch_name === hubName || b.hub_branch_name === hubName)
      const today_bills  = members.reduce((s, b) => s + (b.today_bills   || 0), 0)
      const older_bills  = members.reduce((s, b) => s + (b.older_bills   || 0), 0)
      const today_net_wt = members.reduce((s, b) => s + (b.today_net_wt  || 0), 0)
      const older_net_wt = members.reduce((s, b) => s + (b.older_net_wt  || 0), 0)
      out[hubName] = {
        branches:        members.length,
        leaves:          members.length - 1,   // minus the hub itself
        active_branches: members.filter(b => (b.today_bills || 0) + (b.older_bills || 0) > 0).length,
        today_bills, older_bills, today_net_wt, older_net_wt,
        total_bills:  today_bills + older_bills,
        total_net_wt: today_net_wt + older_net_wt,
        gross_wt:     members.reduce((s, b) => s + (b.total_gross_wt || 0), 0),
      }
    }
    return out
  }, [scopeData, scopeTab, hubs])

  // ── Bangalore-tab branch list filter ──────────────────────────────────────
  // Bangalore branches not assigned to any hub (orphans) are surfaced under
  // "All Bangalore" but never under a hub card click. When a hub is active,
  // only that hub + its leaves render in the table.
  const bangaloreHubFiltered = useMemo(() => {
    if (scopeTab !== 'bangalore' || !activeHub) return scopeData
    return scopeData.filter(b => b.branch_name === activeHub || b.hub_branch_name === activeHub)
  }, [scopeData, scopeTab, activeHub])

  // Always display weights in grams (no kg conversion). Comma-grouped, two
  // decimals so the operations team sees the exact figure (rounding to
  // integers was hiding sub-gram differences they need to reconcile).
  const fmtWtCard = (g) => ({
    value: Number(g || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    unit: 'g',
  })

  // ── Filtered + sorted ─────────────────────────────────────────────────────
  // Search now matches branch OR region (so typing 'kerala' narrows to all
  // Kerala branches without having to click the region card).
  // Bangalore tab reads bangaloreHubFiltered (already scoped to Bangalore +
  // active hub); Outside tab reads scopeData (Bangalore stripped upstream).
  const filtered = useMemo(() => {
    const baseRows = scopeTab === 'bangalore' ? bangaloreHubFiltered : scopeData
    const searchQ = (search || '').toLowerCase()
    return baseRows
      // Hide branches with zero stock — empty rows are noise. The flash cards
      // above show 'X / Y branches' so the operator knows how many are hidden.
      .filter(b => ((b.today_net_wt || 0) + (b.older_net_wt || 0)) > 0)
      .filter(b => !activeRegion || b.region === activeRegion)
      .filter(b => !searchQ || (b.branch_name || '').toLowerCase().includes(searchQ) || (b.region || '').toLowerCase().includes(searchQ))
      .filter(b => {
        // Quick-filter chips applied on top of search/region. Each chip targets
        // a real operations question — "what needs attention now?".
        // Bangalore tab doesn't render the chips, so its filter always reads
        // as "all" regardless of any stale state from the Outside tab.
        if (scopeTab === 'bangalore') return true
        const age = b.oldest_age_days || 0
        const moved = b.last_moved_days_ago
        switch (quickFilter) {
          case 'overdue':       return age > 7
          case 'watch':         return age > 3 && age <= 7
          case 'today_active':  return (b.today_bills || 0) > 0
          case 'no_movement':   return moved == null || moved > 30
          case 'all':
          default:              return true
        }
      })
      .slice()
      .sort((a, b) => {
        let av = 0, bv = 0
        if (sortKey === 'branch_name')        { av = a.branch_name || ''; bv = b.branch_name || ''; return av.localeCompare(bv) * sortDir }
        if (sortKey === 'today_bills')        { av = a.today_bills  || 0; bv = b.today_bills  || 0 }
        if (sortKey === 'today_net_wt')       { av = a.today_net_wt || 0; bv = b.today_net_wt || 0 }
        if (sortKey === 'today_gross_value')  { av = a.today_gross_value || 0; bv = b.today_gross_value || 0 }
        if (sortKey === 'older_bills')        { av = a.older_bills  || 0; bv = b.older_bills  || 0 }
        if (sortKey === 'older_net_wt')       { av = a.older_net_wt || 0; bv = b.older_net_wt || 0 }
        if (sortKey === 'older_gross_value')  { av = a.older_gross_value || 0; bv = b.older_gross_value || 0 }
        if (sortKey === 'oldest_age')         { av = a.oldest_age_days || 0; bv = b.oldest_age_days || 0 }
        if (sortKey === 'last_moved_days_ago'){ av = a.last_moved_days_ago == null ? 99999 : a.last_moved_days_ago; bv = b.last_moved_days_ago == null ? 99999 : b.last_moved_days_ago }
        if (sortKey === 'total_net_wt')       { av = (a.today_net_wt || 0) + (a.older_net_wt || 0); bv = (b.today_net_wt || 0) + (b.older_net_wt || 0) }
        if (sortKey === 'total_bills')        { av = (a.today_bills  || 0) + (a.older_bills  || 0); bv = (b.today_bills  || 0) + (b.older_bills  || 0) }
        return (av - bv) * sortDir
      })
  }, [scopeTab, scopeData, bangaloreHubFiltered, activeRegion, search, quickFilter, sortKey, sortDir])

  // ── Group filtered rows by region for the collapsible card view. Keys keep
  // the canonical REGION_ORDER so cards render Karnataka → Kerala → AP → Telangana.
  const groupedByRegion = useMemo(() =>
    regions
      .map(r => ({ region: r, branches: filtered.filter(b => b.region === r) }))
      .filter(g => g.branches.length > 0)
  , [regions, filtered])

  function toggleRegionCollapsed(r) {
    setCollapsedRegions(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else             next.add(r)
      return next
    })
  }

  // ── Grand totals ──────────────────────────────────────────────────────────
  const { grandToday, grandTodayWt, grandTodayVal, grandOlder, grandOlderWt, grandOlderVal, grandGrossWt } = useMemo(() => {
    const acc = { grandToday: 0, grandTodayWt: 0, grandTodayVal: 0, grandOlder: 0, grandOlderWt: 0, grandOlderVal: 0, grandGrossWt: 0 }
    for (const b of filtered) {
      acc.grandToday    += b.today_bills        || 0
      acc.grandTodayWt  += b.today_net_wt       || 0
      acc.grandTodayVal += b.today_gross_value  || 0
      acc.grandOlder    += b.older_bills        || 0
      acc.grandOlderWt  += b.older_net_wt       || 0
      acc.grandOlderVal += b.older_gross_value  || 0
      acc.grandGrossWt  += b.total_gross_wt     || 0
    }
    return acc
  }, [filtered])

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span style={{ color: t.text4, fontSize: '10px', marginLeft: '4px' }}>⇅</span>
    return <span style={{ color: t.gold, fontSize: '10px', marginLeft: '4px' }}>{sortDir === -1 ? '↓' : '↑'}</span>
  }

  const thBase = {
    padding: '9px 8px', fontSize: '10px', color: t.text4,
    letterSpacing: '.06em', textTransform: 'uppercase',
    background: t.card2, borderBottom: `1px solid ${t.border}`,
    whiteSpace: 'nowrap', fontWeight: 600, userSelect: 'none',
  }
  // Body cells use the same horizontal rhythm so the table aligns and stays compact.
  const tdPad = '10px 8px'

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Branch Stock Overview</div>
            {(() => {
              const isLive   = rtState === 'connected'
              const isErr    = rtState === 'error' || rtState === 'closed'
              const c        = isLive ? t.green : isErr ? t.red : t.orange
              const label    = isLive ? 'LIVE' : isErr ? 'OFFLINE' : 'CONNECTING'
              const tip      = isLive ? 'Realtime channel connected — new bills push instantly'
                            : isErr  ? 'Realtime channel dropped — refreshes still run on the 15s poll'
                            :          'Connecting to realtime channel…'
              return (
                <span title={tip} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: c, background: `${c}15`, borderRadius: '20px', padding: '3px 10px', fontWeight: 600 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c, display: 'inline-block', animation: isLive ? 'pulse 2s infinite' : 'none' }} />
                  {label}
                </span>
              )
            })()}
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            {scopeTab === 'bangalore' ? 'Bangalore branches' : 'Outside-Bangalore branches'} ·
            {lastRefresh && (
              <span style={{ color: minsAgo === 0 ? t.green : t.text4, marginLeft: '4px' }}>
                {minsAgo === 0 ? 'just refreshed' : `${minsAgo}m ago`} · {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          {/* Scope tab strip — Outside | Bangalore. Clicking flips the data
              source and (for Bangalore) swaps the region cards for hub cards. */}
          <div style={{ display: 'inline-flex', background: t.card2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 3, gap: 2, marginTop: 10 }}>
            {[
              { key: 'outside',   label: 'Outside Bangalore', accent: t.gold },
              { key: 'bangalore', label: 'Bangalore',         accent: REGION_COLORS['Bangalore'] || t.gold },
            ].map(tab => {
              const active = scopeTab === tab.key
              return (
                <button key={tab.key} onClick={() => { setScopeTab(tab.key); setActiveRegion(null) }}
                  style={{
                    background: active ? `${tab.accent}1d` : 'transparent',
                    border:     `1px solid ${active ? `${tab.accent}80` : 'transparent'}`,
                    color:      active ? tab.accent : t.text3,
                    borderRadius: 8, padding: '6px 14px',
                    fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em',
                    cursor: 'pointer',
                    transition: 'background .15s, color .15s, border-color .15s',
                  }}>
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* View-mode segmented toggle. Default 'grouped' rolls 73 branches up
              into ~4 region cards; 'flat' is the dense table for power users. */}
          {(activeRegion || search) && (
            <button onClick={() => { setActiveRegion(null); setSearch('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 13px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              Clear
            </button>
          )}
          <button onClick={() => { triggerSync({ minIntervalMs: 0 }).finally(fetchData) }} disabled={loading}
            style={{ background: loading ? t.card2 : `${t.gold}15`, border: `1px solid ${loading ? t.border : t.gold}40`, borderRadius: '8px', padding: '7px 16px', fontSize: '12px', color: loading ? t.text4 : t.gold, cursor: loading ? 'default' : 'pointer', fontWeight: 600, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Load error banner — surfaces auth/network/RPC failures that used
           to silently leave a stuck spinner or empty list. */}
      {loadError && (
        <div style={{
          background: `${t.red}12`, border: `1px solid ${t.red}40`,
          borderLeft: `4px solid ${t.red}`, borderRadius: '8px',
          padding: '10px 14px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>
            ⚠ Couldn't load branch stock — {loadError}
          </span>
          <button onClick={() => fetchData()}
            style={{ background: 'transparent', border: `1px solid ${t.red}80`, color: t.red, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}

      {/* ── Pickup alerts — sticky banner, surfaces branches within 30 min
           of scheduled pickup so the ops team can prep. Dismissible per
           branch, resets at midnight IST. */}
      {/* Pickup Approaching banner is meaningful only for outstation BVC
          pickups. Bangalore Transaction Executives sweep hubs daily on a
          continuous schedule, so the 30-min-before-pickup alert doesn't
          model that workflow — hide it on the Bangalore tab. */}
      {scopeTab === 'outside' && pickupAlerts.length > 0 && (
        <div style={{
          background: `linear-gradient(135deg, ${t.orange}18, ${t.orange}08)`,
          border: `1px solid ${t.orange}50`,
          borderLeft: `4px solid ${t.orange}`,
          borderRadius: '10px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '16px', animation: 'pulse 1.8s infinite' }}>⏰</span>
            <span style={{ fontSize: '11px', color: t.orange, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Pickup approaching</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
            {pickupAlerts.map(a => {
              const isSoon = a.mins <= 10
              return (
                <span key={a.branch} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  background: t.card, border: `1px solid ${isSoon ? t.red : t.orange}40`,
                  borderRadius: '6px', padding: '4px 8px 4px 10px',
                  fontSize: '11px', color: t.text2,
                }}>
                  <strong style={{ color: t.text1, fontWeight: 600 }}>{a.branch}</strong>
                  <span style={{ color: t.text4 }}>·</span>
                  <span style={{ color: isSoon ? t.red : t.orange, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {a.mins}m
                  </span>
                  <span style={{ color: t.text4, fontSize: '10px' }}>@ {a.pickup_time}</span>
                  <button onClick={() => dismissPickup(a.branch)}
                    title="Dismiss until tomorrow"
                    style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: '14px', padding: '0 0 0 4px', lineHeight: 1 }}>
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Pickup popup notifications — portaled stack, top-right.
           30-min heads-up + 15-min "no consignment yet" reminder.
           Each card shows branch · net weight · pickup time. */}
      {typeof document !== 'undefined' && pickupNotifs.length > 0 && createPortal((
        <div style={{
          position: 'fixed', top: 18, right: 18, zIndex: 3000,
          display: 'flex', flexDirection: 'column', gap: 10,
          maxWidth: 340, pointerEvents: 'none',
        }}>
          {pickupNotifs.map(n => {
            const urgent = n.kind === '15min'
            const accent = urgent ? t.red : t.orange
            // Same action as the row's Move button — deep-link to
            // Consignment Data with the branch pre-selected, then drop
            // the popup.
            const goMove = () => {
              setConsignmentDeepLink({ branch: n.branch, region: n.region })
              setActiveNav('consignment-data')
              dismissNotif(n.id)
            }
            return (
              <div key={n.id}
                onClick={goMove}
                title={`Move ${n.branch} stock — create consignment`}
                style={{
                  pointerEvents: 'auto', cursor: 'pointer',
                  background: t.card,
                  border: `1px solid ${accent}66`,
                  borderLeft: `4px solid ${accent}`,
                  borderRadius: 12,
                  boxShadow: '0 14px 40px rgba(0,0,0,.4)',
                  padding: '13px 15px',
                  animation: 'cnsPickupPopIn .3s cubic-bezier(.34,1.2,.64,1)',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: accent }}>
                    <span style={{ fontSize: 14, animation: urgent ? 'pulse 1.1s infinite' : 'none' }}>{urgent ? '⚠' : '⏰'}</span>
                    {urgent ? 'Pickup reminder · 15 min' : 'Pickup approaching · 30 min'}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); dismissNotif(n.id) }}
                    title="Dismiss"
                    style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: 0 }}>
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: t.text1, letterSpacing: '-.01em' }}>{n.branch}</div>
                {n.region && <div style={{ fontSize: 10.5, color: t.text4, marginTop: 1, fontWeight: 600 }}>{n.region}</div>}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 9 }}>
                  <div>
                    <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Net weight</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: t.gold, fontFamily: 'monospace' }}>
                      {n.netWt.toFixed(2)}<span style={{ fontSize: 10, color: t.text3, marginLeft: 2 }}>g</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Pickup time</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: accent, fontFamily: 'monospace' }}>{n.pickup_time}</div>
                  </div>
                </div>
                {urgent && (
                  <div style={{ fontSize: 10.5, color: accent, marginTop: 9, fontWeight: 700, lineHeight: 1.4 }}>
                    No consignment created yet — move the stock before pickup.
                  </div>
                )}
                {/* Move button — same deep-link as the branch-row CTA. */}
                <button onClick={(e) => { e.stopPropagation(); goMove() }}
                  style={{
                    marginTop: 11, width: '100%',
                    background: accent, color: '#fff',
                    border: 'none', borderRadius: 8,
                    padding: '9px 14px', fontSize: 12.5, fontWeight: 800,
                    letterSpacing: '.03em', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  Move stock → create consignment
                </button>
              </div>
            )
          })}
        </div>
      ), document.body)}

      <style>{`
        @keyframes cnsPickupPopIn {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* ── Region Flashcards (Outside tab only) — horizontal scroll-snap on mobile ── */}
      {/* Hidden entirely when user is restricted to a single region (one card = no value) */}
      {scopeTab === 'outside' && canSee('element.consignment-overview.region_cards') && !regionAccess.single && (
        <div style={{
          display: 'flex', gap: '10px',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          overflowX: isMobile ? 'auto' : 'visible',
          scrollSnapType: isMobile ? 'x mandatory' : 'none',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          margin: isMobile ? '0 -16px' : 0,
          padding: isMobile ? '0 16px 4px' : 0,
        }}>

          {/* All Regions — totals across the board. Hidden for region-restricted users. */}
          {!regionAccess.restricted && (() => {
            const allBills      = scopeData.reduce((s, b) => s + (b.today_bills || 0) + (b.older_bills || 0), 0)
            const allNetWt      = scopeData.reduce((s, b) => s + (b.today_net_wt || 0) + (b.older_net_wt || 0), 0)
            const allTodayBills = scopeData.reduce((s, b) => s + (b.today_bills || 0), 0)
            const activeBranches = scopeData.filter(b => ((b.today_net_wt || 0) + (b.older_net_wt || 0)) > 0).length
            const w = fmtWtCard(allNetWt)
            const isActive = !activeRegion
            return (
              <div onClick={() => setActiveRegion(null)}
                style={{
                  background: isActive ? `linear-gradient(145deg, ${t.gold}18, ${t.gold}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                  border: `1px solid ${isActive ? t.gold + '60' : t.border}`,
                  borderLeft: `4px solid ${isActive ? t.gold : t.text4 + '30'}`,
                  borderRadius: '12px', padding: '16px 18px',
                  cursor: 'pointer', minWidth: '180px',
                  flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'all .2s',
                  boxShadow: isActive ? `0 4px 16px ${t.gold}20` : '0 1px 3px rgba(0,0,0,.2)',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '9px', color: isActive ? t.gold : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>All Regions</div>
                  <span style={{ fontSize: '15px', opacity: isActive ? 1 : 0.5 }}>🌐</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                  <span style={{ fontSize: '26px', fontWeight: 300, color: isActive ? t.gold : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: isActive ? t.gold : t.text3 }}>{w.unit}</span>
                </div>
                <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span title={`${activeBranches} of ${scopeData.length} branches currently hold stock`}>
                    <strong style={{ color: t.text2 }}>{activeBranches}</strong>/{scopeData.length} branches
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{allBills}</strong> bills</span>
                  {allTodayBills > 0 && <><span style={{ color: t.border2 }}>·</span><span style={{ color: t.green, fontWeight: 600 }}>+{allTodayBills} today</span></>}
                </div>
              </div>
            )
          })()}

          {regions.map(r => {  // already filtered to user's allowed regions via the data feed
            const stats  = regionStats[r] || {}
            const color  = REGION_COLORS[r] || t.text3
            const icon   = REGION_ICONS[r] || '📍'
            const active = activeRegion === r
            const w      = fmtWtCard(stats.total_net_wt)
            return (
              <div key={r} onClick={() => setActiveRegion(active ? null : r)}
                style={{
                  background: active ? `linear-gradient(145deg, ${color}18, ${color}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                  border: `1px solid ${active ? color + '60' : t.border}`,
                  borderLeft: `4px solid ${active ? color : color + '30'}`,
                  borderRadius: '12px', padding: '16px 18px',
                  cursor: 'pointer', minWidth: '210px',
                  flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'all .2s',
                  boxShadow: active ? `0 4px 16px ${color}20` : '0 1px 3px rgba(0,0,0,.2)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.transform = 'translateY(0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '9px', color: active ? color : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</div>
                  <span style={{ fontSize: '15px', opacity: active ? 1 : 0.6, flexShrink: 0, marginLeft: '6px' }}>{icon}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                  <span style={{ fontSize: '26px', fontWeight: 300, color: active ? color : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: active ? color : t.text3 }}>{w.unit}</span>
                </div>
                <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span title={`${stats.active_branches || 0} of ${stats.branches || 0} branches in this region currently hold stock`}>
                    <strong style={{ color: t.text2 }}>{stats.active_branches || 0}</strong>/{stats.branches || 0} branches
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{stats.total_bills || 0}</strong> bills</span>
                  {stats.today_bills > 0 && <><span style={{ color: t.border2 }}>·</span><span style={{ color: t.green, fontWeight: 600 }}>+{stats.today_bills} today</span></>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Bangalore Hub Flashcards (Bangalore tab only) — same visual
          language as the region cards above. 'All Bangalore' on the left,
          one card per is_hub=true branch (BASAWESHWARANAGAR, K R PURAM,
          KAIKONDRAHALLI, KATRIGUPPE, BOMMANAHALLI, ADUGODI). Clicking a
          hub filters the branch list below to that hub + every leaf
          whose hub_branch_name matches. ── */}
      {scopeTab === 'bangalore' && canSee('element.consignment-overview.region_cards') && (
        <div style={{
          display: 'flex', gap: '10px',
          // Single horizontal row across all viewports. 7 hub cards rarely
          // fit on a laptop without compromise, so we always allow scroll
          // and let the card minWidths breathe instead of wrapping into a
          // second row.
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollSnapType: isMobile ? 'x mandatory' : 'none',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          margin: isMobile ? '0 -16px' : 0,
          padding: isMobile ? '0 16px 4px' : '0 0 4px',
        }}>
          {/* All Bangalore — sum across every Bangalore row. Click clears the hub filter. */}
          {(() => {
            const bglColor = REGION_COLORS['Bangalore'] || t.gold
            const allBills      = scopeData.reduce((s, b) => s + (b.today_bills || 0) + (b.older_bills || 0), 0)
            const allNetWt      = scopeData.reduce((s, b) => s + (b.today_net_wt || 0) + (b.older_net_wt || 0), 0)
            const allTodayBills = scopeData.reduce((s, b) => s + (b.today_bills || 0), 0)
            const activeBranches = scopeData.filter(b => ((b.today_net_wt || 0) + (b.older_net_wt || 0)) > 0).length
            const w = fmtWtCard(allNetWt)
            const isActive = !activeHub
            return (
              <div onClick={() => setActiveHub(null)}
                style={{
                  background: isActive ? `linear-gradient(145deg, ${bglColor}18, ${bglColor}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                  border: `1px solid ${isActive ? bglColor + '60' : t.border}`,
                  borderLeft: `4px solid ${isActive ? bglColor : t.text4 + '30'}`,
                  borderRadius: '12px', padding: '14px 14px',
                  cursor: 'pointer',
                  flex: '1 1 0', minWidth: '160px',
                  flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'all .2s',
                  boxShadow: isActive ? `0 4px 16px ${bglColor}20` : '0 1px 3px rgba(0,0,0,.2)',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '9px', color: isActive ? bglColor : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>All Bangalore</div>
                  <span style={{ fontSize: '15px', opacity: isActive ? 1 : 0.5 }}>🏙</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                  <span style={{ fontSize: '26px', fontWeight: 300, color: isActive ? bglColor : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: isActive ? bglColor : t.text3 }}>{w.unit}</span>
                </div>
                <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span title={`${activeBranches} of ${scopeData.length} Bangalore branches currently hold stock`}>
                    <strong style={{ color: t.text2 }}>{activeBranches}</strong>/{scopeData.length} branches
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{allBills}</strong> bills</span>
                  {allTodayBills > 0 && <><span style={{ color: t.border2 }}>·</span><span style={{ color: t.green, fontWeight: 600 }}>+{allTodayBills} today</span></>}
                </div>
              </div>
            )
          })()}

          {hubs.map(hubName => {
            const stats   = hubStats[hubName] || {}
            const color   = t.gold
            const active  = activeHub === hubName
            const w       = fmtWtCard(stats.total_net_wt)
            return (
              <div key={hubName} onClick={() => setActiveHub(active ? null : hubName)}
                title={`${stats.leaves || 0} leaf branch${(stats.leaves || 0) === 1 ? '' : 'es'} report to this hub`}
                style={{
                  background: active ? `linear-gradient(145deg, ${color}18, ${color}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                  border: `1px solid ${active ? color + '60' : t.border}`,
                  borderLeft: `4px solid ${active ? color : color + '30'}`,
                  borderRadius: '12px', padding: '14px 14px',
                  cursor: 'pointer',
                  flex: '1 1 0', minWidth: '160px',
                  flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'all .2s',
                  boxShadow: active ? `0 4px 16px ${color}20` : '0 1px 3px rgba(0,0,0,.2)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.transform = 'translateY(0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '9px', color: active ? color : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hubName} <span style={{ fontSize: 8, color: active ? color : t.text4, marginLeft: 4, letterSpacing: '.06em' }}>HUB</span>
                  </div>
                  <span style={{ fontSize: '15px', opacity: active ? 1 : 0.6, flexShrink: 0, marginLeft: '6px' }}>🏛</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                  <span style={{ fontSize: '26px', fontWeight: 300, color: active ? color : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: active ? color : t.text3 }}>{w.unit}</span>
                </div>
                <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span title={`${stats.active_branches || 0} of ${stats.branches || 0} (hub + leaves) currently hold stock`}>
                    <strong style={{ color: t.text2 }}>{stats.active_branches || 0}</strong>/{stats.branches || 0} branches
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{stats.total_bills || 0}</strong> bills</span>
                  {(stats.leaves || 0) > 0 && <><span style={{ color: t.border2 }}>·</span><span><strong style={{ color: t.text3 }}>{stats.leaves}</strong> leaves</span></>}
                </div>
                {/* Dispatch button — fires the hub-wise consignment flow.
                    Disabled when the hub has zero bills (nothing to dispatch). */}
                {(stats.total_bills || 0) > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDispatchHub(hubName); setDispatchResult(null) }}
                    style={{
                      marginTop: 10,
                      width: '100%',
                      background: `${color}18`,
                      border: `1px solid ${color}55`,
                      borderRadius: 6,
                      padding: '6px 10px',
                      color, fontSize: 11, fontWeight: 800,
                      letterSpacing: '.04em', textTransform: 'uppercase',
                      cursor: 'pointer', transition: 'background .15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `${color}30` }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = `${color}18` }}>
                    Dispatch →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Hub Dispatch Confirmation Modal ── Portalled to document.body
          so position:fixed is anchored to the viewport, not whatever
          ancestor (like the page-enter wrapper) happens to be the nearest
          containing block. Without the portal the modal floated below
          centre on slower paints. */}
      {dispatchHub && typeof document !== 'undefined' && createPortal((() => {
        const stats   = hubStats[dispatchHub] || {}
        // Branch-wise breakdown for the confirmation table — every hub member
        // (hub itself + leaves) with positive stock.
        const members = scopeData
          .filter(b => (b.branch_name === dispatchHub || b.hub_branch_name === dispatchHub) && ((b.today_bills || 0) + (b.older_bills || 0)) > 0)
          .map(b => ({
            branch_name: b.branch_name,
            is_hub:      b.branch_name === dispatchHub,
            bills:       (b.today_bills || 0) + (b.older_bills || 0),
            gross_wt:    (b.today_net_wt || 0) + (b.older_net_wt || 0),    // approximation; API reports exact gross
            value:       (b.today_gross_value || 0) + (b.older_gross_value || 0),
          }))
          .sort((a, b) => b.gross_wt - a.gross_wt)

        const close = () => { if (!dispatchBusy) { setDispatchHub(null); setDispatchResult(null) } }
        const onDispatch = async () => {
          setDispatchBusy(true)
          try {
            const r = await authedFetch('/api/consignments?action=create_hub_consignment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hub_branch_name: dispatchHub }),
            })
            const j = await r.json()
            if (!r.ok || j.error) {
              alert(j.error || `Dispatch failed (HTTP ${r.status})`)
              setDispatchBusy(false)
              return
            }
            setDispatchResult(j)
            fetchData(true)        // silent refresh so the cards update
          } catch (err) {
            alert(err?.message || 'Dispatch failed')
          } finally {
            setDispatchBusy(false)
          }
        }

        return (
          <div onClick={close}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
              zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20, backdropFilter: 'blur(2px)',
            }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{
                background: t.card, borderRadius: 12,
                border: `1px solid ${t.border}`,
                maxWidth: 620, width: '100%', maxHeight: '85vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 12px 48px rgba(0,0,0,.5)',
                overflow: 'hidden',
              }}>
              {/* Header — sticky at top */}
              <div style={{ padding: '18px 22px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: t.text1 }}>
                  Dispatch Hub · <span style={{ color: t.gold }}>{dispatchHub}</span>
                </div>
                <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>
                  {dispatchResult
                    ? 'Consignment created. Generate EWB and download Delivery Challan from Consignment Data.'
                    : 'One consignment will be created for the hub covering every assigned branch listed below. Review and confirm.'}
                </div>
              </div>

              {/* Body — only this section scrolls when content overflows */}
              <div style={{ padding: '16px 22px', overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}>
                {dispatchResult ? (
                  <>
                    <div style={{
                      background: `${t.green}10`, border: `1px solid ${t.green}40`,
                      borderRadius: 8, padding: '12px 14px', marginBottom: 14,
                    }}>
                      <div style={{ fontSize: 13, color: t.green, fontWeight: 700, marginBottom: 4 }}>✓ Hub dispatched</div>
                      <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.6 }}>
                        <strong>{dispatchResult.totals?.bills || 0}</strong> bills · <strong>{Number(dispatchResult.totals?.gross_wt || 0).toFixed(2)} g</strong> gross · <strong>{fmtINR(dispatchResult.totals?.value || 0)}</strong>
                        <br />
                        Consignment <code style={{ background: t.card2, padding: '1px 6px', borderRadius: 3, color: t.gold, fontFamily: 'monospace' }}>{dispatchResult.consignment?.consignment_no || dispatchResult.consignment?.tmp_prf_no}</code>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6 }}>
                      Next: open Consignment Data, find this consignment, and click <strong style={{ color: t.text2 }}>Generate Delivery Challan</strong> then <strong style={{ color: t.text2 }}>Generate EWB</strong> — the workflow stamps are already in place so both will fire without the intermediate steps.
                    </div>
                  </>
                ) : (
                  <>
                    {/* Branch-wise summary */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                          <th style={{ textAlign: 'left',  padding: '8px 6px', color: t.text4, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Branch</th>
                          <th style={{ textAlign: 'right', padding: '8px 6px', color: t.text4, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Bills</th>
                          <th style={{ textAlign: 'right', padding: '8px 6px', color: t.text4, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Net Wt (g)</th>
                          <th style={{ textAlign: 'right', padding: '8px 6px', color: t.text4, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.length === 0 && (
                          <tr><td colSpan={4} style={{ padding: '20px 8px', color: t.text4, textAlign: 'center', fontSize: 12 }}>
                            No active stock under this hub right now.
                          </td></tr>
                        )}
                        {members.map(m => (
                          <tr key={m.branch_name} style={{ borderBottom: `1px solid ${t.border}` }}>
                            <td style={{ padding: '7px 6px', color: t.text1 }}>
                              {m.branch_name}
                              {m.is_hub && <span style={{ marginLeft: 6, fontSize: 8, color: t.gold, background: `${t.gold}15`, padding: '1px 5px', borderRadius: 3, letterSpacing: '.06em', fontWeight: 700 }}>HUB</span>}
                            </td>
                            <td style={{ padding: '7px 6px', textAlign: 'right', color: t.text2, fontFamily: 'monospace', fontWeight: 600 }}>{m.bills}</td>
                            <td style={{ padding: '7px 6px', textAlign: 'right', color: t.text2, fontFamily: 'monospace', fontWeight: 600 }}>{Number(m.gross_wt).toFixed(2)}</td>
                            <td style={{ padding: '7px 6px', textAlign: 'right', color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>{fmtINR(m.value)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: `${t.gold}10`, borderTop: `2px solid ${t.gold}40` }}>
                          <td style={{ padding: '8px 6px', color: t.gold, fontWeight: 800, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>Σ Hub Total</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: t.gold, fontFamily: 'monospace', fontWeight: 800 }}>{stats.total_bills || 0}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: t.gold, fontFamily: 'monospace', fontWeight: 800 }}>{Number(stats.total_net_wt || 0).toFixed(2)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: t.blue, fontFamily: 'monospace', fontWeight: 800 }}>—</td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: t.text4, marginTop: 12, lineHeight: 1.5 }}>
                      Eligible at_branch bills only. Bills already booked, audit-consumed, or sitting on another in-flight consignment are excluded. Exact totals are confirmed by the server on dispatch.
                    </div>
                  </>
                )}
              </div>

              {/* Footer — sticky at bottom; always visible regardless of body scroll */}
              <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, background: t.card }}>
                {dispatchResult ? (
                  <>
                    <button onClick={() => { close(); setActiveNav('consignment-data') }}
                      style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '.02em' }}>
                      Open Consignment Data →
                    </button>
                    <button onClick={close}
                      style={{ background: 'transparent', color: t.text2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Close
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={close} disabled={dispatchBusy}
                      style={{ background: 'transparent', color: t.text3, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: dispatchBusy ? 'not-allowed' : 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={onDispatch} disabled={dispatchBusy || members.length === 0}
                      style={{
                        background: dispatchBusy || members.length === 0 ? t.card2 : t.gold,
                        color:      dispatchBusy || members.length === 0 ? t.text4  : '#1a0a00',
                        border: 'none', borderRadius: 7, padding: '8px 20px',
                        fontSize: 12, fontWeight: 800, cursor: dispatchBusy || members.length === 0 ? 'not-allowed' : 'pointer',
                        letterSpacing: '.02em',
                      }}>
                      {dispatchBusy ? 'Dispatching…' : 'Dispatch Now'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })(), document.body)}

      {/* ── KPI Strip ── 8 tiles in two semantic groups (Today / Pending),
           bookended by Branches and Total Gross Wt. auto-fit lets the strip
           wrap into 4×2 on narrow viewports, 8×1 on wide.
           Hidden on the Bangalore tab — every Bangalore bill of the day
           reaches HO the same day, so today/pending decomposition doesn't
           model the workflow. */}
      {scopeTab === 'outside' && (
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>

        {/* Branches */}
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>Branches</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.text1, fontFamily: 'monospace', lineHeight: 1 }}>{filtered.length}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>of {scopeData.length} total</div>
        </div>

        {/* Today group */}
        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.blue}`, background: `${t.blue}08` }}>
          <div style={{ fontSize: '9px', color: t.blue, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Today's Bills</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.blue, fontFamily: 'monospace', lineHeight: 1 }}>{fmtNum(grandToday)}</div>
          <div style={{ fontSize: '10px', color: `${t.blue}80`, marginTop: '4px' }}>purchased today</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.blue}`, background: `${t.blue}08` }}>
          <div style={{ fontSize: '9px', color: t.blue, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Today's Net Wt</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.blue, fontFamily: 'monospace', lineHeight: 1 }}>{fmt(grandTodayWt, 2)}<span style={{ fontSize: '13px', marginLeft: '3px' }}>g</span></div>
          <div style={{ fontSize: '10px', color: `${t.blue}80`, marginTop: '4px' }}>net gold today</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.blue}`, background: `${t.blue}08` }}>
          <div style={{ fontSize: '9px', color: t.blue, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Today's Value</div>
          <div style={{ fontSize: '22px', fontWeight: 200, color: t.blue, fontFamily: 'monospace', lineHeight: 1 }}>{grandTodayVal ? fmtINR(grandTodayVal) : '—'}</div>
          <div style={{ fontSize: '10px', color: `${t.blue}80`, marginTop: '4px' }}>purchase value</div>
        </div>

        {/* Pending group */}
        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.orange}`, background: `${t.orange}08` }}>
          <div style={{ fontSize: '9px', color: t.orange, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Pending Bills</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.orange, fontFamily: 'monospace', lineHeight: 1 }}>{fmtNum(grandOlder)}</div>
          <div style={{ fontSize: '10px', color: `${t.orange}80`, marginTop: '4px' }}>at_branch, pre-today</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.orange}`, background: `${t.orange}08` }}>
          <div style={{ fontSize: '9px', color: t.orange, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Pending Net Wt</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.orange, fontFamily: 'monospace', lineHeight: 1 }}>{fmt(grandOlderWt, 2)}<span style={{ fontSize: '13px', marginLeft: '3px' }}>g</span></div>
          <div style={{ fontSize: '10px', color: `${t.orange}80`, marginTop: '4px' }}>closing stock</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.orange}`, background: `${t.orange}08` }}>
          <div style={{ fontSize: '9px', color: t.orange, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Pending Value</div>
          <div style={{ fontSize: '22px', fontWeight: 200, color: t.orange, fontFamily: 'monospace', lineHeight: 1 }}>{grandOlderVal ? fmtINR(grandOlderVal) : '—'}</div>
          <div style={{ fontSize: '10px', color: `${t.orange}80`, marginTop: '4px' }}>at-risk capital</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.gold}`, background: `${t.gold}06` }}>
          <div style={{ fontSize: '9px', color: t.gold, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Total Gross Wt</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.gold, fontFamily: 'monospace', lineHeight: 1 }}>{fmt(grandGrossWt, 2)}<span style={{ fontSize: '13px', marginLeft: '3px' }}>g</span></div>
          <div style={{ fontSize: '10px', color: `${t.gold}80`, marginTop: '4px' }}>all stock gross</div>
        </div>
      </div>
      )}

      {/* ── Search + quick filters + CSV export ── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        {canSee('element.consignment-overview.search') && (
          <div style={{ position: 'relative', maxWidth: isMobile ? '100%' : '260px', flex: 1, minWidth: isMobile ? '100%' : 'auto' }}>
            <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch or region…"
              style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px 8px 30px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        )}

        {/* Quick filter chips — operations questions, not data dimensions.
            Hidden on the Bangalore tab — overdue / watch / no-movement
            categories don't apply when every bill arrives at HO the same day. */}
        {scopeTab === 'outside' && (
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {[
            { key: 'all',          label: 'All',           color: t.text2  },
            { key: 'overdue',      label: 'Overdue >7d',   color: t.red    },
            { key: 'watch',        label: 'Watch 4-7d',    color: t.orange },
            { key: 'today_active', label: 'Active today',  color: t.blue   },
            { key: 'no_movement',  label: 'No movement',   color: t.purple },
          ].map(q => {
            const active = quickFilter === q.key
            return (
              <button key={q.key}
                onClick={() => setQuickFilter(q.key)}
                style={{
                  padding: '6px 12px', borderRadius: '6px',
                  background: active ? `${q.color}18` : 'transparent',
                  border: `1px solid ${active ? `${q.color}80` : t.border2}`,
                  color: active ? q.color : t.text3,
                  fontSize: '11px', fontWeight: active ? 700 : 500, letterSpacing: '.02em',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'all .12s',
                }}>
                {q.label}
              </button>
            )
          })}
        </div>
        )}

        <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: t.text4 }}>
            {filtered.length} of {data.length}{isMobile ? ' · swipe' : ''}
          </span>
          <button onClick={() => exportCsv(filtered)} title="Download the current view as CSV"
            style={{
              padding: '6px 12px', borderRadius: '6px',
              background: 'transparent', border: `1px solid ${t.border2}`,
              color: t.text2, fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
            }}>
            ↓ CSV
          </button>
        </div>
      </div>

      {/* ── Grouped view ── default. Folds 73 branches into one card per region. */}
      {/* Grouped view retired — toggle removed, this branch never renders.
          Kept compiled-out (literal false guard) so the code is still here
          if we want to bring grouped back later without re-archaeology. */}
      {false && canSee('element.consignment-overview.table') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading && data.length === 0 ? (
            <div style={{ ...card, padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : groupedByRegion.length === 0 ? (
            <div style={{ ...card, padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {search || activeRegion ? 'No branches match your filter' : 'No stock at any branch'}
            </div>
          ) : groupedByRegion.map(g => {
            const rColor    = REGION_COLORS[g.region] || t.text3
            const collapsed = collapsedRegions.has(g.region)
            const stats     = regionStats[g.region] || {}
            const totalsNow = g.branches.reduce((acc, b) => {
              acc.today_bills  += b.today_bills  || 0
              acc.today_net_wt += b.today_net_wt || 0
              acc.older_bills  += b.older_bills  || 0
              acc.older_net_wt += b.older_net_wt || 0
              acc.total_value  += (b.today_gross_value || 0) + (b.older_gross_value || 0)
              return acc
            }, { today_bills: 0, today_net_wt: 0, older_bills: 0, older_net_wt: 0, total_value: 0 })
            const totalNetWt   = totalsNow.today_net_wt + totalsNow.older_net_wt
            const w            = fmtWtCard(totalNetWt)
            const branchesShown = g.branches.length
            const hasFreshBills = g.branches.some(b => recentlyChanged.has(b.branch_name))

            return (
              <div key={g.region} style={{
                ...card,
                overflow: 'hidden',
                borderTop: `3px solid ${rColor}`,
                boxShadow: hasFreshBills ? `0 0 0 1px ${rColor}40, 0 6px 20px ${rColor}25` : '0 1px 3px rgba(0,0,0,.2)',
                transition: 'box-shadow .4s, transform .15s',
              }}>
                {/* Region header — clicking toggles collapse */}
                <div onClick={() => toggleRegionCollapsed(g.region)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '14px 18px', cursor: 'pointer',
                    background: `linear-gradient(90deg, ${rColor}10, transparent 60%)`,
                    borderBottom: collapsed ? 'none' : `1px solid ${t.border}`,
                  }}>
                  <span style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: `${rColor}25`, color: rColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 700,
                    transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform .2s',
                  }}>▾</span>
                  <span style={{ fontSize: '18px' }}>{REGION_ICONS[g.region] || '📍'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: t.text1 }}>{g.region}</div>
                      <div style={{ fontSize: '11px', color: t.text4 }}>
                        <strong style={{ color: t.text2 }}>{branchesShown}</strong>
                        {stats.branches > branchesShown && <> / {stats.branches}</>} branch{branchesShown !== 1 ? 'es' : ''}
                        {totalsNow.today_bills > 0 && (
                          <> · <span style={{ color: t.green, fontWeight: 600 }}>+{totalsNow.today_bills} today</span></>
                        )}
                        {hasFreshBills && (
                          <> · <span style={{ color: rColor, fontWeight: 700, animation: 'pulse 1.4s infinite' }}>● new arrival</span></>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Roll-up stats on the right */}
                  <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Net Wt</div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: rColor, fontFamily: 'monospace', lineHeight: 1.2 }}>
                        {w.value}<span style={{ fontSize: '10px', marginLeft: '2px' }}>{w.unit}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Bills</div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: t.text1, fontFamily: 'monospace', lineHeight: 1.2 }}>
                        {totalsNow.today_bills + totalsNow.older_bills || '—'}
                      </div>
                    </div>
                    {!isMobile && totalsNow.total_value > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Value</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: t.gold, fontFamily: 'monospace', lineHeight: 1.2 }}>
                          {fmtINR(totalsNow.total_value)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Branches inside this region */}
                {!collapsed && (
                  <div>
                    {g.branches.map((b, i) => {
                      const hasToday    = (b.today_bills || 0) > 0
                      const hasPending  = (b.older_bills || 0) > 0
                      const ageDays     = b.oldest_age_days || 0
                      const urgentTier  = ageDays > 7 ? 'overdue' : ageDays > 3 ? 'watch' : null
                      const urgentColor = urgentTier === 'overdue' ? t.red : urgentTier === 'watch' ? t.orange : null
                      const isFresh     = recentlyChanged.has(b.branch_name)
                      const totalNet    = (b.today_net_wt || 0) + (b.older_net_wt || 0)

                      return (
                        <div key={b.branch_name}
                          className={`cstock-row${isFresh ? ' cstock-row-fresh' : ''}`}
                          title={`Click to create a consignment from ${b.branch_name}`}
                          onClick={() => {
                            setConsignmentDeepLink({ branch: b.branch_name, region: b.region })
                            setActiveNav('consignment-data')
                          }}
                          onMouseEnter={e => {
                            if (!e.currentTarget.dataset.prefetched) {
                              e.currentTarget.dataset.prefetched = '1'
                              const enc = encodeURIComponent(b.branch_name)
                              prefetch(`/api/consignments?action=stock_in_branch&branch=${enc}`)
                              prefetch(`/api/consignments?action=transfer_history&branch=${enc}`)
                            }
                          }}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile
                              ? '1fr auto'
                              : 'minmax(180px,1.6fr) repeat(4, minmax(72px, .9fr)) auto',
                            gap: isMobile ? '6px' : '14px',
                            alignItems: 'center',
                            padding: '12px 14px 12px 18px',
                            borderBottom: i < g.branches.length - 1 ? `1px solid ${t.border}40` : 'none',
                            borderLeft: `3px solid ${urgentColor || rColor + '60'}`,
                            cursor: 'pointer',
                            position: 'relative',
                            background: isFresh ? `${rColor}10` : 'transparent',
                            transition: 'background .25s',
                          }}>
                          {/* Branch name + region accent + age tier ribbon */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: t.text1, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {b.branch_name}
                                {isFresh && (
                                  <span title="New bill arrived since last refresh"
                                    style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: rColor, animation: 'pulse 1.4s infinite', flexShrink: 0 }} />
                                )}
                                {urgentTier && (
                                  <span style={{ fontSize: '9px', color: urgentColor, background: `${urgentColor}18`, borderRadius: '4px', padding: '1px 5px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', flexShrink: 0 }}>
                                    {urgentTier === 'overdue' ? `${ageDays}d` : 'watch'}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {b.pickup_time && <span title="Daily pickup">⏱ {b.pickup_time}</span>}
                                {b.last_moved_days_ago != null && (
                                  <span title="Days since last consignment was created">↻ {b.last_moved_days_ago}d ago</span>
                                )}
                                {b.oldest_date && hasPending && (
                                  <span title="Oldest pending bill date">oldest {fmtDate(b.oldest_date)}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Mobile: collapse the rest into one summary line */}
                          {isMobile ? (
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              <div style={{ fontSize: '13px', color: t.gold, fontWeight: 600 }}>{fmt(totalNet, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></div>
                              <div style={{ fontSize: '10px', color: t.text3, marginTop: '2px' }}>
                                {hasToday && <span style={{ color: t.blue, fontWeight: 600 }}>+{b.today_bills} today</span>}
                                {hasToday && hasPending && <span style={{ color: t.text4 }}> · </span>}
                                {hasPending && <span style={{ color: t.orange }}>{b.older_bills} pending</span>}
                                {!hasToday && !hasPending && <span style={{ color: t.text4 }}>—</span>}
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Today bills */}
                              <div style={{ textAlign: 'right' }}>
                                {hasToday ? (
                                  <span className={isFresh ? 'cstock-cell-pulse' : ''}
                                    style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 700, background: `${t.blue}15`, padding: '3px 9px', borderRadius: '5px' }}>
                                    +{b.today_bills}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '11px', color: t.text4 }}>—</span>
                                )}
                                <div style={{ fontSize: '9px', color: t.text4, marginTop: '3px', letterSpacing: '.06em', textTransform: 'uppercase' }}>today</div>
                              </div>
                              {/* Pending bills */}
                              <div style={{ textAlign: 'right' }}>
                                {hasPending ? (
                                  <span style={{ fontSize: '13px', color: t.orange, fontFamily: 'monospace', fontWeight: 700, background: `${t.orange}15`, padding: '3px 9px', borderRadius: '5px' }}>
                                    {b.older_bills}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '11px', color: t.text4 }}>—</span>
                                )}
                                <div style={{ fontSize: '9px', color: t.text4, marginTop: '3px', letterSpacing: '.06em', textTransform: 'uppercase' }}>pending</div>
                              </div>
                              {/* Total net wt */}
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>
                                  {fmt(totalNet, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                                </span>
                                <div style={{ fontSize: '9px', color: t.text4, marginTop: '3px', letterSpacing: '.06em', textTransform: 'uppercase' }}>net wt</div>
                              </div>
                              {/* Total value */}
                              <div style={{ textAlign: 'right' }}>
                                {((b.today_gross_value || 0) + (b.older_gross_value || 0)) > 0 ? (
                                  <span style={{ fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>
                                    {fmtINR((b.today_gross_value || 0) + (b.older_gross_value || 0))}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '11px', color: t.text4 }}>—</span>
                                )}
                                <div style={{ fontSize: '9px', color: t.text4, marginTop: '3px', letterSpacing: '.06em', textTransform: 'uppercase' }}>value</div>
                              </div>
                              {/* Affordance arrow */}
                              <div style={{ color: t.text4, fontSize: '14px' }}>›</div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Flat table view (legacy / power-user) ── */}
      {canSee('element.consignment-overview.table') && (
        <div style={{ ...card, overflow: 'hidden' }}>
          {loading && data.length === 0 ? (
            <div style={{ padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {search || activeRegion ? 'No branches match your filter' : 'No stock at any branch'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, cursor: 'pointer', color: sortKey === 'branch_name' ? t.gold : t.text4, paddingLeft: '7px', textAlign: 'left' }}
                        onClick={() => handleSort('branch_name')}>
                      Branch <SortIcon col="branch_name" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'total_bills' ? t.gold : t.text4 }}
                        onClick={() => handleSort('total_bills')}
                        title="Today's bills + pending bills currently at this branch">
                      Total Bills <SortIcon col="total_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'total_net_wt' ? t.gold : t.text4 }}
                        onClick={() => handleSort('total_net_wt')}>
                      Total Net Wt <SortIcon col="total_net_wt" />
                    </th>

                    {/* Sortable: Today */}
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_bills' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_bills')}>
                      Today's Bills <SortIcon col="today_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_net_wt' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_net_wt')}>
                      Today's Net Wt <SortIcon col="today_net_wt" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_gross_value' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_gross_value')}>
                      Today's Value <SortIcon col="today_gross_value" />
                    </th>

                    {/* Sortable: Pending — hidden on Bangalore tab because
                        every Bangalore bill reaches HO the same day, so a
                        'pending' bucket has no operational meaning. */}
                    {scopeTab === 'outside' && (<>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_bills' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_bills')}>
                      Pending Bills <SortIcon col="older_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_net_wt' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_net_wt')}>
                      Pending Net Wt <SortIcon col="older_net_wt" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_gross_value' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_gross_value')}>
                      Pending Value <SortIcon col="older_gross_value" />
                    </th>

                    {/* Sortable: Age */}
                    <th style={{ ...thBase, textAlign: 'center', cursor: 'pointer', color: sortKey === 'oldest_age' ? t.red : t.text4 }}
                        onClick={() => handleSort('oldest_age')}>
                      Oldest Bill <SortIcon col="oldest_age" />
                    </th>

                    {/* Last Moved */}
                    <th style={{ ...thBase, textAlign: 'center', cursor: 'pointer', color: sortKey === 'last_moved_days_ago' ? t.purple : t.text4 }}
                        onClick={() => handleSort('last_moved_days_ago')}>
                      Last Moved <SortIcon col="last_moved_days_ago" />
                    </th>
                    </>)}

                    {/* Move — explicit action button (also doubles as the
                        pickup-time tooltip target so ops still see the schedule). */}
                    <th style={{ ...thBase, textAlign: 'center' }}>Move</th>
                  </tr>

                  {/* Totals row pinned to the top inside <thead> — the whole
                      thead is sticky, so this stays beneath the column titles
                      as the user scrolls. Single source of truth — no <tfoot>
                      duplicate at the bottom. */}
                  <tr style={{ background: `${t.gold}14`, borderTop: `1px solid ${t.border}`, borderBottom: `2px solid ${t.gold}40` }}>
                    <td style={{ padding: '8px 8px 8px 7px', fontSize: '10px', color: t.text2, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: `${t.gold}14`, whiteSpace: 'nowrap' }}>
                      Σ Totals · {filtered.length}
                    </td>
                    {/* Total Bills */}
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {(grandToday + grandOlder) || '—'}
                    </td>
                    {/* Total Net Wt */}
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '12px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {fmt(grandTodayWt + grandOlderWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    {/* Today's Bills */}
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandToday || '—'}
                    </td>
                    {/* Today's Net Wt */}
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '12px', color: t.blue, fontFamily: 'monospace', fontWeight: 600, background: `${t.gold}14` }}>
                      {fmt(grandTodayWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '11px', color: t.blue, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandTodayVal ? fmtINR(grandTodayVal) : '—'}
                    </td>
                    {scopeTab === 'outside' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '13px', color: t.orange, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandOlder || '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '12px', color: t.orange, fontFamily: 'monospace', fontWeight: 600, background: `${t.gold}14` }}>
                      {fmt(grandOlderWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '11px', color: t.orange, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandOlderVal ? fmtINR(grandOlderVal) : '—'}
                    </td>
                    <td colSpan={3} style={{ padding: '8px 8px', background: `${t.gold}14` }} />
                    </>)}
                    {scopeTab === 'bangalore' && (
                      <td style={{ padding: '8px 8px', background: `${t.gold}14` }} />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => {
                    const rColor  = REGION_COLORS[b.region] || t.text3
                    const hasToday  = (b.today_bills  || 0) > 0
                    const hasPending = (b.older_bills || 0) > 0
                    // Urgency tier from the oldest pending bill: red for >7d
                    // (overdue), orange for 4–7d (watch), nothing otherwise.
                    // Surfaces branches that need attention without forcing
                    // the user to read the Oldest column.
                    const ageDays = b.oldest_age_days || 0
                    const urgentTier = ageDays > 7 ? 'overdue' : ageDays > 3 ? 'watch' : null
                    const urgentBg   = urgentTier === 'overdue' ? `${t.red}06`
                                     : urgentTier === 'watch'   ? `${t.orange}06`
                                     : 'transparent'
                    // Single stripe at the row's left edge — region colour by
                    // default, urgency colour when the row needs attention.
                    // Removes the old inline 3px inner stripe so we don't get
                    // a double-line + dead gutter before the branch name.
                    const stripeColor = urgentTier === 'overdue' ? t.red
                                      : urgentTier === 'watch'   ? t.orange
                                      : rColor

                    const glowColor = urgentTier === 'overdue' ? t.red
                                    : urgentTier === 'watch'   ? t.orange
                                    : t.gold
                    return (
                      <tr key={b.branch_name} className="cstock-flat-row" title={`Click to create a consignment from ${b.branch_name}`} style={{ borderBottom: `1px solid ${t.border}20`, background: urgentBg, cursor: 'pointer', ['--cstock-glow']: glowColor, ['--cstock-stripe']: stripeColor }} onClick={() => { setConsignmentDeepLink({ branch: b.branch_name, region: b.region }); setActiveNav('consignment-data') }} onMouseEnter={e => { if (!e.currentTarget.dataset.prefetched) { e.currentTarget.dataset.prefetched = '1'; const enc = encodeURIComponent(b.branch_name); prefetch(`/api/consignments?action=stock_in_branch&branch=${enc}`); prefetch(`/api/consignments?action=transfer_history&branch=${enc}`) } }}>
                        <td className="cstock-branch-cell">
                          <div className="cstock-branch-name" style={{ color: t.text1 }}>{b.branch_name}</div>
                          <div className="cstock-branch-region" style={{ color: rColor }}>{b.region}</div>
                        </td>

                        {/* Total Bills */}
                        {(() => {
                          const totalBills = (b.today_bills || 0) + (b.older_bills || 0)
                          return (
                            <td style={{ padding: tdPad, textAlign: 'right' }}>
                              {totalBills
                                ? <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{totalBills}</span>
                                : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                            </td>
                          )
                        })()}

                        {/* Total Net Wt */}
                        {(() => {
                          const total = (b.today_net_wt || 0) + (b.older_net_wt || 0)
                          return (
                            <td style={{ padding: tdPad, textAlign: 'right' }}>
                              <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>
                                {fmt(total, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                              </span>
                            </td>
                          )
                        })()}

                        {/* Today's Bills */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 600 }}>{b.today_bills}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Today's Net Wt */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace' }}>{fmt(b.today_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Today's Value */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '12px', color: t.blue, fontFamily: 'monospace' }}>{fmtINR(b.today_gross_value)}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {scopeTab === 'outside' && (<>
                        {/* Pending Bills */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '14px', color: t.orange, fontFamily: 'monospace', fontWeight: 700 }}>{b.older_bills}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Pending Net Wt */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '13px', color: t.orange, fontFamily: 'monospace' }}>{fmt(b.older_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Pending Value */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '12px', color: t.orange, fontFamily: 'monospace' }}>{fmtINR(b.older_gross_value)}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Oldest Bill */}
                        <td style={{ padding: tdPad, textAlign: 'center' }}>
                          <AgeBadge days={b.oldest_age_days} t={t} />
                          {b.oldest_date && (
                            <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>{fmtDate(b.oldest_date)}</div>
                          )}
                        </td>

                        {/* Last Moved */}
                        <td style={{ padding: tdPad, textAlign: 'center' }}>
                          {b.last_moved_days_ago != null
                            ? <span style={{ fontSize: '11px', color: t.purple, background: `${t.purple}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{b.last_moved_days_ago}d ago</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>never</span>}
                        </td>
                        </>)}

                        {/* Move — explicit affordance for the deep-link nav.
                            Row click still works; this button restores the
                            visible CTA the ops team relied on. The pickup
                            time (was the previous column's data) now lives
                            in the tooltip so it isn't lost. */}
                        <td style={{ padding: tdPad, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button
                            title={b.pickup_time ? `Pickup at ${b.pickup_time}` : 'No pickup time set'}
                            onClick={() => {
                              setConsignmentDeepLink({ branch: b.branch_name, region: b.region })
                              setActiveNav('consignment-data')
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}30`; e.currentTarget.style.borderColor = t.gold }}
                            onMouseLeave={e => { e.currentTarget.style.background = `${t.gold}18`; e.currentTarget.style.borderColor = `${t.gold}50` }}
                            style={{ background: `${t.gold}18`, border: `1px solid ${t.gold}50`, borderRadius: '7px', padding: '5px 12px', fontSize: '11px', color: t.gold, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', transition: 'all .15s' }}>
                            Move →
                          </button>
                        </td>

                      </tr>
                    )
                  })}
                </tbody>
                {/* No <tfoot> — totals are pinned to the top of the table
                    inside <thead>, so a duplicate at the bottom would be
                    redundant. */}
              </table>
            </div>
          )}
        </div>
      )}

      {/* Footer note — describes the Pending column, so only meaningful on
          the Outside tab where the Pending columns render. */}
      {scopeTab === 'outside' && (
        <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
          Pending = <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>stock_status = at_branch</code> before today · Age alert: &gt;3d orange, &gt;7d red
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { to{transform:rotate(360deg)} }
        /* Flat-table row hover glow.
           No position:relative on tr (it desyncs thead/tbody columns in
           Chromium under border-collapse:collapse). Hover is box-shadow only. */
        .cstock-flat-row { transition: background .15s ease, box-shadow .25s ease; }
        .cstock-flat-row:hover {
          background: color-mix(in srgb, var(--cstock-glow) 6%, transparent) !important;
          box-shadow:
            inset 3px 0 0 var(--cstock-glow),
            0 6px 18px color-mix(in srgb, var(--cstock-glow) 18%, transparent);
        }
        /* Branch cell — stripe via inset shadow at the cell's true left edge.
           Padding is 7px on the left so text sits 4px after the 3px stripe. */
        .cstock-branch-cell {
          padding: 10px 8px 10px 7px;
          box-shadow: inset 3px 0 0 var(--cstock-stripe);
          vertical-align: middle;
        }
        .cstock-branch-name { font-size: 13px; font-weight: 600; white-space: nowrap; }
        .cstock-branch-region { font-size: 10px; margin-top: 1px; }
        @keyframes cstockShimmer {
          0%   { background-position: -120% 0 }
          100% { background-position: 220% 0 }
        }
        @keyframes cstockCellPulse {
          0%   { box-shadow: 0 0 0 0 currentColor; opacity:.85 }
          50%  { box-shadow: 0 0 0 6px transparent; opacity:1 }
          100% { box-shadow: 0 0 0 0 transparent;   opacity:.85 }
        }
        @keyframes cstockGlow {
          0%,100% { box-shadow: 0 0 0 1px transparent }
          50%     { box-shadow: 0 0 0 2px rgba(201,168,76,.35) }
        }
        .cstock-row {
          position: relative;
          overflow: hidden;
        }
        .cstock-row::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,.04) 50%, transparent 65%);
          background-size: 200% 100%;
          opacity: 0; pointer-events: none;
          transition: opacity .15s;
        }
        .cstock-row:hover::before {
          opacity: 1;
          animation: cstockShimmer 1.2s ease-out 1;
        }
        .cstock-row:hover { background: rgba(201,168,76,.04) !important; }
        .cstock-row-fresh { animation: cstockGlow 2.4s ease-in-out 2; }
        .cstock-cell-pulse { animation: cstockCellPulse 1.6s ease-in-out 3; }
      `}</style>
    </div>
  )
}
