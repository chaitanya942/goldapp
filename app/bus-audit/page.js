'use client'
// app/bus-audit/page.js
// Bus Advertising Audit — field capture app.
// Light, high-contrast field UI (built to be read outdoors in daylight),
// flat surfaces, real iconography. GPS is captured at photo time and stored
// with every shot so location can be verified.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { normalizePlate } from '../../lib/busPlate'

const C = {
  paper: '#F2F0E9', paper2: '#E8E4D9', card: '#FFFFFF',
  ink: '#181A1F', ink2: '#585B63', ink3: '#93949B',
  line: '#E2DED3', line2: '#EDEAE1',
  navy: '#1B3A6B', navyInk: '#12294D', navySoft: '#ECF1F8',
  gold: '#9C7620', goldSolid: '#C89A33', goldSoft: '#F6EFD8',
  green: '#1C824A', greenSoft: '#E4F2E9',
  red: '#BC3A22', redSoft: '#F9E8E2',
  amber: '#A5711A', amberSoft: '#F6EDD5',
}
const MIN_PHOTOS = 1, MAX_PHOTOS = 5, BLUR_MIN = 55, ACC_MAX = 150   // reject GPS fixes rougher than 150 m
const SANS = 'var(--font-jakarta), system-ui, sans-serif'
// Plate numbers + stats: the UI sans with tabular figures reads like a clean
// label, not the code-terminal look of a monospace face.
const MONO = SANS
const NUM = { fontFamily: SANS, fontVariantNumeric: 'tabular-nums' }

// ── icons (stroke, currentColor) ──────────────────────────────────────────
const svg = (d, o = {}) => <svg width={o.s || 18} height={o.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={o.w || 1.8} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const Icon = {
  cam: (o) => svg(<><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></>, o),
  img: (o) => svg(<><rect x="3" y="4" width="18" height="16" rx="1.5" /><circle cx="8.5" cy="9" r="1.6" /><path d="M21 16l-5-5-8 8" /></>, o),
  chart: (o) => svg(<><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></>, o),
  pin: (o) => svg(<><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></>, o),
  check: (o) => svg(<path d="M4 12.5l5 5 11-11" />, o),
  x: (o) => svg(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>, o),
  bus: (o) => svg(<><rect x="4" y="4" width="16" height="13" rx="2" /><path d="M4 11h16" /><circle cx="8" cy="20" r="1.4" /><circle cx="16" cy="20" r="1.4" /><path d="M4 17v2M20 17v2" /></>, o),
  arrow: (o) => svg(<path d="M5 12h14M13 6l6 6-6 6" />, o),
  search: (o) => svg(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>, o),
}

// ── image processing (compress + sharpness) ────────────────────────────────
function loadImage(file) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
}
function laplacianVar(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  let s = 0, s2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]; s += l; s2 += l * l; n++ }
  return n ? s2 / n - (s / n) ** 2 : 0
}
async function processImage(file) {
  const img = await loadImage(file)
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h)
  const blur = laplacianVar(ctx, w, h)
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.72))
  URL.revokeObjectURL(img.src)
  return { blob, blur, previewUrl: URL.createObjectURL(blob) }
}

// ── geotag stamp (burns map + place + coords + time into the photo) ─────────
function loadUrlImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src }) }
function fmtStamp(d) {
  const p = n => String(n).padStart(2, '0')
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  const off = -d.getTimezoneOffset(), os = off >= 0 ? '+' : '-'
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(h)}:${p(d.getMinutes())} ${ap} GMT ${os}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
}
function clip(g, text, maxW) { text = text || ''; if (g.measureText(text).width <= maxW) return text; let t = text; while (t.length && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…' }
function wrapText(g, text, x, y, maxW, lh, maxLines) {
  const words = (text || '').split(/\s+/).filter(Boolean); let line = '', used = 0
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i]
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y); y += lh; used++; line = words[i]
      if (used >= maxLines - 1) { g.fillText(clip(g, words.slice(i).join(' '), maxW), x, y); return y + lh }
    } else line = test
  }
  if (line) { g.fillText(clip(g, line, maxW), x, y); y += lh }
  return y
}
async function stampImage(blob, info) {
  const img = await loadImage(blob)
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0)
  const W = cv.width, H = cv.height
  const bh = Math.max(112, Math.round(H * 0.20))
  g.fillStyle = 'rgba(12,14,20,0.58)'; g.fillRect(0, H - bh, W, bh)
  const pad = Math.round(bh * 0.11), mapS = bh - pad * 2
  try { const m = await loadUrlImage(info.mapUrl); g.drawImage(m, pad, H - bh + pad, mapS, mapS); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = Math.max(1, W / 900); g.strokeRect(pad, H - bh + pad, mapS, mapS) } catch {}
  const tx = pad * 2 + mapS, tw = W - tx - pad; let ty = H - bh + pad
  const base = Math.max(13, Math.round(bh * 0.132)), ff = 'Arial, "Helvetica Neue", sans-serif'
  g.textBaseline = 'top'
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(base * 1.18)}px ${ff}`
  g.fillText(clip(g, info.place, tw), tx, ty); ty += Math.round(base * 1.55)
  g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `400 ${base}px ${ff}`
  ty = wrapText(g, info.address, tx, ty, tw, Math.round(base * 1.28), 2); ty += Math.round(base * 0.12)
  g.fillStyle = '#fff'; g.font = `600 ${base}px ${ff}`
  g.fillText(`Lat ${info.lat.toFixed(6)}°  Long ${info.lng.toFixed(6)}°`, tx, ty); ty += Math.round(base * 1.34)
  g.fillStyle = 'rgba(255,255,255,.82)'; g.font = `400 ${Math.round(base * 0.92)}px ${ff}`
  g.fillText(info.when, tx, ty)
  return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82))
}

export default function BusAuditPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('capture')
  const [stats, setStats] = useState(null)
  const [statusTab, setStatusTab] = useState('pending')  // progress sub-tab
  const [busQ, setBusQ] = useState('')
  const [busRows, setBusRows] = useState([])
  const [busTotal, setBusTotal] = useState(0)
  const [busLoading, setBusLoading] = useState(false)

  const [photos, setPhotos] = useState([])
  const [bus, setBus] = useState(null)
  const [manualQ, setManualQ] = useState('')
  const [manualHits, setManualHits] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [geo, setGeo] = useState(null)          // {lat,lng,accuracy,at}
  const [geoState, setGeoState] = useState('idle') // idle|locating|ok|denied|unsupported
  const [geoPlace, setGeoPlace] = useState(null)   // "Mangalore, Karnataka, India"
  const [geoFull, setGeoFull] = useState(null)     // detailed address line
  const [geoResolved, setGeoResolved] = useState(false) // reverse-geocode attempt done
  const [zoom, setZoom] = useState(null)           // full-screen preview url
  const camRef = useRef(null), galRef = useRef(null)

  const reverseGeocode = useCallback(async (lat, lng) => {
    try {
      const r = await authedFetch(`/api/bus-audit/reverse-geo?lat=${lat}&lng=${lng}`)
      if (!r.ok) return
      const j = await r.json(); setGeoPlace(j.place || null); setGeoFull(j.address || null)
    } catch {}
    finally { setGeoResolved(true) }
  }, [])

  const captureGeo = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeoState('unsupported'); return }
    setGeoState('locating'); setGeoResolved(false)
    navigator.geolocation.getCurrentPosition(
      p => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }); setGeoState('ok'); reverseGeocode(p.coords.latitude, p.coords.longitude) },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 },
    )
  }, [reverseGeocode])

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/'); return }
      setMe(session.user); setReady(true); loadStats(); captureGeo()
    })()
  }, [router, captureGeo])

  const loadStats = useCallback(async () => {
    const r = await authedFetch('/api/bus-audit/stats')
    if (r.ok) setStats(await r.json())
  }, [])

  const fetchBuses = useCallback(async (reset, curRows) => {
    setBusLoading(true)
    const offset = reset ? 0 : curRows.length
    const p = new URLSearchParams({ status: statusTab, q: busQ, offset: String(offset), limit: '100' })
    const r = await authedFetch('/api/bus-audit/buses?' + p.toString())
    const j = r.ok ? await r.json() : { rows: [], total: 0 }
    setBusRows(reset ? j.rows : [...curRows, ...j.rows])
    setBusTotal(j.total || 0)
    setBusLoading(false)
  }, [statusTab, busQ])

  useEffect(() => {
    if (tab !== 'progress') return
    const t = setTimeout(() => fetchBuses(true, []), 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusTab, busQ])

  async function onFiles(fileList, source = 'camera') {
    setResult(null)
    captureGeo()   // refresh a fix as they shoot
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    for (const file of files) {
      if (photos.length >= MAX_PHOTOS) break
      const key = Math.random().toString(36).slice(2)
      let proc; try { proc = await processImage(file) } catch { continue }
      setPhotos(p => [...p, { key, previewUrl: proc.previewUrl, blob: proc.blob, blur: proc.blur, reading: { status: 'reading' }, isPlateShot: false, source }].slice(0, MAX_PHOTOS))
      readPlate(key, proc.blob)
    }
  }
  async function readPlate(key, blob) {
    try {
      const fd = new FormData(); fd.append('image', blob, 'p.jpg')
      const r = await authedFetch('/api/bus-audit/read-plate', { method: 'POST', body: fd })
      const j = await r.json()
      setPhotos(prev => prev.map(p => p.key === key ? { ...p, reading: { status: 'done', ...j } } : p))
    } catch { setPhotos(prev => prev.map(p => p.key === key ? { ...p, reading: { status: 'error' } } : p)) }
  }
  useEffect(() => {
    if (bus) return
    const matched = photos.filter(p => p.reading?.status === 'done' && p.reading.match).sort((a, b) => (b.reading.confidence || 0) - (a.reading.confidence || 0))
    if (matched.length) { const best = matched[0]; setBus({ ...best.reading.match, source: 'auto' }); setPhotos(prev => prev.map(p => ({ ...p, isPlateShot: p.key === best.key }))) }
  }, [photos, bus])

  function removePhoto(key) {
    setPhotos(prev => { const removed = prev.find(p => p.key === key); if (removed?.isPlateShot) setBus(null); return prev.filter(p => p.key !== key) })
  }
  const setPlateShot = (key) => setPhotos(prev => prev.map(p => ({ ...p, isPlateShot: p.key === key })))
  function resetCapture() { photos.forEach(p => URL.revokeObjectURL(p.previewUrl)); setPhotos([]); setBus(null); setManualQ(''); setManualHits([]); setResult(null) }

  useEffect(() => {
    if (manualQ.replace(/[^a-z0-9]/gi, '').length < 3) { setManualHits([]); return }
    let live = true
    const t = setTimeout(async () => { const r = await authedFetch('/api/bus-audit/search?q=' + encodeURIComponent(manualQ)); if (live && r.ok) setManualHits((await r.json()).results || []) }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [manualQ])

  // Live geotag stamp — burn the location into each preview so the user sees
  // exactly what will be uploaded, and only uploads on Submit (confirm).
  useEffect(() => {
    const acc = geoState === 'ok' && geo && geo.accuracy <= ACC_MAX
    if (!acc || !geoResolved) return
    const pending = photos.filter(p => !p.stamped && !p.stamping)
    if (!pending.length) return
    const info = { lat: geo.lat, lng: geo.lng, place: geoPlace || `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`, address: geoFull || geoPlace || '', when: fmtStamp(new Date()), mapUrl: `/api/bus-audit/static-map?lat=${geo.lat}&lng=${geo.lng}` }
    setPhotos(prev => prev.map(p => pending.some(q => q.key === p.key) ? { ...p, stamping: true } : p))
    pending.forEach(p => {
      stampImage(p.blob, info)
        .then(sb => { const url = URL.createObjectURL(sb); setPhotos(prev => prev.map(x => x.key === p.key ? (URL.revokeObjectURL(x.previewUrl), { ...x, blob: sb, previewUrl: url, stamped: true, stamping: false }) : x)) })
        .catch(() => setPhotos(prev => prev.map(x => x.key === p.key ? { ...x, stamping: false } : x)))
    })
  }, [photos, geoState, geo, geoResolved, geoPlace, geoFull])

  async function submit() {
    if (!bus || photos.length < MIN_PHOTOS || submitting || !(geoState === 'ok' && geo && geo.accuracy <= ACC_MAX)) return
    setSubmitting(true); setResult(null)
    try {
      const fd = new FormData()
      fd.append('reg_norm', bus.reg_norm)
      const address = geoFull || geoPlace || null
      const meta = photos.map(p => ({ is_plate_shot: p.isPlateShot, blur_score: Math.round(p.blur), detected_number: p.reading?.registration || null, confidence: p.reading?.confidence ?? null, lat: geo?.lat ?? null, lng: geo?.lng ?? null, gps_accuracy: geo?.accuracy ?? null, address, source: p.source || 'camera' }))
      fd.append('meta', JSON.stringify(meta))
      // Burn the geotag banner (map + place + coords + time) into each photo.
      const info = { lat: geo.lat, lng: geo.lng, place: geoPlace || `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`, address: geoFull || geoPlace || '', when: fmtStamp(new Date()), mapUrl: `/api/bus-audit/static-map?lat=${geo.lat}&lng=${geo.lng}` }
      // Photos are already stamped live; stamp any straggler as a fallback.
      const stamped = await Promise.all(photos.map(p => p.stamped ? Promise.resolve(p.blob) : stampImage(p.blob, info).catch(() => p.blob)))
      stamped.forEach((b, i) => fd.append('images', b, `bus_${i}.jpg`))
      const r = await authedFetch('/api/bus-audit/submit', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) { setResult({ ok: false, ...j }); setSubmitting(false); return }
      setResult({ ok: true, ...j })
      photos.forEach(p => URL.revokeObjectURL(p.previewUrl)); setPhotos([]); setBus(null); setManualQ(''); setManualHits([]); loadStats()
    } catch (e) { setResult({ ok: false, error: e?.message || 'Submit failed' }) }
    setSubmitting(false)
  }

  if (!ready) return <div style={{ ...s.app, alignItems: 'center', justifyContent: 'center' }}><span style={{ color: C.ink3 }}>Loading…</span></div>

  const plateShot = photos.find(p => p.isPlateShot)
  const anyReading = photos.some(p => p.reading?.status === 'reading')
  const readCandidate = photos.map(p => p.reading).find(r => r?.status === 'done' && r.registration && !r.match)
  const geoAccurate = geoState === 'ok' && geo && geo.accuracy <= ACC_MAX
  const plateMismatch = plateShot?.reading?.status === 'done' && plateShot.reading.registration && bus && normalizePlate(plateShot.reading.registration) !== bus.reg_norm
  const canSubmit = bus && photos.length >= MIN_PHOTOS && plateShot && geoAccurate && !submitting
  const pct = stats && stats.total ? Math.round((stats.audited / stats.total) * 100) : 0

  return (
    <div style={s.app}>
      {/* header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={s.logo}>W</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15.5, color: C.ink, letterSpacing: '-.01em' }}>Bus Audit</div>
            <div style={{ fontSize: 11.5, color: C.ink3 }}>{me?.email}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ ...NUM, fontSize: 18, fontWeight: 800, color: C.ink, letterSpacing: '-.01em' }}>{stats ? `${stats.audited}` : '—'}<span style={{ color: C.ink3, fontWeight: 600 }}>/{stats?.total ?? '—'}</span></div>
          <div style={{ fontSize: 10, color: C.ink3, textTransform: 'uppercase', letterSpacing: '.11em', fontWeight: 700 }}>audited</div>
        </div>
      </div>
      <div style={s.track}><div style={{ ...s.fill, width: `${pct}%` }} /></div>

      {/* segmented tabs */}
      <div style={s.seg}>
        {[['capture', 'Capture', Icon.cam], ['progress', 'Progress', Icon.chart]].map(([k, label, ic]) => (
          <button key={k} onClick={() => { setTab(k); if (k === 'progress') loadStats() }} style={{ ...s.segBtn, ...(tab === k ? s.segOn : {}) }}>
            <span style={{ color: tab === k ? C.navy : C.ink3 }}>{ic({ s: 16 })}</span>{label}
          </button>
        ))}
      </div>

      {tab === 'capture' ? (
        <div style={s.body}>
          {result && (
            <div style={{ ...s.banner, background: result.ok ? (result.audited ? C.greenSoft : C.amberSoft) : C.redSoft, borderColor: result.ok ? (result.audited ? C.green : C.amber) : C.red }}>
              {result.ok
                ? (result.audited
                  ? <><b style={{ color: C.green }}>Audited — {result.bus?.reg_number}</b><span style={{ color: C.ink2, fontSize: 12.5 }}> · {result.bus?.photo_count} photos on file</span></>
                  : <><b style={{ color: C.amber }}>Saved {result.added} photo{result.added === 1 ? '' : 's'}</b><span style={{ color: C.ink2, fontSize: 12.5 }}> · {result.needs_plate_shot ? 'needs a clear plate shot. ' : ''}{result.needs_more > 0 ? `add ${result.needs_more} more.` : ''}</span></>)
                : <><b style={{ color: C.red }}>{result.error === 'AUDIT_ALREADY_DONE' ? 'Already audited' : "Couldn't save"}</b><span style={{ color: C.ink2, fontSize: 12.5 }}> · {result.message || result.error}</span></>}
            </div>
          )}

          {/* location status */}
          <button onClick={geoAccurate ? undefined : captureGeo} style={{ ...s.geo, cursor: geoAccurate ? 'default' : 'pointer', borderColor: geoAccurate ? C.green : geoState === 'locating' ? C.line : C.amber, background: geoAccurate ? C.greenSoft : geoState === 'locating' ? C.card : C.amberSoft }}>
            <span style={{ color: geoAccurate ? C.green : geoState === 'locating' ? C.ink3 : C.amber, display: 'flex' }}>{Icon.pin({ s: 16 })}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2 }}>
              {geoAccurate ? <>{geoPlace ? <span style={{ color: C.ink }}>{geoPlace}</span> : 'Location tagged'} <span style={{ fontFamily: MONO, color: C.ink3 }}>{geo.lat.toFixed(4)}, {geo.lng.toFixed(4)} · ±{Math.round(geo.accuracy)}m</span></>
                : geoState === 'ok' ? <span style={{ color: C.amber }}>Location too rough · ±{Math.round(geo.accuracy)}m — move to open sky, tap to retry</span>
                : geoState === 'locating' ? 'Getting location…'
                : geoState === 'denied' ? 'Location blocked — tap to enable (required)'
                : geoState === 'unsupported' ? 'Location not available on this device'
                : 'Tap to tag location'}
            </span>
          </button>

          {photos.length === 0 ? (
            <div style={s.empty}>
              <div style={{ color: C.navy, display: 'flex' }}>{Icon.bus({ s: 34, w: 1.5 })}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 12 }}>Photograph the bus</div>
              <div style={{ color: C.ink2, fontSize: 13, marginTop: 6, lineHeight: 1.5, maxWidth: 290 }}>
                Take <b>{MIN_PHOTOS}–{MAX_PHOTOS}</b> photos — one clearly showing the <b>number plate</b>, the rest showing the ad wrap. The plate is read and filed automatically.
              </div>
            </div>
          ) : (
            <>
              {bus ? (
                <div style={s.busCard}>
                  <div style={{ minWidth: 0 }}>
                    <div style={s.microLabel}><span style={{ color: C.green, display: 'inline-flex', verticalAlign: '-2px' }}>{Icon.check({ s: 13, w: 2.4 })}</span> {bus.source === 'auto' ? 'Plate matched' : 'Selected bus'}</div>
                    <div style={{ ...NUM, fontSize: 23, fontWeight: 800, color: C.ink, letterSpacing: '.01em', margin: '3px 0 3px' }}>{bus.reg_number}</div>
                    <div style={{ fontSize: 12.5, color: C.ink2 }}>{bus.region || 'Region —'}{bus.depot ? ` · ${bus.depot}` : ''} · {bus.status === 'audited' ? `already ${bus.photo_count}/5` : `${bus.photo_count || 0}/5 on file`}</div>
                  </div>
                  <button onClick={() => setBus(null)} style={s.change}>Change</button>
                </div>
              ) : anyReading ? (
                <div style={s.readingBar}><span className="ba-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.line}`, borderTopColor: C.navy, display: 'inline-block' }} /> Reading plate…</div>
              ) : (
                <div style={{ ...s.busCard, flexDirection: 'column', alignItems: 'stretch', gap: 9 }}>
                  <div style={{ color: C.amber, fontWeight: 600, fontSize: 13 }}>{readCandidate ? `Read "${readCandidate.registration}" — not in the list.` : "Couldn't read a plate."} Pick the bus:</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }}>{Icon.search({ s: 16 })}</span>
                    <input value={manualQ} onChange={e => setManualQ(e.target.value)} placeholder="Type the bus number" style={s.search} autoCapitalize="characters" />
                  </div>
                  {manualHits.map(h => (
                    <button key={h.id} onClick={() => { setBus({ ...h, source: 'manual' }); setManualHits([]) }} style={s.hit}>
                      <span style={{ fontFamily: MONO, fontWeight: 500, color: C.ink }}>{h.reg_number}</span>
                      <span style={{ color: C.ink3, fontSize: 12 }}>{h.region || '—'} · {h.status}</span>
                    </button>
                  ))}
                </div>
              )}

              {plateMismatch && (
                <div style={{ ...s.banner, background: C.amberSoft, borderColor: C.amber, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: C.amber, display: 'flex', flexShrink: 0, marginTop: 1 }}>{Icon.pin({ s: 15 })}</span>
                  <span style={{ color: C.ink2 }}>The plate photo reads <b style={{ fontFamily: MONO, color: C.ink }}>{plateShot.reading.registration}</b>, but the selected bus is <b style={{ fontFamily: MONO, color: C.ink }}>{bus.reg_number}</b>. Double-check you've picked the right bus.</span>
                </div>
              )}
              <div style={s.grid}>
                {photos.map(p => {
                  const r = p.reading || {}; const blurry = p.blur < BLUR_MIN
                  return (
                    <div key={p.key} style={{ ...s.thumb, borderColor: p.isPlateShot ? C.goldSolid : C.line }}>
                      <img src={p.previewUrl} alt="" style={{ ...s.thumbImg, cursor: 'zoom-in' }} onClick={() => setZoom(p.previewUrl)} />
                      {p.stamping && <div style={s.stamping}><span className="ba-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', display: 'inline-block' }} /></div>}
                      <button onClick={() => removePhoto(p.key)} style={s.rm}>{Icon.x({ s: 13, w: 2.2 })}</button>
                      {p.isPlateShot && <div style={s.plateTag}>PLATE</div>}
                      {p.source === 'upload' && <div style={{ ...s.uploadTag, top: p.isPlateShot ? 27 : 5 }}>GALLERY</div>}
                      <div style={s.thumbFoot}>
                        {r.status === 'reading' ? <span style={{ color: '#fff', opacity: .85 }}>reading…</span>
                          : blurry ? <span style={{ color: '#ffb4a4' }}>blurry</span>
                          : r.match ? <span style={{ color: '#8fe6b0', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{Icon.check({ s: 12, w: 2.4 })}{r.registration}</span>
                          : r.registration ? <span style={{ color: '#f2d38a' }}>{r.registration}?</span>
                          : <span style={{ color: '#fff', opacity: .7 }}>no plate</span>}
                        {!p.isPlateShot && r.registration && <button onClick={() => setPlateShot(p.key)} style={s.setPlate}>set plate</button>}
                      </div>
                    </div>
                  )
                })}
                {photos.length < MAX_PHOTOS && <button onClick={() => camRef.current?.click()} style={s.addTile}>+</button>}
              </div>
            </>
          )}

          <div style={s.capRow}>
            <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { onFiles(e.target.files, 'camera'); e.target.value = '' }} />
            <input ref={galRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { onFiles(e.target.files, 'upload'); e.target.value = '' }} />
            <button onClick={() => camRef.current?.click()} disabled={photos.length >= MAX_PHOTOS} style={{ ...s.cap, ...(photos.length >= MAX_PHOTOS ? s.disabled : {}) }}>{Icon.cam({ s: 18 })} Take photo</button>
            <button onClick={() => galRef.current?.click()} disabled={photos.length >= MAX_PHOTOS} style={{ ...s.cap, ...s.capAlt, ...(photos.length >= MAX_PHOTOS ? s.disabled : {}) }}>{Icon.img({ s: 18 })} Upload</button>
          </div>

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={resetCapture} style={s.clear}>Clear</button>
              <button onClick={submit} disabled={!canSubmit} style={{ ...s.submit, ...(canSubmit ? {} : s.disabled) }}>
                {submitting ? 'Submitting…'
                  : photos.length < MIN_PHOTOS ? `Add ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length === 1 ? '' : 's'}`
                  : !bus ? 'Select the bus'
                  : !plateShot ? 'Mark the plate photo'
                  : !geoAccurate ? (geoState === 'ok' ? 'Location too rough — retry' : 'Enable location to submit')
                  : <>Submit {photos.length} photo{photos.length === 1 ? '' : 's'} {Icon.arrow({ s: 17 })}</>}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={s.body}>
          {!stats ? <span style={{ color: C.ink3 }}>Loading…</span> : (
            <>
              <div style={{ display: 'flex', gap: 9 }}>
                {[['Total', stats.total, C.ink], ['Audited', stats.audited, C.green], ['Pending', stats.pending, C.amber]].map(([l, v, col]) => (
                  <div key={l} style={s.stat}><div style={{ ...NUM, fontSize: 26, fontWeight: 800, color: col, letterSpacing: '-.02em' }}>{v.toLocaleString('en-IN')}</div><div style={s.statLbl}>{l}</div></div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => setStatusTab('pending')} style={{ ...s.subTab, ...(statusTab === 'pending' ? s.subTabOn : {}) }}>Pending · {stats.pending}</button>
                <button onClick={() => setStatusTab('audited')} style={{ ...s.subTab, ...(statusTab === 'audited' ? s.subTabOn : {}) }}>Audited · {stats.audited}</button>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }}>{Icon.search({ s: 16 })}</span>
                <input value={busQ} onChange={e => setBusQ(e.target.value)} placeholder="Search bus number" style={s.search} autoCapitalize="characters" />
              </div>
              <div style={{ fontSize: 11.5, color: C.ink3, fontWeight: 700, margin: '0 2px' }}>{busTotal.toLocaleString('en-IN')} {statusTab}</div>
              {busLoading && busRows.length === 0 ? <div style={{ color: C.ink3, padding: 16 }}>Loading…</div>
                : busRows.length === 0 ? <div style={{ color: C.ink3, textAlign: 'center', padding: 24 }}>No buses.</div>
                : busRows.map(b => (
                  <div key={b.reg_norm} style={s.busListRow}>
                    <span style={{ ...NUM, fontWeight: 700, color: C.ink, fontSize: 14.5, letterSpacing: '.01em' }}>{b.reg_number}</span>
                    <span style={{ fontSize: 12, color: C.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 10, textAlign: 'right' }}>{b.region || '—'}{b.depot ? ` · ${b.depot}` : ''}{statusTab === 'audited' && b.photo_count ? ` · ${b.photo_count} 📷` : ''}</span>
                  </div>
                ))}
              {busRows.length < busTotal && <button onClick={() => fetchBuses(false, busRows)} disabled={busLoading} style={s.more2}>{busLoading ? 'Loading…' : `Load more (${busTotal - busRows.length} left)`}</button>}
            </>
          )}
        </div>
      )}
      {zoom && (
        <div onClick={() => setZoom(null)} style={s.zoomWrap}>
          <img src={zoom} alt="" style={s.zoomImg} />
          <div style={s.zoomHint}>Geotag is stamped on the photo · tap to close</div>
        </div>
      )}
      <style>{`@keyframes ba-spin{to{transform:rotate(360deg)}} .ba-spin{animation:ba-spin .7s linear infinite}`}</style>
    </div>
  )
}

const s = {
  app: { minHeight: '100dvh', background: C.paper, color: C.ink, fontFamily: SANS, display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 16px 11px' },
  logo: { width: 34, height: 34, borderRadius: 8, background: C.navy, color: C.goldSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, fontFamily: 'Georgia, serif' },
  track: { height: 3, background: C.paper2, margin: '0 16px', borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', background: C.green, borderRadius: 3, transition: 'width .4s' },
  seg: { display: 'flex', gap: 4, margin: '12px 16px 0', padding: 4, background: C.paper2, borderRadius: 11 },
  segBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, border: 'none', background: 'transparent', color: C.ink3, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: SANS },
  segOn: { background: C.card, color: C.navy, boxShadow: '0 1px 3px rgba(20,25,40,.09)' },
  body: { padding: '14px 16px 30px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 },
  banner: { border: '1px solid', borderRadius: 11, padding: '11px 13px', fontSize: 13.5 },
  geo: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid', borderRadius: 10, padding: '9px 12px', width: '100%', textAlign: 'left', fontFamily: SANS },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 10px 34px', background: C.card, border: `1px solid ${C.line}`, borderRadius: 14 },
  busCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 13, padding: '13px 14px', boxShadow: '0 1px 2px rgba(20,25,40,.04)' },
  microLabel: { fontSize: 10.5, color: C.ink3, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 800 },
  change: { background: 'transparent', border: `1px solid ${C.line}`, color: C.ink2, borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: SANS },
  readingBar: { display: 'flex', alignItems: 'center', gap: 9, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: '13px 14px', color: C.ink2, fontWeight: 600, fontSize: 13.5 },
  search: { width: '100%', boxSizing: 'border-box', background: C.paper, border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 12px 10px 34px', color: C.ink, fontSize: 15, outline: 'none', fontFamily: MONO, letterSpacing: '.04em' },
  hit: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.paper, border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 12px', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
  thumb: { position: 'relative', aspectRatio: '3/4', borderRadius: 11, overflow: 'hidden', border: '2px solid', background: '#000' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  rm: { position: 'absolute', top: 5, right: 5, width: 23, height: 23, borderRadius: '50%', background: 'rgba(15,18,25,.62)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  plateTag: { position: 'absolute', top: 5, left: 5, background: C.goldSolid, color: '#231800', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, letterSpacing: '.06em' },
  uploadTag: { position: 'absolute', left: 5, background: C.amber, color: '#fff', fontSize: 8.5, fontWeight: 800, padding: '2px 6px', borderRadius: 5, letterSpacing: '.06em' },
  thumbFoot: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.82))', padding: '15px 6px 5px', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' },
  setPlate: { background: 'rgba(255,255,255,.92)', color: C.navyInk, border: 'none', borderRadius: 5, padding: '2px 6px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer', fontFamily: SANS },
  addTile: { aspectRatio: '3/4', borderRadius: 11, border: `2px dashed ${C.line}`, background: C.card, color: C.ink3, fontSize: 28, cursor: 'pointer', fontWeight: 300 },
  stamping: { position: 'absolute', top: 5, right: 32, width: 22, height: 22, borderRadius: '50%', background: 'rgba(15,18,25,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  zoomWrap: { position: 'fixed', inset: 0, background: 'rgba(10,12,16,.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 200, padding: 16, cursor: 'zoom-out' },
  zoomImg: { maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', borderRadius: 8 },
  zoomHint: { color: 'rgba(255,255,255,.8)', fontSize: 12.5, fontWeight: 600 },
  capRow: { display: 'flex', gap: 10, marginTop: 2 },
  cap: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0', borderRadius: 11, border: 'none', background: C.navy, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: SANS },
  capAlt: { background: C.card, color: C.navy, border: `1px solid ${C.line}` },
  clear: { padding: '14px 20px', borderRadius: 11, border: `1px solid ${C.line}`, background: C.card, color: C.ink2, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: SANS },
  submit: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '14px 0', borderRadius: 11, border: 'none', background: C.goldSolid, color: '#231800', fontWeight: 800, fontSize: 14.5, cursor: 'pointer', fontFamily: SANS },
  disabled: { opacity: .45, cursor: 'not-allowed', filter: 'grayscale(.3)' },
  stat: { flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 10px', textAlign: 'center' },
  statLbl: { fontSize: 11, color: C.ink3, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 },
  sectionLbl: { fontSize: 11, color: C.ink3, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.11em', margin: '10px 2px 2px' },
  regionRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px' },
  regionTrack: { height: 5, background: C.paper2, borderRadius: 3, overflow: 'hidden', marginTop: 5 },
  recent: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 2px', borderBottom: `1px solid ${C.line2}` },
  subTab: { flex: 1, padding: '10px 0', borderRadius: 9, border: `1px solid ${C.line}`, background: C.card, color: C.ink3, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: SANS },
  subTabOn: { background: C.navy, color: '#fff', borderColor: C.navy },
  busListRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 12px' },
  more2: { marginTop: 4, padding: '11px 0', borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, color: C.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: SANS },
}
