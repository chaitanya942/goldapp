'use client'

// components/admin/HeatmapViewer.js
//
// In-app heatmap viewer for goldapp. Two views:
//   1. Overall — aggregated across all users on a chosen page.
//   2. By User — pick a specific user (by email), see only their heatmap +
//      their session/device timeline.
//
// Reads from /api/heatmap/aggregate (binned grid + top elements + device split
// + hourly distribution) and /api/heatmap/users (per-user activity for the
// picker / leaderboard). Both endpoints are admin-only.
//
// Rendering: canvas with smoothed radial blobs. Coords are stored as percentages
// of the viewport at capture time, so mixing desktop + mobile clicks on one
// canvas remains spatially accurate per device class.
//
// Project is hardcoded to 'goldapp' — for other tools we lift this code out and
// adapt the endpoint URLs there.

import { useEffect, useMemo, useRef, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const PROJECT = 'goldapp'

const DEVICE_OPTIONS = [
  { value: '',             label: 'All devices' },
  { value: 'desktop-wide', label: 'Desktop (wide)' },
  { value: 'desktop',      label: 'Desktop' },
  { value: 'tablet',       label: 'Tablet' },
  { value: 'mobile-large', label: 'Mobile (large)' },
  { value: 'mobile',       label: 'Mobile' },
]
const EVENT_TYPES = [
  { value: 'click',    label: 'Clicks',    icon: '◉' },
  { value: 'scroll',   label: 'Scroll',    icon: '↕' },
  { value: 'pageview', label: 'Pageviews', icon: '◫' },
]
const QUICK_RANGES = [
  { label: '24h', days: 1 },
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

function isoDaysAgo(d) {
  const x = new Date(); x.setDate(x.getDate() - d)
  return x.toISOString()
}

function relTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1)    return 'just now'
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function fmt(n) {
  if (n == null) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return n.toLocaleString('en-IN')
}

export default function HeatmapViewer() {
  const { theme } = useApp()
  const t = THEMES[theme]

  // View mode
  const [mode, setMode] = useState('overall')   // 'overall' | 'user'

  // Filters
  const [pages,      setPages]      = useState([])
  const [page,       setPage]       = useState(null)
  const [device,     setDevice]     = useState('')
  const [eventType,  setEventType]  = useState('click')
  const [days,       setDays]       = useState(7)
  const [intensity,  setIntensity]  = useState(1)

  // Data
  const [users,      setUsers]      = useState([])      // for picker + overall leaderboard
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)

  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  const fromIso = useMemo(() => isoDaysAgo(days), [days])

  // ── Fetch the page list whenever date range changes ─────────────────────
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const r = await authedFetch(`/api/heatmap/pages?project=${PROJECT}`)
        const j = await r.json()
        if (cancel) return
        if (!r.ok) { setError(j.error || 'Failed to load pages'); return }
        setPages(j.pages || [])
        if (!page && j.pages?.length) setPage(j.pages[0].page_path)
      } catch (e) { if (!cancel) setError(e.message) }
    })()
    return () => { cancel = true }
  }, [])

  // ── Fetch users (for overall leaderboard + by-user picker) ──────────────
  useEffect(() => {
    let cancel = false
    ;(async () => {
      setUsersLoading(true)
      try {
        const r = await authedFetch(`/api/heatmap/users?project=${PROJECT}&from=${encodeURIComponent(fromIso)}`)
        const j = await r.json()
        if (cancel) return
        if (!r.ok) { setError(j.error || 'Failed to load users'); return }
        setUsers(j.users || [])
        // If we're in user mode and the selected user is no longer present,
        // reset selection so we don't show stale data.
        if (mode === 'user' && selectedUserId && !(j.users || []).some(u => u.user_id === selectedUserId)) {
          setSelectedUserId(null)
        }
      } catch (e) { if (!cancel) setError(e.message) }
      if (!cancel) setUsersLoading(false)
    })()
    return () => { cancel = true }
  }, [days])

  // ── Fetch aggregate (the heatmap itself) ────────────────────────────────
  useEffect(() => {
    if (!page) return
    if (mode === 'user' && !selectedUserId) { setData(null); return }
    let cancel = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const params = new URLSearchParams({
          project: PROJECT, page, event_type: eventType,
          from: fromIso,
        })
        if (device) params.set('device', device)
        if (mode === 'user' && selectedUserId) params.set('user_id', selectedUserId)
        const r = await authedFetch(`/api/heatmap/aggregate?${params}`)
        const j = await r.json()
        if (cancel) return
        if (!r.ok) { setError(j.error || 'Aggregate failed'); return }
        setData(j)
      } catch (e) { if (!cancel) setError(e.message) }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [mode, selectedUserId, page, device, eventType, fromIso])

  // ── Render heatmap on canvas ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const w = wrap.clientWidth
    const h = Math.max(420, w * 0.56)
    const dpr = window.devicePixelRatio || 1
    canvas.width  = w * dpr
    canvas.height = h * dpr
    canvas.style.width  = w + 'px'
    canvas.style.height = h + 'px'
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!data?.bins?.length) return

    const max = data.bins.reduce((m, b) => Math.max(m, b.count), 1)

    // Pass 1: density blobs with additive blending (warm gradient).
    ctx.globalCompositeOperation = 'lighter'
    const blobRadius = Math.min(w, h) * 0.07
    for (const b of data.bins) {
      const x = (b.x_bin / 100) * w
      const y = (b.y_bin / 100) * h
      const norm = Math.pow(b.count / max, 0.7) * intensity   // gamma-corrected
      const grad = ctx.createRadialGradient(x, y, 0, x, y, blobRadius)
      grad.addColorStop(0,    `rgba(255, 60, 60, ${Math.min(0.9, norm)})`)
      grad.addColorStop(0.35, `rgba(255, 160, 30, ${Math.min(0.55, norm * 0.65)})`)
      grad.addColorStop(0.7,  `rgba(255, 230, 60, ${Math.min(0.25, norm * 0.35)})`)
      grad.addColorStop(1,    `rgba(255, 255, 0, 0)`)
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(x, y, blobRadius, 0, 2 * Math.PI); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'

    // Pass 2: small precise dots so individual clicks stay readable.
    for (const b of data.bins) {
      const x = (b.x_bin / 100) * w
      const y = (b.y_bin / 100) * h
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.9, 0.3 + (b.count / max) * 0.6)})`
      ctx.beginPath(); ctx.arc(x, y, 2, 0, 2 * Math.PI); ctx.fill()
    }
  }, [data, intensity])

  // Filtered users for the picker (substring match on email + role)
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.role  || '').toLowerCase().includes(q),
    )
  }, [users, userSearch])

  const selectedUser = useMemo(
    () => users.find(u => u.user_id === selectedUserId) || null,
    [users, selectedUserId],
  )

  const totalEvents   = data?.total || 0
  const totalSessions = data?.sessions || 0
  const totalUsers    = data?.unique_users || 0

  // ── styles ──────────────────────────────────────────────────────────────
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px' }
  const inp     = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '.74rem', outline: 'none' }
  const pillBtn = (active) => ({ padding: '7px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: active ? t.gold : 'transparent', color: active ? '#1a0a00' : t.text3, fontSize: '.7rem', fontWeight: active ? 700 : 400, transition: 'all .15s' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── View mode tabs ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', padding: '5px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '11px', alignSelf: 'flex-start' }}>
        {[
          { key: 'overall', label: 'Overall', sub: 'All users combined' },
          { key: 'user',    label: 'By user', sub: 'Single-user heatmap' },
        ].map(m => {
          const active = mode === m.key
          return (
            <button key={m.key} onClick={() => setMode(m.key)}
              style={{
                padding: '9px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: active ? `linear-gradient(135deg, ${t.gold} 0%, ${t.orange} 100%)` : 'transparent',
                color: active ? '#0a0a0a' : t.text2,
                fontSize: '12px', fontWeight: active ? 700 : 500, letterSpacing: '.04em',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
              <span>{m.label}</span>
              <span style={{ fontSize: '10px', opacity: .65, fontWeight: 400 }}>{m.sub}</span>
            </button>
          )
        })}
      </div>

      {/* ── User picker (only in 'user' mode) ──────────────────────────── */}
      {mode === 'user' && (
        <div style={{ ...card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '4px' }}>Pick user</div>
              <div style={{ fontSize: '12px', color: t.text2 }}>
                {selectedUser
                  ? <><span style={{ color: t.gold, fontWeight: 600 }}>{selectedUser.email}</span> · {fmt(selectedUser.event_count)} events · {selectedUser.sessions} session{selectedUser.sessions === 1 ? '' : 's'} · last {relTime(selectedUser.last_seen)}</>
                  : 'Select a user from the list below to view their personal heatmap.'}
              </div>
            </div>
            <input
              value={userSearch} onChange={e => setUserSearch(e.target.value)}
              placeholder="Search by email or role"
              style={{ ...inp, minWidth: '240px' }} />
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '8px',
            maxHeight: filteredUsers.length > 6 ? '280px' : 'auto',
            overflowY: filteredUsers.length > 6 ? 'auto' : 'visible',
            paddingRight: '4px',
          }}>
            {usersLoading && <div style={{ color: t.text4, fontSize: '11px', padding: '12px' }}>Loading users…</div>}
            {!usersLoading && filteredUsers.length === 0 && (
              <div style={{ color: t.text4, fontSize: '11px', padding: '12px' }}>
                {userSearch ? `No users match "${userSearch}".` : 'No users with events yet in this range.'}
              </div>
            )}
            {filteredUsers.map(u => {
              const active = selectedUserId === u.user_id
              const initial = (u.email || '?').slice(0, 1).toUpperCase()
              return (
                <button key={u.user_id || 'anon'}
                  onClick={() => u.user_id && setSelectedUserId(u.user_id)}
                  disabled={!u.user_id}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: active ? `${t.gold}15` : t.card2 || t.card,
                    border: `1px solid ${active ? t.gold : t.border}`,
                    borderRadius: '9px',
                    cursor: u.user_id ? 'pointer' : 'not-allowed',
                    opacity: u.user_id ? 1 : .55,
                    display: 'flex', alignItems: 'center', gap: '10px',
                    transition: 'all .15s',
                  }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: `linear-gradient(135deg, ${t.gold} 0%, ${t.orange} 100%)`,
                    color: '#1a0a00', fontWeight: 700, fontSize: '13px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>{initial}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                      {u.role || '—'} · {fmt(u.event_count)} ev · {u.sessions} sess
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Filter bar ────────────────────────────────────────────────── */}
      <div style={{ ...card, padding: '14px 18px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={page || ''} onChange={e => setPage(e.target.value)} style={{ ...inp, maxWidth: '380px', flex: 1, minWidth: '220px' }}>
          {pages.length === 0 && <option value="">No pages tracked yet</option>}
          {pages.map(p => (
            <option key={p.page_path} value={p.page_path}>
              {p.page_path}{p.page_title ? ` · ${p.page_title}` : ''} ({fmt(p.event_count)})
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: '4px', padding: '3px', background: t.card2 || t.card, borderRadius: '9px', border: `1px solid ${t.border}` }}>
          {EVENT_TYPES.map(o => (
            <button key={o.value} onClick={() => setEventType(o.value)} style={pillBtn(eventType === o.value)} title={o.label}>
              <span style={{ marginRight: 4 }}>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>

        <select value={device} onChange={e => setDevice(e.target.value)} style={inp}>
          {DEVICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div style={{ display: 'flex', gap: '4px', padding: '3px', background: t.card2 || t.card, borderRadius: '9px', border: `1px solid ${t.border}` }}>
          {QUICK_RANGES.map(r => (
            <button key={r.label} onClick={() => setDays(r.days)} style={pillBtn(days === r.days)}>{r.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Intensity</span>
          <input type="range" min="0.3" max="3" step="0.1" value={intensity} onChange={e => setIntensity(Number(e.target.value))}
            style={{ width: '110px', accentColor: t.gold }} />
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        <Kpi t={t} label="Events"     value={fmt(totalEvents)} accent={t.gold} icon="◉" />
        <Kpi t={t} label="Sessions"   value={fmt(totalSessions)} accent={t.blue} icon="◫" />
        <Kpi t={t} label={mode === 'user' ? 'Filtered to' : 'Unique users'}
             value={mode === 'user' ? (selectedUser?.email || '—').split('@')[0] : fmt(totalUsers)}
             accent={mode === 'user' ? t.purple : t.green} icon={mode === 'user' ? '◑' : '◐'} small={mode === 'user'} />
        <Kpi t={t} label="Hot zones"  value={data?.bins?.length || 0} accent={t.orange} icon="◈" />
        <Kpi t={t} label="Range"      value={`${days} day${days === 1 ? '' : 's'}`} accent={t.text2} icon="◇" />
      </div>

      {/* ── Heatmap canvas ───────────────────────────────────────────── */}
      <div ref={wrapRef} style={{ ...card, padding: 0, overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg, #f8f3e3 0%, #fcf6e3 100%)' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', background: t.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: t.text3 }}>
            <span style={{ letterSpacing: '.1em', textTransform: 'uppercase', fontSize: '10px' }}>
              {mode === 'overall' ? 'Overall heatmap' : `${selectedUser?.email || 'User'} heatmap`}
            </span>
            <span style={{ color: t.text4 }}>·</span>
            <span style={{ color: t.text2, fontFamily: 'monospace', fontSize: '10px' }}>{page || '—'}</span>
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: t.text4 }}>
            <span>cool</span>
            <div style={{ width: 80, height: 6, borderRadius: '3px', background: 'linear-gradient(90deg, rgba(255,255,0,.15) 0%, rgba(255,160,30,.6) 50%, rgba(255,60,60,.95) 100%)' }} />
            <span>hot</span>
          </div>
        </div>

        {error && (
          <div style={{ background: `${t.red}15`, padding: '12px 16px', fontSize: '11px', color: t.red }}>{error}</div>
        )}

        {/* Empty / not-yet-picked states */}
        {mode === 'user' && !selectedUserId && (
          <EmptyState t={t} icon="◐" title="Pick a user" body="Choose a user from the list above to view their personal click and scroll patterns." />
        )}
        {mode === 'overall' && !loading && data && data.bins.length === 0 && (
          <EmptyState t={t} icon="◇" title="No events yet" body={`No ${eventType} events on this page in the selected range. Try a wider date range or pick a different page.`} />
        )}
        {mode === 'user' && selectedUserId && !loading && data && data.bins.length === 0 && (
          <EmptyState t={t} icon="◇" title="No events for this user" body={`This user hasn't generated any ${eventType} events on this page in the selected range.`} />
        )}

        <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />

        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.05)', backdropFilter: 'blur(2px)' }}>
            <Spinner color={t.gold} />
          </div>
        )}

        <div style={{ position: 'absolute', top: '54px', left: '10px', fontSize: '9px', color: 'rgba(0,0,0,.4)', fontFamily: 'monospace' }}>0,0</div>
        <div style={{ position: 'absolute', bottom: '10px', right: '10px', fontSize: '9px', color: 'rgba(0,0,0,.4)', fontFamily: 'monospace' }}>100,100</div>
      </div>

      {/* ── Charts row: hourly distribution + device breakdown ────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '14px' }}>
        <HourlyChart t={t} hourly={data?.hourly} />
        <DeviceChart t={t} breakdown={data?.device_breakdown} />
      </div>

      {/* ── Two-up: top elements + (overall mode only: user leaderboard) ─ */}
      <div style={{ display: 'grid', gridTemplateColumns: mode === 'overall' ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: '14px' }}>
        <TopElements t={t} elements={data?.top_elements} />
        {mode === 'overall' && <UserLeaderboard t={t} users={users} loading={usersLoading} onPick={(id) => { setSelectedUserId(id); setMode('user') }} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ t, label, value, accent, icon, small }) {
  return (
    <div style={{
      background: t.card,
      border: `1px solid ${t.border}`,
      borderRadius: '12px',
      padding: '14px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${accent} 0%, transparent 100%)` }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '12px', color: accent, opacity: .6 }}>{icon}</div>
      </div>
      <div style={{ fontSize: small ? '13px' : '20px', color: t.text1, fontFamily: 'monospace', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )
}

function HourlyChart({ t, hourly }) {
  const data = hourly || new Array(24).fill(0)
  const max = Math.max(1, ...data)
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Activity by hour</div>
        <div style={{ fontSize: '10px', color: t.text4 }}>local time</div>
      </div>
      <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '90px' }}>
        {data.map((v, h) => {
          const pct = (v / max) * 100
          return (
            <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }} title={`${h}:00 — ${v} events`}>
              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <div style={{
                  width: '100%',
                  height: `${Math.max(2, pct)}%`,
                  background: v > 0 ? `linear-gradient(180deg, ${t.gold} 0%, ${t.orange} 100%)` : t.border,
                  borderRadius: '3px 3px 0 0',
                  opacity: v > 0 ? 1 : .4,
                  transition: 'height .3s',
                }} />
              </div>
              <div style={{ fontSize: '8px', color: t.text4, fontFamily: 'monospace' }}>{h % 6 === 0 ? `${h}` : ''}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const DEVICE_COLORS = {
  'desktop-wide': '#3a8fbf',
  'desktop':      '#3aaa6a',
  'tablet':       '#c9a84c',
  'mobile-large': '#c9981f',
  'mobile':       '#e05555',
}

function DeviceChart({ t, breakdown }) {
  const data = breakdown || []
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '12px' }}>Device split</div>
      {total === 0 ? (
        <div style={{ fontSize: '11px', color: t.text4, padding: '12px 0' }}>No data.</div>
      ) : (
        <>
          {/* Stacked bar */}
          <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px', background: t.border }}>
            {data.map(d => (
              <div key={d.device} title={`${d.device} — ${d.count}`} style={{
                width: `${(d.count / total) * 100}%`,
                background: DEVICE_COLORS[d.device] || t.text3,
              }} />
            ))}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.map(d => (
              <div key={d.device} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: DEVICE_COLORS[d.device] || t.text3 }} />
                  <span style={{ color: t.text2 }}>{d.device}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ color: t.text1, fontFamily: 'monospace', fontWeight: 600 }}>{fmt(d.count)}</span>
                  <span style={{ color: t.text4, fontSize: '10px' }}>{((d.count / total) * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TopElements({ t, elements }) {
  const list = elements || []
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Top clicked elements</div>
        <div style={{ fontSize: '10px', color: t.text4 }}>{list.length} unique</div>
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: '11px', color: t.text4, padding: '12px 0' }}>No interactive elements identified.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.slice(0, 12).map((el, i) => {
            const max = list[0].count
            const pct = (el.count / max) * 100
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '10px', color: t.text4, width: '20px', textAlign: 'right', fontFamily: 'monospace' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: t.text1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.element}</span>
                    <span style={{ fontSize: '11px', color: t.gold, fontFamily: 'monospace', flexShrink: 0, fontWeight: 600 }}>{el.count}</span>
                  </div>
                  <div style={{ height: '4px', background: `${t.gold}15`, borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${t.gold} 0%, ${t.orange} 100%)`, transition: 'width .4s' }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function UserLeaderboard({ t, users, loading, onPick }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Most active users</div>
        <div style={{ fontSize: '10px', color: t.text4 }}>click to view individual</div>
      </div>
      {loading && <div style={{ fontSize: '11px', color: t.text4, padding: '12px 0' }}>Loading…</div>}
      {!loading && users.length === 0 && <div style={{ fontSize: '11px', color: t.text4, padding: '12px 0' }}>No users with events in this range.</div>}
      {users.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {users.slice(0, 10).map((u, i) => {
            const max = users[0].event_count
            const pct = (u.event_count / max) * 100
            return (
              <button key={u.user_id || `anon-${i}`}
                onClick={() => u.user_id && onPick(u.user_id)}
                disabled={!u.user_id}
                style={{
                  background: 'transparent', border: 'none', cursor: u.user_id ? 'pointer' : 'not-allowed',
                  padding: '6px 8px', borderRadius: '7px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  textAlign: 'left',
                  opacity: u.user_id ? 1 : .55,
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { if (u.user_id) e.currentTarget.style.background = `${t.gold}10` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <span style={{ fontSize: '10px', color: t.text4, width: '20px', textAlign: 'right', fontFamily: 'monospace' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                    <span style={{ fontSize: '11px', color: t.gold, fontFamily: 'monospace', flexShrink: 0, fontWeight: 600 }}>{fmt(u.event_count)}</span>
                  </div>
                  <div style={{ height: '4px', background: `${t.gold}15`, borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${t.gold} 0%, ${t.orange} 100%)` }} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyState({ t, icon, title, body }) {
  return (
    <div style={{ padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '32px', color: t.gold, opacity: .35, marginBottom: '10px' }}>{icon}</div>
      <div style={{ fontSize: '13px', color: t.text2, fontWeight: 500, marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: t.text4, maxWidth: '420px', margin: '0 auto', lineHeight: 1.6 }}>{body}</div>
    </div>
  )
}

function Spinner({ color }) {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="16" cy="16" r="12" fill="none" stroke={`${color}25`} strokeWidth="2.5" />
      <circle cx="16" cy="16" r="12" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="20 56" strokeLinecap="round" />
    </svg>
  )
}
