'use client'

// Shared data layer for the Jarvis footfall card + dashboard section.

import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istLastWeekRange } from '../../lib/dateIst'

export const JARVIS_REFRESH_MS = 5 * 60 * 1000

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

// Only completed days are shown — today's camera counts are partial (Jarvis
// publishes in batches and removes staff after close), so every range ends
// yesterday at the latest.
export const jarvisYesterday = () => addDays(istToday(), -1)

export const JARVIS_PERIODS = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last week' },
  { key: '2weeks', label: 'Last 2 weeks' },
  { key: 'month', label: 'This month' },
  { key: 'prev', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
]

// Returns { from, to } (both ≤ yesterday), or { from: null, to: null, note }
// when the period has no completed day yet.
export function jarvisRange(key, custom) {
  const today = istToday()
  const yday = addDays(today, -1)
  if (key === 'week') return istLastWeekRange()
  if (key === '2weeks') return { from: addDays(yday, -13), to: yday }
  if (key === 'month') {
    const from = `${today.slice(0, 7)}-01`
    return from > yday ? { from: null, to: null, note: 'No completed day this month yet' } : { from, to: yday }
  }
  if (key === 'prev') {
    const [y, m] = today.split('-').map(Number)
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
    const mm = String(pm).padStart(2, '0')
    return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, '0')}` }
  }
  if (key === 'custom') {
    const to = custom?.to && custom.to < yday ? custom.to : yday
    const from = custom?.from && custom.from <= to ? custom.from : to
    return { from, to }
  }
  // Branches are closed on Sundays, so "Yesterday" on a Monday means Saturday.
  if (new Date(`${yday}T00:00:00Z`).getUTCDay() === 0) {
    const sat = addDays(yday, -1)
    return { from: sat, to: sat, hint: 'Saturday — yesterday was Sunday' }
  }
  return { from: yday, to: yday }
}

export function useJarvisFootfall(from, to) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const load = useCallback(async (silent = false) => {
    if (!from || !to) return
    if (!silent) setState(s => ({ ...s, loading: true }))
    try {
      const res = await authedFetch(`/api/jarvis-footfall?from=${from}&to=${to}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) throw new Error(json?.error || `Server error (HTTP ${res.status})`)
      setState({ loading: false, data: json, error: null })
    } catch (err) {
      setState(s => ({ loading: false, data: s.data, error: err.message }))
    }
  }, [from, to])
  useEffect(() => {
    if (!from || !to) return
    load()
    const id = setInterval(() => { if (!document.hidden) load(true) }, JARVIS_REFRESH_MS)
    return () => clearInterval(id)
  }, [load, from, to])
  return { ...state, reload: () => load(true) }
}

const walkinsOf = (r) => r.walkins_old + r.walkins_new + r.rewalkins

// Footfall is only compared with walk-ins on branch-days that have camera
// data, so branches without a Jarvis camera never show up as "not punched".
export function summarizeFootfall(rows, { region = null, branch = null } = {}) {
  const sel = (rows || []).filter(r => (!region || r.region === region) && (!branch || r.branch === branch))
  const cam = sel.filter(r => r.footfall != null)

  const t = { footfall: 0, walkins: 0, fresh: 0, rewalkins: 0, male: 0, female: 0, unclassified: 0, genderKnown: false, pendingStaff: 0 }
  const byBranch = new Map()
  const byDay = new Map()
  for (const r of cam) {
    const w = walkinsOf(r)
    t.footfall += r.footfall
    t.walkins += w
    t.fresh += r.walkins_old + r.walkins_new
    t.rewalkins += r.rewalkins
    if (r.male != null || r.female != null) {
      t.genderKnown = true
      t.male += r.male || 0
      t.female += r.female || 0
      t.unclassified += Math.max(0, r.footfall - (r.male || 0) - (r.female || 0))
    }
    const pending = !!r.staff_status && r.staff_status !== 'SUCCESS'
    if (pending) t.pendingStaff++

    let b = byBranch.get(r.branch)
    if (!b) { b = { branch: r.branch, region: r.region, footfall: 0, walkins: 0, rewalkins: 0, male: 0, female: 0, pendingDays: 0, deadDays: 0, partialDays: 0, days: 0 }; byBranch.set(r.branch, b) }
    b.footfall += r.footfall; b.walkins += w; b.rewalkins += r.rewalkins
    b.male += r.male || 0; b.female += r.female || 0; b.days++
    if (pending) b.pendingDays++
    if (r.footfall === 0 && w > 0) b.deadDays++
    if (r.data_status === 'PARTIAL') b.partialDays++

    let d = byDay.get(r.date)
    if (!d) { d = { date: r.date, footfall: 0, walkins: 0 }; byDay.set(r.date, d) }
    d.footfall += r.footfall; d.walkins += w
  }

  // Walk-ins that can't be compared: branch has no Jarvis camera at all, or its
  // camera sent no data (NO_DATA) for every day in the range.
  const noCamera = new Map()
  const camBranches = new Set(cam.map(r => r.branch))
  let allWalkins = 0
  for (const r of sel) {
    const w = walkinsOf(r)
    allWalkins += w
    if (camBranches.has(r.branch)) continue
    const n = noCamera.get(r.branch) || { branch: r.branch, walkins: 0, offline: false }
    n.walkins += w
    if (r.store_code) n.offline = true
    noCamera.set(r.branch, n)
  }

  const branches = [...byBranch.values()].map(b => ({
    ...b,
    punch: b.footfall > 0 ? b.walkins / b.footfall : null,
    gap: b.footfall - b.walkins,
  }))

  return {
    ...t,
    punch: t.footfall > 0 ? t.walkins / t.footfall : null,
    gap: t.footfall - t.walkins,
    cameras: camBranches.size,
    reporting: branches.filter(b => b.footfall > 0).length,
    allWalkins,
    branches,
    days: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    noCamera: [...noCamera.values()].filter(n => n.walkins > 0 && !n.offline).sort((a, b) => b.walkins - a.walkins),
    offline: [...noCamera.values()].filter(n => n.offline).sort((a, b) => b.walkins - a.walkins),
    regions: [...new Set(sel.map(r => r.region).filter(Boolean))].sort(),
  }
}

export const punchColor = (t, p) => (p == null ? t.text3 : p >= 0.8 ? t.green : p >= 0.5 ? (t.orange || t.gold) : t.red)
export const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))
export const fmtPctR = (p) => (p == null ? '—' : `${(p * 100).toFixed(p >= 1 ? 0 : 1)}%`)
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null)
