'use client'

// components/admin/HeatmapViewer.js
//
// In-app heatmap viewer. Reads aggregated event data from /api/heatmap/aggregate
// and renders a click-density overlay using a canvas + radial-gradient blobs.
//
// No screenshot pipeline — we visualize click coordinates as percentages on a
// proportional canvas. For an actual page-overlay view (heatmap on top of the
// real UI), you'd need a screenshot service per page; deferring that for now.

import { useEffect, useMemo, useRef, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const DEVICE_OPTIONS = [
  { value: '', label: 'All devices' },
  { value: 'desktop-wide', label: 'Desktop (wide)' },
  { value: 'desktop',      label: 'Desktop' },
  { value: 'tablet',       label: 'Tablet' },
  { value: 'mobile-large', label: 'Mobile (large)' },
  { value: 'mobile',       label: 'Mobile' },
]
const EVENT_TYPES = [
  { value: 'click',    label: 'Clicks' },
  { value: 'scroll',   label: 'Scroll' },
  { value: 'pageview', label: 'Page views' },
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

export default function HeatmapViewer({ defaultProject = 'goldapp' }) {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [project,    setProject]    = useState(defaultProject)
  const [pages,      setPages]      = useState([])
  const [page,       setPage]       = useState(null)
  const [device,     setDevice]     = useState('')
  const [eventType,  setEventType]  = useState('click')
  const [days,       setDays]       = useState(7)
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [intensity,  setIntensity]  = useState(1)

  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  // Fetch the page list whenever project changes.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const r = await authedFetch(`/api/heatmap/pages?project=${encodeURIComponent(project)}`)
        const j = await r.json()
        if (cancel) return
        if (!r.ok) { setError(j.error || 'Failed to load pages'); return }
        setPages(j.pages || [])
        if (!page && j.pages?.length) setPage(j.pages[0].page_path)
      } catch (e) { if (!cancel) setError(e.message) }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [project])

  // Fetch aggregate data whenever filters change.
  useEffect(() => {
    if (!page) return
    let cancel = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const params = new URLSearchParams({
          project, page, event_type: eventType,
          from: isoDaysAgo(days),
        })
        if (device) params.set('device', device)
        const r = await authedFetch(`/api/heatmap/aggregate?${params}`)
        const j = await r.json()
        if (cancel) return
        if (!r.ok) { setError(j.error || 'Aggregate failed'); return }
        setData(j)
      } catch (e) { if (!cancel) setError(e.message) }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [project, page, device, eventType, days])

  // Render heatmap on canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap || !data?.bins) return

    // Match canvas size to its container so coords align with the visible area.
    const w = wrap.clientWidth
    const h = Math.max(360, w * 0.55)  // 55% aspect ratio — close to typical desktop view
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    if (data.bins.length === 0) return

    // Find max for normalization
    const max = data.bins.reduce((m, b) => Math.max(m, b.count), 1)

    // Render each bin as a radial gradient blob — additive blending creates the heatmap effect.
    ctx.globalCompositeOperation = 'lighter'
    const blobRadius = Math.min(w, h) * 0.06  // 6% of smaller dimension
    for (const b of data.bins) {
      const x = (b.x_bin / 100) * w
      const y = (b.y_bin / 100) * h
      const norm = (b.count / max) * intensity
      const grad = ctx.createRadialGradient(x, y, 0, x, y, blobRadius)
      // Color stops: warm gradient (red → yellow → transparent)
      grad.addColorStop(0,   `rgba(255, 70, 70, ${Math.min(0.85, norm)})`)
      grad.addColorStop(0.4, `rgba(255, 180, 30, ${Math.min(0.5, norm * 0.6)})`)
      grad.addColorStop(1,   `rgba(255, 255, 0, 0)`)
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(x, y, blobRadius, 0, 2 * Math.PI); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [data, intensity])

  const card  = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const inp   = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 11px', color: t.text1, fontSize: '.72rem', outline: 'none' }
  const pillBtn = (active) => ({ padding: '6px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: active ? t.gold : 'transparent', color: active ? '#1a0a00' : t.text3, fontSize: '.7rem', fontWeight: active ? 700 : 400 })

  const totalSessions = data?.total || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Filters */}
      <div style={{ ...card, padding: '14px 18px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={project} onChange={e => setProject(e.target.value)} style={inp}>
          <option value="goldapp">GoldApp</option>
          {/* Future: load other projects from heatmap_projects */}
        </select>

        <select value={page || ''} onChange={e => setPage(e.target.value)} style={{ ...inp, maxWidth: '320px' }}>
          {pages.length === 0 && <option value="">No pages tracked yet</option>}
          {pages.map(p => (
            <option key={p.page_path} value={p.page_path}>
              {p.page_path}{p.page_title ? ` · ${p.page_title}` : ''} ({p.event_count})
            </option>
          ))}
        </select>

        <select value={eventType} onChange={e => setEventType(e.target.value)} style={inp}>
          {EVENT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select value={device} onChange={e => setDevice(e.target.value)} style={inp}>
          {DEVICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div style={{ display: 'flex', gap: '4px', padding: '3px', background: t.card2 || t.card, borderRadius: '8px', border: `1px solid ${t.border}` }}>
          {QUICK_RANGES.map(r => (
            <button key={r.label} onClick={() => setDays(r.days)} style={pillBtn(days === r.days)}>{r.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span style={{ fontSize: '.62rem', color: t.text4 }}>Intensity</span>
          <input type="range" min="0.3" max="3" step="0.1" value={intensity} onChange={e => setIntensity(Number(e.target.value))}
            style={{ width: '110px', accentColor: t.gold }} />
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
        <Stat t={t} label="Events"     value={totalSessions.toLocaleString('en-IN')} color={t.gold} />
        <Stat t={t} label="Hot zones"  value={data?.bins?.length || 0} color={t.blue} />
        <Stat t={t} label="Top element" value={data?.top_elements?.[0]?.element || '—'} color={t.text2} small />
        <Stat t={t} label="Range"      value={`${days} day${days === 1 ? '' : 's'}`} color={t.text2} />
      </div>

      {/* Heatmap canvas */}
      <div ref={wrapRef} style={{ ...card, padding: 0, overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg, #f5f0e0 0%, #faf6e8 100%)' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: t.card }}>
          <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>
            {EVENT_TYPES.find(e => e.value === eventType)?.label} heatmap · <span style={{ color: t.text2, fontFamily: 'monospace' }}>{page || '—'}</span>
          </div>
          {loading && <span style={{ fontSize: '10px', color: t.text4 }}>Loading…</span>}
        </div>
        {error && (
          <div style={{ background: `${t.red}15`, padding: '12px 16px', fontSize: '11px', color: t.red }}>{error}</div>
        )}
        {!loading && data && data.bins.length === 0 && (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>
            No {eventType} events yet for this page in the selected range.<br />
            <span style={{ fontSize: '10px', color: t.text4, opacity: 0.7 }}>Try a wider date range, or click around the page in another tab to generate test events.</span>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
        {/* Coordinate hints */}
        <div style={{ position: 'absolute', top: '50px', left: '8px', fontSize: '9px', color: 'rgba(0,0,0,.4)' }}>0,0</div>
        <div style={{ position: 'absolute', bottom: '8px', right: '8px', fontSize: '9px', color: 'rgba(0,0,0,.4)' }}>100,100</div>
      </div>

      {/* Top elements */}
      {data?.top_elements?.length > 0 && (
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
            Top clicked elements
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.top_elements.slice(0, 12).map((el, i) => {
              const max = data.top_elements[0].count
              const pct = (el.count / max) * 100
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '10px', color: t.text4, width: '18px', textAlign: 'right' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <span style={{ fontSize: '11px', color: t.text1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.element}</span>
                      <span style={{ fontSize: '11px', color: t.gold, fontFamily: 'monospace', flexShrink: 0, marginLeft: '8px' }}>{el.count}</span>
                    </div>
                    <div style={{ height: '3px', background: `${t.gold}20`, borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: t.gold, transition: 'width .4s' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ t, label, value, color, small }) {
  return (
    <div style={{ background: t.card, padding: '12px 16px' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '5px' }}>{label}</div>
      <div style={{ fontSize: small ? '12px' : '18px', color, fontFamily: 'monospace', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )
}
