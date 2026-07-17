'use client'
// app/bus-audit/page.js
// Bus Advertising Audit — field capture app (standalone, mobile-first).
// Marketing shoots 3–5 photos of an ad-wrapped bus; Claude reads the plate,
// we match it to the master list and mark the bus audited. Navy + gold to match
// the on-bus creative.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'

const T = {
  bg: '#0a1533', bgGrad: 'radial-gradient(1200px 600px at 50% -10%, #12245a 0%, #0a1533 55%, #070f26 100%)',
  card: '#101d45', card2: '#16255400', line: '#24356e', line2: '#1a2a5e',
  gold: '#e8b53d', goldSoft: '#f0c85e', text: '#f4f1e8', text2: '#b9c3e0', text3: '#8593bd',
  green: '#3fbf7f', greenBg: 'rgba(63,191,127,.14)', red: '#e8664d', redBg: 'rgba(232,102,77,.14)',
  amber: '#e8a53d', amberBg: 'rgba(232,165,61,.14)',
}
const MIN_PHOTOS = 3, MAX_PHOTOS = 5, BLUR_MIN = 55

// ── image processing (compress + sharpness) ───────────────────────────────
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = URL.createObjectURL(file)
  })
}
function laplacianVar(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  let sum = 0, sum2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const lap = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
    sum += lap; sum2 += lap * lap; n++
  }
  return n ? sum2 / n - (sum / n) ** 2 : 0
}
async function processImage(file) {
  const img = await loadImage(file)
  const maxDim = 1280
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const blur = laplacianVar(ctx, w, h)
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.72))
  URL.revokeObjectURL(img.src)
  return { blob, blur, previewUrl: URL.createObjectURL(blob) }
}

export default function BusAuditPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('capture')
  const [stats, setStats] = useState(null)

  // capture state
  const [photos, setPhotos] = useState([])          // {key, previewUrl, blob, blur, reading}
  const [bus, setBus] = useState(null)              // resolved/confirmed bus
  const [manualQ, setManualQ] = useState('')
  const [manualHits, setManualHits] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const camRef = useRef(null), galRef = useRef(null)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/'); return }
      setMe(session.user)
      setReady(true)
      loadStats()
    })()
  }, [router])

  const loadStats = useCallback(async () => {
    const r = await authedFetch('/api/bus-audit/stats')
    if (r.ok) setStats(await r.json())
  }, [])

  // ── add photos ──────────────────────────────────────────────────────────
  async function onFiles(fileList) {
    setResult(null)
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    for (const file of files) {
      if (photos.length >= MAX_PHOTOS) break
      const key = Math.random().toString(36).slice(2)
      let proc
      try { proc = await processImage(file) } catch { continue }
      const photo = { key, previewUrl: proc.previewUrl, blob: proc.blob, blur: proc.blur, reading: { status: 'reading' }, isPlateShot: false }
      setPhotos(p => [...p, photo].slice(0, MAX_PHOTOS))
      readPlate(key, proc.blob)
    }
  }

  async function readPlate(key, blob) {
    try {
      const fd = new FormData()
      fd.append('image', blob, 'p.jpg')
      const r = await authedFetch('/api/bus-audit/read-plate', { method: 'POST', body: fd })
      const j = await r.json()
      setPhotos(prev => prev.map(p => p.key === key ? { ...p, reading: { status: 'done', ...j } } : p))
    } catch {
      setPhotos(prev => prev.map(p => p.key === key ? { ...p, reading: { status: 'error' } } : p))
    }
  }

  // auto-resolve the bus from the best matched read
  useEffect(() => {
    if (bus) return
    const matched = photos
      .filter(p => p.reading?.status === 'done' && p.reading.match)
      .sort((a, b) => (b.reading.confidence || 0) - (a.reading.confidence || 0))
    if (matched.length) {
      const best = matched[0]
      setBus({ ...best.reading.match, source: 'auto' })
      setPhotos(prev => prev.map(p => ({ ...p, isPlateShot: p.key === best.key })))
    }
  }, [photos, bus])

  function removePhoto(key) {
    setPhotos(prev => {
      const next = prev.filter(p => p.key !== key)
      // if we removed the plate shot, unset bus so it re-resolves
      const removed = prev.find(p => p.key === key)
      if (removed?.isPlateShot) setBus(null)
      return next
    })
  }
  function setPlateShot(key) {
    setPhotos(prev => prev.map(p => ({ ...p, isPlateShot: p.key === key })))
  }
  function resetCapture() {
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl))
    setPhotos([]); setBus(null); setManualQ(''); setManualHits([]); setResult(null)
  }

  // manual search fallback
  useEffect(() => {
    if (manualQ.replace(/[^a-z0-9]/gi, '').length < 3) { setManualHits([]); return }
    let live = true
    const t = setTimeout(async () => {
      const r = await authedFetch('/api/bus-audit/search?q=' + encodeURIComponent(manualQ))
      if (live && r.ok) setManualHits((await r.json()).results || [])
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [manualQ])

  async function submit() {
    if (!bus || photos.length < MIN_PHOTOS || submitting) return
    setSubmitting(true); setResult(null)
    try {
      const fd = new FormData()
      fd.append('reg_norm', bus.reg_norm)
      const meta = photos.map(p => ({
        is_plate_shot: p.isPlateShot,
        blur_score: Math.round(p.blur),
        detected_number: p.reading?.registration || null,
        confidence: p.reading?.confidence ?? null,
      }))
      fd.append('meta', JSON.stringify(meta))
      photos.forEach((p, i) => fd.append('images', p.blob, `bus_${i}.jpg`))
      const r = await authedFetch('/api/bus-audit/submit', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) { setResult({ ok: false, ...j }); setSubmitting(false); return }
      setResult({ ok: true, ...j })
      photos.forEach(p => URL.revokeObjectURL(p.previewUrl))
      setPhotos([]); setBus(null); setManualQ(''); setManualHits([])
      loadStats()
    } catch (e) {
      setResult({ ok: false, error: e?.message || 'Submit failed' })
    }
    setSubmitting(false)
  }

  if (!ready) return <div style={{ ...s.app, alignItems: 'center', justifyContent: 'center' }}><div style={{ color: T.text3 }}>Loading…</div></div>

  const plateShot = photos.find(p => p.isPlateShot)
  const anyReading = photos.some(p => p.reading?.status === 'reading')
  const readCandidate = photos.map(p => p.reading).find(r => r?.status === 'done' && r.registration && !r.match)
  const canSubmit = bus && photos.length >= MIN_PHOTOS && plateShot && !submitting
  const pct = stats && stats.total ? Math.round((stats.audited / stats.total) * 100) : 0

  return (
    <div style={s.app}>
      {/* header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={s.logo}>W</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '.02em' }}>Bus Audit</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{me?.email}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-dm-mono), monospace', fontSize: 18, fontWeight: 700, color: T.gold }}>{stats ? `${stats.audited}/${stats.total}` : '—'}</div>
          <div style={{ fontSize: 10.5, color: T.text3 }}>audited</div>
        </div>
      </div>
      <div style={s.progressTrack}><div style={{ ...s.progressFill, width: `${pct}%` }} /></div>

      {/* tabs */}
      <div style={s.tabs}>
        {['capture', 'progress'].map(k => (
          <button key={k} onClick={() => { setTab(k); if (k === 'progress') loadStats() }}
            style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }}>{k === 'capture' ? '📷 Capture' : '📊 Progress'}</button>
        ))}
      </div>

      {tab === 'capture' ? (
        <div style={s.body}>
          {result && (
            <div style={{ ...s.banner, background: result.ok ? T.greenBg : T.redBg, borderColor: result.ok ? T.green : T.red }}>
              {result.ok
                ? (result.audited
                  ? <><b style={{ color: T.green }}>✓ Audited — {result.bus?.reg_number}</b><div style={{ color: T.text2, fontSize: 12.5, marginTop: 2 }}>{result.bus?.photo_count} photos on file.</div></>
                  : <><b style={{ color: T.amber }}>Saved {result.added} photo{result.added === 1 ? '' : 's'} — {result.bus?.reg_number}</b><div style={{ color: T.text2, fontSize: 12.5, marginTop: 2 }}>{result.needs_plate_shot ? 'Still needs a clear plate shot. ' : ''}{result.needs_more > 0 ? `Add ${result.needs_more} more to complete.` : ''}</div></>)
                : <><b style={{ color: T.red }}>{result.error === 'AUDIT_ALREADY_DONE' ? 'Already audited' : "Couldn't save"}</b><div style={{ color: T.text2, fontSize: 12.5, marginTop: 2 }}>{result.message || result.error}</div></>}
            </div>
          )}

          {photos.length === 0 ? (
            <div style={s.hint}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🚌</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Photograph the bus</div>
              <div style={{ color: T.text3, fontSize: 13, marginTop: 6, lineHeight: 1.5, maxWidth: 280 }}>
                Take <b style={{ color: T.text2 }}>{MIN_PHOTOS}–{MAX_PHOTOS}</b> photos — at least one clearly showing the <b style={{ color: T.text2 }}>number plate</b>, the rest showing the ad wrap. We'll read the plate and file it automatically.
              </div>
            </div>
          ) : (
            <>
              {/* resolved bus card */}
              {bus ? (
                <div style={{ ...s.busCard, borderColor: bus.status === 'audited' ? T.amber : T.gold }}>
                  <div>
                    <div style={{ fontSize: 11, color: T.text3, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 800 }}>{bus.source === 'auto' ? '✓ Plate matched' : 'Selected bus'}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-dm-mono), monospace', color: T.gold, marginTop: 2 }}>{bus.reg_number}</div>
                    <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>{bus.region || 'Region —'} · {bus.status === 'audited' ? `already ${bus.photo_count}/5 photos` : `${bus.photo_count || 0}/5 on file`}</div>
                  </div>
                  <button onClick={() => setBus(null)} style={s.changeBtn}>Change</button>
                </div>
              ) : anyReading ? (
                <div style={s.readingBar}>🔍 Reading plate…</div>
              ) : (
                <div style={{ ...s.busCard, borderColor: T.line, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ color: T.amber, fontWeight: 700, fontSize: 13 }}>
                    {readCandidate ? `Read "${readCandidate.registration}" — not in the master list.` : "Couldn't read a plate."} Pick the bus:
                  </div>
                  <input value={manualQ} onChange={e => setManualQ(e.target.value)} placeholder="Type the bus number…" style={s.search} autoCapitalize="characters" />
                  {manualHits.map(h => (
                    <button key={h.id} onClick={() => { setBus({ ...h, source: 'manual' }); setManualHits([]) }} style={s.hit}>
                      <span style={{ fontFamily: 'var(--font-dm-mono), monospace', fontWeight: 700 }}>{h.reg_number}</span>
                      <span style={{ color: T.text3, fontSize: 12 }}>{h.region || '—'} · {h.status}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* photo grid */}
              <div style={s.grid}>
                {photos.map(p => {
                  const r = p.reading || {}
                  const blurry = p.blur < BLUR_MIN
                  return (
                    <div key={p.key} style={{ ...s.thumb, borderColor: p.isPlateShot ? T.gold : T.line }}>
                      <img src={p.previewUrl} alt="" style={s.thumbImg} />
                      <button onClick={() => removePhoto(p.key)} style={s.rm}>✕</button>
                      {p.isPlateShot && <div style={s.plateTag}>PLATE</div>}
                      <div style={s.thumbFoot}>
                        {r.status === 'reading' ? <span style={{ color: T.text3 }}>reading…</span>
                          : blurry ? <span style={{ color: T.red }}>⚠ blurry</span>
                          : r.match ? <span style={{ color: T.green }}>✓ {r.registration}</span>
                          : r.registration ? <span style={{ color: T.amber }}>{r.registration}?</span>
                          : <span style={{ color: T.text3 }}>no plate</span>}
                        {!p.isPlateShot && r.registration && <button onClick={() => setPlateShot(p.key)} style={s.setPlate}>set plate</button>}
                      </div>
                    </div>
                  )
                })}
                {photos.length < MAX_PHOTOS && (
                  <button onClick={() => galRef.current?.click()} style={s.addTile}>＋</button>
                )}
              </div>
            </>
          )}

          {/* capture buttons */}
          <div style={s.captureRow}>
            <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
            <input ref={galRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
            <button onClick={() => camRef.current?.click()} disabled={photos.length >= MAX_PHOTOS} style={{ ...s.capBtn, ...(photos.length >= MAX_PHOTOS ? s.disabled : {}) }}>📷 Take photo</button>
            <button onClick={() => galRef.current?.click()} disabled={photos.length >= MAX_PHOTOS} style={{ ...s.capBtn, ...s.capBtnAlt, ...(photos.length >= MAX_PHOTOS ? s.disabled : {}) }}>🖼 Upload</button>
          </div>

          {/* submit */}
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={resetCapture} style={s.clearBtn}>Clear</button>
              <button onClick={submit} disabled={!canSubmit} style={{ ...s.submitBtn, ...(canSubmit ? {} : s.disabled) }}>
                {submitting ? 'Submitting…'
                  : photos.length < MIN_PHOTOS ? `Add ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length === 1 ? '' : 's'}`
                  : !bus ? 'Select the bus'
                  : !plateShot ? 'Mark the plate photo'
                  : `Submit ${photos.length} photos ✓`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={s.body}>
          {!stats ? <div style={{ color: T.text3 }}>Loading…</div> : (
            <>
              <div style={s.statRow}>
                <div style={s.statCard}><div style={s.statNum}>{stats.total}</div><div style={s.statLbl}>Total buses</div></div>
                <div style={s.statCard}><div style={{ ...s.statNum, color: T.green }}>{stats.audited}</div><div style={s.statLbl}>Audited</div></div>
                <div style={s.statCard}><div style={{ ...s.statNum, color: T.amber }}>{stats.pending}</div><div style={s.statLbl}>Pending</div></div>
              </div>
              <div style={{ fontSize: 12, color: T.text3, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', margin: '14px 2px 8px' }}>By region</div>
              {stats.by_region.map(r => (
                <div key={r.region} style={s.regionRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.region}</div>
                    <div style={s.regionTrack}><div style={{ ...s.progressFill, width: `${r.total ? (r.audited / r.total) * 100 : 0}%` }} /></div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-dm-mono), monospace', fontSize: 13, color: T.text2, minWidth: 62, textAlign: 'right' }}>{r.audited}/{r.total}</div>
                </div>
              ))}
              {stats.recent.length > 0 && <>
                <div style={{ fontSize: 12, color: T.text3, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', margin: '18px 2px 8px' }}>Recent audits</div>
                {stats.recent.map((r, i) => (
                  <div key={i} style={s.recentRow}>
                    <span style={{ fontFamily: 'var(--font-dm-mono), monospace', fontWeight: 700, color: T.gold }}>{r.reg_number}</span>
                    <span style={{ color: T.text3, fontSize: 12 }}>{r.audited_by_name || '—'}</span>
                  </div>
                ))}
              </>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  app: { minHeight: '100dvh', background: T.bgGrad, backgroundColor: T.bg, color: T.text, fontFamily: 'var(--font-jakarta), system-ui, sans-serif', display: 'flex', flexDirection: 'column', maxWidth: 560, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' },
  logo: { width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg, ${T.gold}, ${T.goldSoft})`, color: '#0a1533', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 },
  progressTrack: { height: 3, background: T.line2, margin: '0 16px', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: `linear-gradient(90deg, ${T.gold}, ${T.green})`, borderRadius: 3, transition: 'width .4s' },
  tabs: { display: 'flex', gap: 8, padding: '12px 16px 4px' },
  tab: { flex: 1, padding: '9px 0', borderRadius: 10, border: `1px solid ${T.line}`, background: 'transparent', color: T.text3, fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  tabOn: { background: T.card, color: T.gold, borderColor: T.gold },
  body: { padding: '12px 16px 28px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 },
  banner: { border: '1px solid', borderRadius: 12, padding: '11px 14px' },
  hint: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '38px 10px 30px' },
  busCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: T.card, border: '1px solid', borderRadius: 14, padding: '13px 15px' },
  changeBtn: { background: 'transparent', border: `1px solid ${T.line}`, color: T.text2, borderRadius: 8, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  readingBar: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '13px 15px', color: T.text2, fontWeight: 700 },
  search: { width: '100%', boxSizing: 'border-box', background: '#0a1533', border: `1px solid ${T.line}`, borderRadius: 9, padding: '10px 12px', color: T.text, fontSize: 15, outline: 'none', fontFamily: 'var(--font-dm-mono), monospace', letterSpacing: '.05em' },
  hit: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0a1533', border: `1px solid ${T.line}`, borderRadius: 9, padding: '10px 12px', cursor: 'pointer', color: T.text },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
  thumb: { position: 'relative', aspectRatio: '3/4', borderRadius: 11, overflow: 'hidden', border: '2px solid', background: '#000' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  rm: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', lineHeight: 1 },
  plateTag: { position: 'absolute', top: 4, left: 4, background: T.gold, color: '#0a1533', fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 5, letterSpacing: '.05em' },
  thumbFoot: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.85))', padding: '14px 6px 5px', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' },
  setPlate: { background: 'rgba(232,181,61,.9)', color: '#0a1533', border: 'none', borderRadius: 5, padding: '2px 6px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' },
  addTile: { aspectRatio: '3/4', borderRadius: 11, border: `2px dashed ${T.line}`, background: T.card, color: T.text3, fontSize: 30, cursor: 'pointer' },
  captureRow: { display: 'flex', gap: 10, marginTop: 2 },
  capBtn: { flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', background: T.gold, color: '#0a1533', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  capBtnAlt: { background: T.card, color: T.text, border: `1px solid ${T.line}` },
  clearBtn: { padding: '14px 20px', borderRadius: 12, border: `1px solid ${T.line}`, background: 'transparent', color: T.text2, fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  submitBtn: { flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${T.green}, #2f9d66)`, color: '#04120a', fontWeight: 900, fontSize: 14.5, cursor: 'pointer' },
  disabled: { opacity: .4, cursor: 'not-allowed', filter: 'grayscale(.4)' },
  statRow: { display: 'flex', gap: 8 },
  statCard: { flex: 1, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '14px 10px', textAlign: 'center' },
  statNum: { fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-dm-mono), monospace', color: T.gold },
  statLbl: { fontSize: 11, color: T.text3, marginTop: 2 },
  regionRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px', borderBottom: `1px solid ${T.line2}` },
  regionTrack: { height: 5, background: T.line2, borderRadius: 3, overflow: 'hidden', marginTop: 5 },
  recentRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 4px', borderBottom: `1px solid ${T.line2}` },
}
