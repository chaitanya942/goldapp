'use client'
// app/bus-audit/review/page.js
// Founder/admin review of the bus audit: search + filter every bus, open one to
// see its geotagged proof photos, location and who/when. Admin-only (the APIs
// enforce it; the page degrades gracefully if not authorized).

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { authedFetch } from '../../../lib/authedFetch'

const C = {
  paper: '#F2F0E9', paper2: '#E8E4D9', card: '#FFFFFF', ink: '#181A1F', ink2: '#585B63', ink3: '#93949B',
  line: '#E2DED3', line2: '#EDEAE1', navy: '#1B3A6B', navySoft: '#ECF1F8',
  green: '#1C824A', greenSoft: '#E4F2E9', amber: '#A5711A', amberSoft: '#F6EDD5', red: '#BC3A22',
}
const SANS = 'var(--font-jakarta), system-ui, sans-serif'
const MONO = SANS   // plate numbers in the humanist sans, not a code-mono face
const pin = (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
const fmtDate = (iso) => { if (!iso) return '' ; const d = new Date(iso); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }

export default function ReviewPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [authorized, setAuthorized] = useState(true)
  const [stats, setStats] = useState(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('audited')
  const [region, setRegion] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/'); return }
      setReady(true)
      const r = await authedFetch('/api/bus-audit/stats'); if (r.ok) setStats(await r.json())
    })()
  }, [router])

  const fetchList = useCallback(async (reset) => {
    setLoading(true)
    const offset = reset ? 0 : rows.length
    const p = new URLSearchParams({ q, status, region, offset: String(offset), limit: '50' })
    const r = await authedFetch('/api/bus-audit/list?' + p.toString())
    if (r.status === 403) { setAuthorized(false); setLoading(false); return }
    const j = await r.json()
    setRows(reset ? (j.rows || []) : [...rows, ...(j.rows || [])])
    setTotal(j.total || 0)
    setLoading(false)
  }, [q, status, region, rows])

  useEffect(() => { if (!ready) return; const t = setTimeout(() => fetchList(true), 250); return () => clearTimeout(t) /* eslint-disable-next-line */ }, [q, status, region, ready])

  async function openDetail(regNorm) {
    setDetailLoading(true); setDetail({ loading: true })
    const r = await authedFetch('/api/bus-audit/detail?reg_norm=' + encodeURIComponent(regNorm))
    const j = await r.json()
    setDetail(r.ok ? j : { error: j.error || 'Failed' })
    setDetailLoading(false)
  }

  if (!ready) return <div style={{ ...s.app, alignItems: 'center', justifyContent: 'center' }}><span style={{ color: C.ink3 }}>Loading…</span></div>
  if (!authorized) return <div style={{ ...s.app, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 30 }}><div><div style={{ fontWeight: 700, fontSize: 17 }}>Admins only</div><div style={{ color: C.ink2, marginTop: 6 }}>This review view is limited to founders/admins.</div></div></div>

  return (
    <div style={s.app}>
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={s.logo}>W</div>
          <div><div style={{ fontWeight: 700, fontSize: 15.5 }}>Bus Audit · Review</div><div style={{ fontSize: 11.5, color: C.ink3 }}>{stats ? `${stats.audited} of ${stats.total} audited` : '—'}</div></div>
        </div>
        <a href="/bus-audit" style={s.link}>Capture →</a>
      </div>

      <div style={s.controls}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bus number" style={s.search} autoCapitalize="characters" />
        <div style={{ display: 'flex', gap: 6 }}>
          {[['audited', 'Audited'], ['pending', 'Pending'], ['', 'All']].map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} style={{ ...s.pill, ...(status === k ? s.pillOn : {}) }}>{l}</button>
          ))}
          <select value={region} onChange={e => setRegion(e.target.value)} style={s.select}>
            <option value="">All regions</option>
            {(stats?.by_region || []).map(r => <option key={r.region} value={r.region}>{r.region}</option>)}
          </select>
        </div>
      </div>

      <div style={s.body}>
        <div style={{ fontSize: 12, color: C.ink3, fontWeight: 700, margin: '2px 2px 6px' }}>{total.toLocaleString('en-IN')} bus{total === 1 ? '' : 'es'}</div>
        {rows.map(r => (
          <button key={r.reg_norm} onClick={() => openDetail(r.reg_norm)} style={s.row}>
            <div style={{ minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontFamily: MONO, fontWeight: 500, color: C.ink, fontSize: 14.5 }}>{r.reg_number}</div>
              <div style={{ fontSize: 12, color: C.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.region || '—'}{r.depot ? ` · ${r.depot}` : ''}{r.first_audited_at ? ` · ${fmtDate(r.first_audited_at)}` : ''}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {r.audit_lat != null && <span style={{ color: C.navy, display: 'flex' }}>{pin(13)}</span>}
              <span style={{ ...s.chip, background: r.status === 'audited' ? C.greenSoft : C.amberSoft, color: r.status === 'audited' ? C.green : C.amber }}>{r.status === 'audited' ? `${r.photo_count}📷` : 'pending'}</span>
            </div>
          </button>
        ))}
        {rows.length < total && <button onClick={() => fetchList(false)} disabled={loading} style={s.more}>{loading ? 'Loading…' : `Load more (${total - rows.length} left)`}</button>}
        {!loading && rows.length === 0 && <div style={{ color: C.ink3, textAlign: 'center', padding: 30 }}>No buses match.</div>}
      </div>

      {detail && (
        <div style={s.overlay} onClick={() => setDetail(null)}>
          <div style={s.sheet} onClick={e => e.stopPropagation()}>
            <div style={s.sheetHead}>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 18 }}>{detail.bus?.reg_number || 'Bus'}</div>
              <button onClick={() => setDetail(null)} style={s.close}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '4px 16px 20px' }}>
              {detail.loading ? <div style={{ color: C.ink3, padding: 20 }}>Loading…</div>
                : detail.error ? <div style={{ color: C.red, padding: 20 }}>{detail.error}</div>
                : (<>
                  <div style={{ fontSize: 12.5, color: C.ink2, marginBottom: 4 }}>{detail.bus.region || '—'}{detail.bus.depot ? ` · ${detail.bus.depot}` : ''}{detail.bus.route ? ` · ${detail.bus.route}` : ''}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ ...s.chip, background: detail.bus.status === 'audited' ? C.greenSoft : C.amberSoft, color: detail.bus.status === 'audited' ? C.green : C.amber }}>{detail.bus.status}</span>
                    {detail.bus.audited_by_name && <span style={{ fontSize: 12, color: C.ink2 }}>by {detail.bus.audited_by_name}</span>}
                    {detail.bus.first_audited_at && <span style={{ fontSize: 12, color: C.ink3 }}>{fmtDate(detail.bus.first_audited_at)}</span>}
                    {detail.bus.audit_lat != null && <a href={`https://www.google.com/maps?q=${detail.bus.audit_lat},${detail.bus.audit_lng}`} target="_blank" rel="noreferrer" style={{ ...s.chip, background: C.navySoft, color: C.navy, textDecoration: 'none', display: 'inline-flex', gap: 4, alignItems: 'center' }}>{pin(12)} {detail.bus.audit_address || 'Map'}</a>}
                  </div>
                  {(detail.photos || []).length === 0 ? <div style={{ color: C.ink3 }}>No photos yet.</div> : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {detail.photos.map(ph => (
                        <a key={ph.id} href={ph.url || '#'} target="_blank" rel="noreferrer" style={s.photoCard}>
                          {ph.url ? <img src={ph.url} alt="" style={s.photo} /> : <div style={{ ...s.photo, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ink3 }}>no image</div>}
                          <div style={{ display: 'flex', gap: 5, position: 'absolute', top: 6, left: 6 }}>
                            {ph.is_plate_shot && <span style={{ ...s.tag, background: '#C89A33', color: '#231800' }}>PLATE</span>}
                            {ph.source === 'upload' && <span style={{ ...s.tag, background: C.amber, color: '#fff' }}>GALLERY</span>}
                          </div>
                          <div style={s.photoFoot}>
                            {ph.detected_number ? <span style={{ fontFamily: MONO }}>{ph.detected_number}{ph.matched ? ' ✓' : ''}</span> : <span style={{ opacity: .7 }}>no plate read</span>}
                            {ph.gps_accuracy != null && <span style={{ opacity: .8 }}> · ±{Math.round(ph.gps_accuracy)}m</span>}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  app: { minHeight: '100dvh', background: C.paper, color: C.ink, fontFamily: SANS, display: 'flex', flexDirection: 'column', maxWidth: 640, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 16px 11px', borderBottom: `1px solid ${C.line}` },
  logo: { width: 34, height: 34, borderRadius: 8, background: C.navy, color: '#C89A33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, fontFamily: 'Georgia, serif' },
  link: { color: C.navy, fontWeight: 700, fontSize: 13, textDecoration: 'none' },
  controls: { padding: '12px 16px 6px', display: 'flex', flexDirection: 'column', gap: 9, position: 'sticky', top: 0, background: C.paper, zIndex: 5 },
  search: { width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 13px', color: C.ink, fontSize: 15, outline: 'none', fontFamily: MONO, letterSpacing: '.03em' },
  pill: { padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.line}`, background: C.card, color: C.ink3, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: SANS },
  pillOn: { background: C.navy, color: '#fff', borderColor: C.navy },
  select: { flex: 1, minWidth: 0, borderRadius: 9, border: `1px solid ${C.line}`, background: C.card, color: C.ink2, padding: '8px 10px', fontSize: 12.5, fontWeight: 600, fontFamily: SANS },
  body: { padding: '6px 16px 30px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 11, padding: '11px 13px', cursor: 'pointer', fontFamily: SANS, width: '100%' },
  chip: { fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 100, whiteSpace: 'nowrap' },
  more: { marginTop: 6, padding: '12px 0', borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: SANS },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(20,22,28,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 },
  sheet: { background: C.paper, width: '100%', maxWidth: 640, maxHeight: '92dvh', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column' },
  sheetHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 8px' },
  close: { width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.line}`, background: C.card, color: C.ink2, fontSize: 15, cursor: 'pointer' },
  photoCard: { position: 'relative', aspectRatio: '3/4', borderRadius: 11, overflow: 'hidden', border: `1px solid ${C.line}`, background: '#000', textDecoration: 'none', display: 'block' },
  photo: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  tag: { fontSize: 8.5, fontWeight: 800, padding: '2px 6px', borderRadius: 5, letterSpacing: '.05em' },
  photoFoot: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.8))', padding: '14px 7px 5px', fontSize: 10.5, fontWeight: 600, color: '#fff' },
}
