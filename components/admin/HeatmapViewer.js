'use client'

// components/admin/HeatmapViewer.js
//
// In-app heatmap viewer for goldapp. Two views:
//   1. Overall — aggregated across all users on a chosen page.
//   2. By User — pick a specific user (by email), see only their heatmap +
//      their session/device timeline.

import { useEffect, useMemo, useRef, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const PROJECT = 'goldapp'

const DEVICE_OPTIONS = [
  { value: '',             label: 'All devices',       icon: '◻' },
  { value: 'desktop-wide', label: 'Desktop (wide)',    icon: '▭' },
  { value: 'desktop',      label: 'Desktop',           icon: '▭' },
  { value: 'tablet',       label: 'Tablet',            icon: '▯' },
  { value: 'mobile-large', label: 'Mobile (large)',    icon: '▯' },
  { value: 'mobile',       label: 'Mobile',            icon: '▯' },
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

function pageLabel(path) {
  if (!path) return '—'
  const [base, hash] = path.split('#')
  return hash ? hash.replace(/-/g, ' ') : (base.replace(/^\//, '') || 'home')
}

export default function HeatmapViewer() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [mode, setMode] = useState('overall')
  const [pages,      setPages]      = useState([])
  const [page,       setPage]       = useState(null)
  const [device,     setDevice]     = useState('')
  const [eventType,  setEventType]  = useState('click')
  const [days,       setDays]       = useState(7)
  const [intensity,  setIntensity]  = useState(1)
  const [users,      setUsers]      = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [userListOpen, setUserListOpen] = useState(true)
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)

  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)
  const fromIso   = useMemo(() => isoDaysAgo(days), [days])

  // Pages list
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

  // Users list
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
        if (mode === 'user' && selectedUserId && !(j.users || []).some(u => u.user_id === selectedUserId)) {
          setSelectedUserId(null)
        }
      } catch (e) { if (!cancel) setError(e.message) }
      if (!cancel) setUsersLoading(false)
    })()
    return () => { cancel = true }
  }, [days])

  // Aggregate
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

  // Canvas — draws a synthetic page schematic (sidebar + topbar + content cards)
  // so the empty area always has structure, then layers heatmap blobs on top,
  // then labelled callouts at the centroids of the top-clicked elements.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const w = wrap.clientWidth
    const h = Math.max(440, w * 0.56)
    const dpr = window.devicePixelRatio || 1
    canvas.width  = w * dpr
    canvas.height = h * dpr
    canvas.style.width  = w + 'px'
    canvas.style.height = h + 'px'
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // ── 1. Page schematic ──────────────────────────────────────────────
    drawSchematic(ctx, w, h, theme)

    if (!data?.bins?.length) return

    // ── 2. Heatmap blobs ──────────────────────────────────────────────
    const max = data.bins.reduce((m, b) => Math.max(m, b.count), 1)
    ctx.globalCompositeOperation = 'lighter'
    const blobRadius = Math.min(w, h) * 0.075
    for (const b of data.bins) {
      const x = (b.x_bin / 100) * w
      const y = (b.y_bin / 100) * h
      const norm = Math.pow(b.count / max, 0.65) * intensity
      const grad = ctx.createRadialGradient(x, y, 0, x, y, blobRadius)
      grad.addColorStop(0,    `rgba(255, 50, 70, ${Math.min(0.9, norm)})`)
      grad.addColorStop(0.3,  `rgba(255, 140, 30, ${Math.min(0.6, norm * 0.7)})`)
      grad.addColorStop(0.65, `rgba(255, 230, 70, ${Math.min(0.3, norm * 0.4)})`)
      grad.addColorStop(1,    `rgba(255, 255, 0, 0)`)
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(x, y, blobRadius, 0, 2 * Math.PI); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    for (const b of data.bins) {
      const x = (b.x_bin / 100) * w
      const y = (b.y_bin / 100) * h
      const op = Math.min(1, 0.35 + (b.count / max) * 0.65)
      ctx.fillStyle = `rgba(255, 255, 255, ${op})`
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 2 * Math.PI); ctx.fill()
    }

    // ── 3. Labelled callouts on the top zones ─────────────────────────
    const zones = data?.top_zones || []
    if (zones.length) {
      const placed = []  // for collision-avoidance
      ctx.font = '600 11px ui-monospace, "SF Mono", Menlo, monospace'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i]
        const x = (z.x_pct / 100) * w
        const y = (z.y_pct / 100) * h
        const label = `${z.label}  ${z.count}`
        const tw = ctx.measureText(label).width
        const padX = 8, padY = 5
        const boxW = tw + padX * 2
        const boxH = 22
        // Try to place above the dot first; flip below if it would overflow top
        let bx = x + 12
        let by = y - boxH - 10
        if (by < 6) by = y + 12
        if (bx + boxW > w - 6) bx = w - boxW - 6
        // Crude collision avoidance — nudge down if overlap with prior box
        let attempts = 0
        while (placed.some(p => Math.abs(p.bx - bx) < boxW * 0.7 && Math.abs(p.by - by) < boxH * 1.4) && attempts < 6) {
          by += boxH + 4
          attempts++
        }
        placed.push({ bx, by })

        // Connector line
        ctx.strokeStyle = 'rgba(0,0,0,.35)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx + 6, by + boxH / 2); ctx.stroke()

        // Dot
        ctx.fillStyle = '#1a0a00'
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fill()
        ctx.fillStyle = i < 3 ? '#ffd84a' : '#fff'
        ctx.beginPath(); ctx.arc(x, y, 2.8, 0, 2 * Math.PI); ctx.fill()

        // Pill background
        ctx.fillStyle = 'rgba(20,16,8,.92)'
        roundRect(ctx, bx, by, boxW, boxH, 5)
        ctx.fill()
        // Rank chip
        ctx.fillStyle = i < 3 ? '#ffd84a' : '#9a8a6a'
        ctx.fillRect(bx, by, 3, boxH)
        // Text
        ctx.fillStyle = '#f0e6c8'
        ctx.fillText(z.label, bx + padX, by + boxH / 2)
        // Count badge (right side)
        const cw = ctx.measureText(String(z.count)).width
        ctx.fillStyle = '#ffd84a'
        ctx.fillText(String(z.count), bx + boxW - padX - cw, by + boxH / 2)
      }
    }
  }, [data, intensity, theme])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

      {/* ── Mode bar (overall / user) + range pills on the right ────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <div style={{
          display: 'flex', gap: 0,
          background: t.card, border: `1px solid ${t.border}`,
          borderRadius: '12px', padding: '4px',
        }}>
          {[
            { key: 'overall', label: 'Overall',  icon: '◐', sub: `${users.length} users` },
            { key: 'user',    label: 'By user',  icon: '◑', sub: selectedUser ? selectedUser.email.split('@')[0] : 'pick one' },
          ].map(m => {
            const active = mode === m.key
            return (
              <button key={m.key} onClick={() => setMode(m.key)}
                style={{
                  padding: '10px 18px', borderRadius: '9px', border: 'none', cursor: 'pointer',
                  background: active ? `linear-gradient(135deg, ${t.gold} 0%, ${t.orange} 100%)` : 'transparent',
                  color: active ? '#0a0a0a' : t.text2,
                  fontSize: '12px', fontWeight: active ? 700 : 500,
                  display: 'flex', alignItems: 'center', gap: '10px',
                  transition: 'all .15s',
                }}>
                <span style={{ fontSize: '14px', opacity: .85 }}>{m.icon}</span>
                <span>{m.label}</span>
                <span style={{ fontSize: '10px', opacity: active ? .65 : .55, fontWeight: 400 }}>· {m.sub}</span>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: '4px', padding: '4px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }}>
          {QUICK_RANGES.map(r => {
            const active = days === r.days
            return (
              <button key={r.label} onClick={() => setDays(r.days)}
                style={{
                  padding: '7px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                  background: active ? t.gold : 'transparent',
                  color: active ? '#1a0a00' : t.text3,
                  fontSize: '11px', fontWeight: active ? 700 : 500, fontFamily: 'monospace',
                  transition: 'all .15s',
                }}>{r.label}</button>
            )
          })}
        </div>
      </div>

      {/* ── User picker (collapsible) ──────────────────────────────── */}
      {mode === 'user' && (
        <div style={{
          background: t.card, border: `1px solid ${t.border}`,
          borderRadius: '14px', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap',
            background: theme === 'dark' ? `linear-gradient(180deg, ${t.gold}08 0%, transparent 100%)` : `linear-gradient(180deg, ${t.gold}10 0%, transparent 100%)`,
            borderBottom: userListOpen ? `1px solid ${t.border}` : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
              {selectedUser ? (
                <>
                  <Avatar t={t} email={selectedUser.email} size={42} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedUser.email}</div>
                    <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>
                      {selectedUser.role || '—'} · {fmt(selectedUser.event_count)} events · {selectedUser.sessions} session{selectedUser.sessions === 1 ? '' : 's'} · last seen {relTime(selectedUser.last_seen)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: t.card2, border: `1px dashed ${t.border2 || t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '18px' }}>?</div>
                  <div>
                    <div style={{ fontSize: '13px', color: t.text2, fontWeight: 500 }}>Pick a user</div>
                    <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>Choose someone from the list to load their personal heatmap.</div>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                value={userSearch} onChange={e => setUserSearch(e.target.value)}
                placeholder="🔎 Search email or role"
                style={{
                  background: t.card2, border: `1px solid ${t.border}`,
                  borderRadius: '8px', padding: '8px 12px',
                  color: t.text1, fontSize: '11px', outline: 'none', minWidth: '220px',
                }} />
              <button onClick={() => setUserListOpen(o => !o)} title={userListOpen ? 'Hide list' : 'Show list'}
                style={{
                  background: 'transparent', border: `1px solid ${t.border}`,
                  borderRadius: '8px', padding: '8px 14px', cursor: 'pointer',
                  color: t.text3, fontSize: '11px',
                }}>{userListOpen ? '▴ Hide' : '▾ Show'} list</button>
            </div>
          </div>

          {userListOpen && (
            <div style={{
              padding: '12px 16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '8px',
              maxHeight: filteredUsers.length > 8 ? '320px' : 'auto',
              overflowY: filteredUsers.length > 8 ? 'auto' : 'visible',
            }}>
              {usersLoading && <div style={{ color: t.text4, fontSize: '11px', padding: '12px' }}>Loading users…</div>}
              {!usersLoading && filteredUsers.length === 0 && (
                <div style={{ color: t.text4, fontSize: '11px', padding: '20px', textAlign: 'center' }}>
                  {userSearch ? `No users match "${userSearch}".` : 'No users with events yet.'}
                </div>
              )}
              {filteredUsers.map(u => {
                const active = selectedUserId === u.user_id
                return (
                  <button key={u.user_id || 'anon'}
                    onClick={() => u.user_id && setSelectedUserId(u.user_id)}
                    disabled={!u.user_id}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      background: active ? `${t.gold}18` : t.card2 || t.card,
                      border: `1px solid ${active ? t.gold : t.border}`,
                      borderRadius: '10px',
                      cursor: u.user_id ? 'pointer' : 'not-allowed',
                      opacity: u.user_id ? 1 : .55,
                      display: 'flex', alignItems: 'center', gap: '10px',
                      transition: 'all .15s',
                    }}>
                    <Avatar t={t} email={u.email} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                      <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ background: `${t.gold}15`, color: t.gold, padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>{fmt(u.event_count)}</span>
                        <span>{u.sessions} sess</span>
                        <span style={{ color: t.text4, opacity: .6 }}>· {u.role || '—'}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Filter bar (slim) ──────────────────────────────────────── */}
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: '12px', padding: '10px 14px',
        display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap',
      }}>
        {/* Page picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 240 }}>
          <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Page</span>
          <select value={page || ''} onChange={e => setPage(e.target.value)}
            style={{
              flex: 1, background: t.card2 || t.card, border: `1px solid ${t.border}`,
              borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '12px',
              outline: 'none', cursor: 'pointer',
            }}>
            {pages.length === 0 && <option value="">No pages tracked yet</option>}
            {pages.map(p => (
              <option key={p.page_path} value={p.page_path}>
                {pageLabel(p.page_path)} ({fmt(p.event_count)})
              </option>
            ))}
          </select>
        </div>

        {/* Event type segmented */}
        <div style={{ display: 'flex', gap: '2px', padding: '3px', background: t.card2 || t.card, borderRadius: '8px', border: `1px solid ${t.border}` }}>
          {EVENT_TYPES.map(o => {
            const active = eventType === o.value
            return (
              <button key={o.value} onClick={() => setEventType(o.value)} title={o.label}
                style={{
                  padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                  background: active ? t.gold : 'transparent',
                  color: active ? '#1a0a00' : t.text3,
                  fontSize: '11px', fontWeight: active ? 700 : 500,
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}>
                <span style={{ fontSize: '12px' }}>{o.icon}</span>{o.label}
              </button>
            )
          })}
        </div>

        {/* Device */}
        <select value={device} onChange={e => setDevice(e.target.value)}
          style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '11px', outline: 'none', cursor: 'pointer' }}>
          {DEVICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Intensity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Intensity</span>
          <input type="range" min="0.3" max="3" step="0.1" value={intensity} onChange={e => setIntensity(Number(e.target.value))}
            style={{ width: '90px', accentColor: t.gold }} />
          <span style={{ fontSize: '11px', color: t.text2, fontFamily: 'monospace', minWidth: '24px' }}>{intensity.toFixed(1)}×</span>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
        <Kpi t={t} theme={theme} label="Events"     value={fmt(totalEvents)}     accent={t.gold}   icon="◉" />
        <Kpi t={t} theme={theme} label="Sessions"   value={fmt(totalSessions)}   accent={t.blue}   icon="◫" />
        <Kpi t={t} theme={theme} label={mode === 'user' ? 'Filtered to' : 'Unique users'}
             value={mode === 'user' ? (selectedUser?.email || '—').split('@')[0] : fmt(totalUsers)}
             accent={mode === 'user' ? t.purple : t.green}
             icon={mode === 'user' ? '◑' : '◐'} small={mode === 'user'} />
        <Kpi t={t} theme={theme} label="Hot zones"  value={data?.bins?.length || 0} accent={t.orange} icon="◈" />
        <Kpi t={t} theme={theme} label="Time range" value={`${days}d`} accent={t.text2} icon="◇" />
      </div>

      {/* ── Heatmap viewport (browser-window chrome) ────────────────── */}
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: '14px', overflow: 'hidden',
        boxShadow: theme === 'dark' ? '0 4px 24px rgba(0,0,0,.4)' : '0 4px 24px rgba(0,0,0,.06)',
      }}>
        {/* Browser-style chrome */}
        <div style={{
          padding: '10px 14px', borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: '12px',
          background: t.card,
        }}>
          {/* Traffic-light dots */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <Dot color="#e05555" />
            <Dot color="#c9a84c" />
            <Dot color="#3aaa6a" />
          </div>
          {/* URL pill */}
          <div style={{
            flex: 1, background: t.card2 || t.card, border: `1px solid ${t.border}`,
            borderRadius: '6px', padding: '5px 10px',
            fontSize: '11px', color: t.text2, fontFamily: 'monospace',
            display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden',
          }}>
            <span style={{ color: t.green, fontSize: '10px' }}>●</span>
            <span style={{ color: t.text4 }}>goldapp</span>
            <span style={{ color: t.text4 }}>{page || '—'}</span>
          </div>
          {/* Mode badge */}
          <div style={{
            fontSize: '10px', color: mode === 'overall' ? t.gold : t.purple,
            background: mode === 'overall' ? `${t.gold}15` : `${t.purple}15`,
            padding: '4px 10px', borderRadius: '6px',
            letterSpacing: '.08em', fontWeight: 700, textTransform: 'uppercase',
          }}>
            {mode === 'overall' ? `Overall · ${EVENT_TYPES.find(e => e.value === eventType)?.label}` : `${selectedUser?.email?.split('@')[0] || 'no user'}`}
          </div>
        </div>

        {/* Canvas area — wireframe page schematic + heatmap layer */}
        <div ref={wrapRef} style={{
          position: 'relative',
          background: theme === 'dark'
            ? 'radial-gradient(circle at 50% 0%, #1c1a14 0%, #0d0c08 100%)'
            : 'radial-gradient(circle at 50% 0%, #fbf6e6 0%, #f1e9d5 100%)',
        }}>
          {error && (
            <div style={{ background: `${t.red}15`, padding: '12px 16px', fontSize: '11px', color: t.red, position: 'relative', zIndex: 2 }}>{error}</div>
          )}

          {mode === 'user' && !selectedUserId && (
            <EmptyState t={t} icon="◐" title="Pick a user above" body="Choose a user from the list to view their personal click and scroll patterns." />
          )}
          {mode === 'overall' && !loading && data && data.bins.length === 0 && (
            <EmptyState t={t} icon="◇" title="No events yet"
              body={`No ${eventType} events on this page in the last ${days} day${days===1?'':'s'}. Try a wider range or pick a different page.`} />
          )}
          {mode === 'user' && selectedUserId && !loading && data && data.bins.length === 0 && (
            <EmptyState t={t} icon="◇" title="Quiet here" body={`This user has no ${eventType} events on this page in the last ${days} day${days===1?'':'s'}.`} />
          )}

          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', position: 'relative', zIndex: 1 }} />

          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.06)', backdropFilter: 'blur(2px)', zIndex: 3 }}>
              <Spinner color={t.gold} />
            </div>
          )}

          {/* Corner labels */}
          <div style={{ position: 'absolute', top: '8px', left: '10px', fontSize: '9px', color: theme === 'dark' ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.3)', fontFamily: 'monospace', zIndex: 2 }}>0,0</div>
          <div style={{ position: 'absolute', bottom: '8px', right: '10px', fontSize: '9px', color: theme === 'dark' ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.3)', fontFamily: 'monospace', zIndex: 2 }}>100,100</div>

          {/* Legend (bottom-left) */}
          <div style={{
            position: 'absolute', bottom: '10px', left: '10px',
            background: theme === 'dark' ? 'rgba(20,20,16,.85)' : 'rgba(255,255,255,.92)',
            border: `1px solid ${t.border}`, borderRadius: '7px',
            padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '9px', color: t.text3, zIndex: 2,
          }}>
            <span>cool</span>
            <div style={{ width: 70, height: 5, borderRadius: '3px', background: 'linear-gradient(90deg, rgba(255,230,70,.45) 0%, rgba(255,140,30,.7) 50%, rgba(255,50,70,.95) 100%)' }} />
            <span>hot</span>
          </div>

          {/* Schematic hint (top-right) */}
          <div style={{
            position: 'absolute', top: '10px', right: '10px',
            background: theme === 'dark' ? 'rgba(20,20,16,.85)' : 'rgba(255,255,255,.92)',
            border: `1px solid ${t.border}`, borderRadius: '7px',
            padding: '5px 9px',
            fontSize: '9px', color: t.text4, letterSpacing: '.04em', zIndex: 2,
          }}>
            ◫ wireframe · clicks placed at viewport %
          </div>
        </div>
      </div>

      {/* ── Charts row ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '14px' }}>
        <HourlyChart t={t} theme={theme} hourly={data?.hourly} />
        <DeviceDonut t={t} theme={theme} breakdown={data?.device_breakdown} />
      </div>

      {/* ── Bottom: top elements + leaderboard ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: mode === 'overall' ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: '14px' }}>
        <TopElements t={t} elements={data?.top_elements} />
        {mode === 'overall' && (
          <UserLeaderboard t={t} users={users} loading={usersLoading}
            onPick={(id) => { setSelectedUserId(id); setMode('user'); setUserListOpen(false) }} />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Avatar({ t, email, size = 32 }) {
  const initial = (email || '?').slice(0, 1).toUpperCase()
  // Stable color from email hash
  const hue = useMemo(() => {
    let h = 0
    for (let i = 0; i < (email || '').length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
    return h % 360
  }, [email])
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, hsl(${hue}, 65%, 55%) 0%, hsl(${(hue + 40) % 360}, 60%, 45%) 100%)`,
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: `0 2px 6px rgba(0,0,0,.2)`,
    }}>{initial}</div>
  )
}

function Dot({ color }) {
  return <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, opacity: .85 }} />
}

function Kpi({ t, theme, label, value, accent, icon, small }) {
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`,
      borderRadius: '12px', padding: '14px 16px',
      position: 'relative', overflow: 'hidden',
      transition: 'transform .15s, border-color .15s',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}50` }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = t.border }}>
      {/* Accent corner */}
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 56, height: 56,
        background: `radial-gradient(circle at top right, ${accent}25 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
        <div style={{
          width: 24, height: 24, borderRadius: '6px',
          background: `${accent}15`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
        }}>{icon}</div>
      </div>
      <div style={{
        fontSize: small ? '14px' : '22px', color: t.text1,
        fontFamily: 'monospace', fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.1,
      }}>{value}</div>
    </div>
  )
}

function HourlyChart({ t, theme, hourly }) {
  const data = hourly || new Array(24).fill(0)
  const realMax = Math.max(0, ...data)
  const max = realMax > 0 ? realMax : 1
  const hasData = realMax > 0
  // Find true peak hour from non-zero values only
  let peakHour = -1
  for (let i = 0; i < data.length; i++) if (data[i] === realMax) { peakHour = i; break }
  // Build SVG path for smooth area
  const w = 100, h = 100
  const pts = data.map((v, i) => [(i / 23) * w, h - (v / max) * h * .85 - 5])
  const path = pts.reduce((acc, [x, y], i) => acc + (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`), '')
  const areaPath = path + ` L ${w} ${h} L 0 ${h} Z`
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Activity by hour</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>
            Local time · {hasData ? <>peak <span style={{ color: t.gold, fontFamily: 'monospace' }}>{String(peakHour).padStart(2,'0')}:00</span> · {fmt(realMax)} events</> : 'no activity yet'}
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', height: '120px' }}>
        {hasData ? (
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="hg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%"   stopColor={t.gold}   stopOpacity={0.55} />
                <stop offset="100%" stopColor={t.gold}   stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#hg)" />
            <path d={path} stroke={t.gold} strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
            {pts.map(([x, y], i) => data[i] > 0 ? (
              <circle key={i} cx={x} cy={y} r="0.9" fill={t.orange} vectorEffect="non-scaling-stroke" />
            ) : null)}
          </svg>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '6px', color: t.text4 }}>
            {/* Dashed baseline */}
            <svg viewBox="0 0 100 12" preserveAspectRatio="none" style={{ width: '100%', height: '14px' }}>
              <line x1="0" y1="6" x2="100" y2="6" stroke={t.text4} strokeWidth=".5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" opacity=".4" />
            </svg>
            <div style={{ fontSize: '11px' }}>No activity in this range</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '9px', color: t.text4, fontFamily: 'monospace' }}>
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
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

function DeviceDonut({ t, theme, breakdown }) {
  const data = breakdown || []
  const total = data.reduce((s, d) => s + d.count, 0)
  // Donut math: 100 circumference, accumulate offsets
  const r = 28, cx = 36, cy = 36, c = 2 * Math.PI * r
  let offset = 0
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '16px 18px' }}>
      <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '12px' }}>Device split</div>
      {total === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 0' }}>
          <svg viewBox="0 0 72 72" style={{ width: 100, height: 100 }}>
            <circle cx="36" cy="36" r="28" fill="none" stroke={t.border} strokeWidth="10" strokeDasharray="3 5" opacity=".7" />
            <text x="36" y="40" textAnchor="middle" fontSize="9" fill={t.text4} fontFamily="monospace">no data</text>
          </svg>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          <svg viewBox="0 0 72 72" style={{ width: 100, height: 100, flexShrink: 0, transform: 'rotate(-90deg)' }}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.border} strokeWidth="10" />
            {data.map((d, i) => {
              const len = (d.count / total) * c
              const dasharray = `${len} ${c - len}`
              const dashoffset = -offset
              offset += len
              return (
                <circle key={d.device} cx={cx} cy={cy} r={r} fill="none"
                  stroke={DEVICE_COLORS[d.device] || t.text3}
                  strokeWidth="10"
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset} />
              )
            })}
          </svg>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.map(d => (
              <div key={d.device} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: DEVICE_COLORS[d.device] || t.text3, flexShrink: 0 }} />
                  <span style={{ color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.device}</span>
                </div>
                <span style={{ color: t.text1, fontFamily: 'monospace', fontWeight: 600, fontSize: '10px' }}>{((d.count / total) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TopElements({ t, elements }) {
  const list = elements || []
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Top clicked elements</div>
        <div style={{ fontSize: '9px', color: t.text4, background: t.card2 || t.card, padding: '3px 8px', borderRadius: '4px', border: `1px solid ${t.border}` }}>{list.length} unique</div>
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: '11px', color: t.text4, padding: '20px 0', textAlign: 'center' }}>No interactive elements identified.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.slice(0, 10).map((el, i) => {
            const max = list[0].count
            const pct = (el.count / max) * 100
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  fontSize: '9px', color: i < 3 ? t.gold : t.text4,
                  width: '18px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700,
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: t.text1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.element}</span>
                    <span style={{ fontSize: '11px', color: t.gold, fontFamily: 'monospace', flexShrink: 0, fontWeight: 600 }}>{el.count}</span>
                  </div>
                  <div style={{ height: '4px', background: `${t.gold}12`, borderRadius: '2px', overflow: 'hidden' }}>
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
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>Most active users</div>
        <div style={{ fontSize: '9px', color: t.text4 }}>tap row → drilldown</div>
      </div>
      {loading && <div style={{ fontSize: '11px', color: t.text4, padding: '12px 0' }}>Loading…</div>}
      {!loading && users.length === 0 && <div style={{ fontSize: '11px', color: t.text4, padding: '20px 0', textAlign: 'center' }}>No users with events yet.</div>}
      {users.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {users.slice(0, 10).map((u, i) => {
            const max = users[0].event_count
            const pct = (u.event_count / max) * 100
            return (
              <button key={u.user_id || `anon-${i}`}
                onClick={() => u.user_id && onPick(u.user_id)}
                disabled={!u.user_id}
                style={{
                  background: 'transparent', border: 'none',
                  cursor: u.user_id ? 'pointer' : 'not-allowed',
                  padding: '7px 8px', borderRadius: '8px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  textAlign: 'left',
                  opacity: u.user_id ? 1 : .55,
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { if (u.user_id) e.currentTarget.style.background = `${t.gold}10` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <span style={{
                  fontSize: '9px', color: i < 3 ? t.gold : t.text4,
                  width: '18px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700,
                }}>{i + 1}</span>
                <Avatar t={t} email={u.email} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                    <span style={{ fontSize: '11px', color: t.gold, fontFamily: 'monospace', flexShrink: 0, fontWeight: 600 }}>{fmt(u.event_count)}</span>
                  </div>
                  <div style={{ height: '4px', background: `${t.gold}12`, borderRadius: '2px', overflow: 'hidden' }}>
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
    <div style={{ padding: '80px 24px', textAlign: 'center', position: 'relative', zIndex: 2 }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: `${t.gold}15`, color: t.gold,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '28px', margin: '0 auto 16px',
      }}>{icon}</div>
      <div style={{ fontSize: '14px', color: t.text2, fontWeight: 600, marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: t.text4, maxWidth: '380px', margin: '0 auto', lineHeight: 1.6 }}>{body}</div>
    </div>
  )
}

function Spinner({ color }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="16" cy="16" r="12" fill="none" stroke={`${color}25`} strokeWidth="2.5" />
      <circle cx="16" cy="16" r="12" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="20 56" strokeLinecap="round" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Canvas helpers
// ─────────────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// Synthetic page schematic — a faint wireframe of a typical app shell so the
// heatmap has spatial context. Sidebar (left ~6%), topbar (top ~9%), then a
// grid of content cards. Not pixel-perfect to goldapp; close enough that
// hot zones near the top-left will read as "navigation", etc.
function drawSchematic(ctx, w, h, theme) {
  const dark = theme === 'dark'
  const stroke = dark ? 'rgba(201,168,76,.18)' : 'rgba(154,114,40,.22)'
  const fill   = dark ? 'rgba(201,168,76,.04)' : 'rgba(154,114,40,.05)'
  const text   = dark ? 'rgba(240,230,200,.32)' : 'rgba(60,42,16,.42)'
  ctx.lineWidth = 1
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill

  // Sidebar
  const sbW = w * 0.055
  ctx.fillRect(0, 0, sbW, h)
  ctx.strokeRect(0.5, 0.5, sbW, h - 1)
  // Sidebar icons (5 small squares)
  for (let i = 0; i < 6; i++) {
    const cy = h * 0.08 + i * (h * 0.08)
    ctx.beginPath()
    ctx.arc(sbW / 2, cy, Math.min(8, sbW * 0.28), 0, 2 * Math.PI)
    ctx.stroke()
  }

  // Topbar
  const tbY = 0
  const tbH = h * 0.075
  ctx.fillRect(sbW, tbY, w - sbW, tbH)
  ctx.strokeRect(sbW + 0.5, tbY + 0.5, w - sbW - 1, tbH - 1)
  // Topbar pills (right side)
  ctx.font = `${Math.max(9, h * 0.022)}px ui-monospace, monospace`
  ctx.fillStyle = text
  ctx.textBaseline = 'middle'
  ctx.fillText('White Gold / GoldApp', sbW + 14, tbY + tbH / 2)
  // Three pill blobs to the right
  const pillW = Math.max(60, w * 0.07)
  const gap = 12
  let px = w - pillW - 12
  for (let i = 0; i < 3; i++) {
    ctx.strokeRect(px, tbY + tbH * 0.22, pillW, tbH * 0.55)
    px -= pillW + gap
  }

  // Hero band
  const hbY = tbH + h * 0.015
  const hbH = h * 0.16
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  roundRect(ctx, sbW + 16, hbY, w - sbW - 32, hbH, 8)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = text
  ctx.font = `600 ${Math.max(10, h * 0.026)}px system-ui, sans-serif`
  ctx.fillText('Page Title', sbW + 32, hbY + hbH * 0.4)
  ctx.font = `${Math.max(8, h * 0.018)}px system-ui, sans-serif`
  ctx.fillText('subtitle / breadcrumb', sbW + 32, hbY + hbH * 0.7)

  // Content grid: 4 KPI cards across, then 2 wider cards below.
  const contentY = hbY + hbH + h * 0.018
  const contentH = h - contentY - h * 0.025
  const cardGap = 10
  const cardsRowH = contentH * 0.32
  const cardW = (w - sbW - 32 - cardGap * 3) / 4
  for (let i = 0; i < 4; i++) {
    const x = sbW + 16 + i * (cardW + cardGap)
    ctx.strokeStyle = stroke
    ctx.fillStyle = fill
    roundRect(ctx, x, contentY, cardW, cardsRowH, 7)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = text
    ctx.font = `${Math.max(8, h * 0.016)}px system-ui, sans-serif`
    ctx.fillText(['Events','Sessions','Users','Range'][i], x + 10, contentY + 14)
    ctx.font = `600 ${Math.max(11, h * 0.024)}px ui-monospace, monospace`
    ctx.fillText('—', x + 10, contentY + cardsRowH * 0.6)
  }

  // Two wider panels below
  const panelY = contentY + cardsRowH + 12
  const panelH = contentH - cardsRowH - 12
  const panelW = (w - sbW - 32 - cardGap) / 2
  for (let i = 0; i < 2; i++) {
    const x = sbW + 16 + i * (panelW + cardGap)
    ctx.strokeStyle = stroke
    ctx.fillStyle = fill
    roundRect(ctx, x, panelY, panelW, panelH, 7)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = text
    ctx.font = `${Math.max(8, h * 0.016)}px system-ui, sans-serif`
    ctx.fillText(i === 0 ? 'Chart / list' : 'Detail panel', x + 10, panelY + 14)
    // Bars inside the left panel
    if (i === 0) {
      for (let b = 0; b < 6; b++) {
        const bw = panelW - 20 - (b * 5)
        ctx.fillStyle = fill
        ctx.fillRect(x + 10, panelY + 28 + b * 14, Math.max(20, bw * 0.7), 7)
        ctx.strokeRect(x + 10 + 0.5, panelY + 28 + b * 14 + 0.5, Math.max(20, bw * 0.7) - 1, 6)
      }
    }
  }
}
