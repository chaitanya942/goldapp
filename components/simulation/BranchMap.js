'use client'

// Interactive branch map (Leaflet + CARTO/OpenStreetMap tiles). Markers are
// sized by bills in branch stock; today's consignments are drawn as routes to
// the HO (or to a hub), with a truck part-way along each one still in transit.

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { transitProgress, fmtN, fmtG } from './simData'

// Standard OpenStreetMap tiles (no API key). Dark theme inverts the tile pane
// with CSS (.sim-map-dark) so markers/labels keep their real colours.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

export default function BranchMap({ data, region, dark, colors, selected, onSelect, onOpenHO }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const LRef = useRef(null)
  const tileRef = useRef(null)
  const layerRef = useRef(null)
  const fittedRef = useRef('')
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    import('leaflet').then(mod => {
      if (cancelled || !elRef.current || mapRef.current) return
      const L = mod.default || mod
      LRef.current = L
      const map = L.map(elRef.current, { zoomControl: true, attributionControl: true, preferCanvas: false, minZoom: 5 })
      map.setView([13.5, 77.5], 6)
      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setReady(true)
    })
    const id = setInterval(() => setTick(x => x + 1), 30000)
    return () => {
      cancelled = true
      clearInterval(id)
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!ready || !L || !map || tileRef.current) return
    tileRef.current = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map)
  }, [ready])

  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current
    if (!ready || !L || !map || !layer || !data) return
    layer.clearLayers()

    const inRegion = (b) => !region || b.region === region
    const byName = Object.fromEntries(data.branches.map(b => [b.name, b]))
    const ho = data.ho?.lat != null ? [data.ho.lat, data.ho.lng] : null
    const movingToday = new Set(data.consignments.map(c => c.from))
    const visible = data.branches.filter(b => inRegion(b) && b.lat != null && b.lng != null)

    // Routes + trucks for today's consignments touching this view.
    for (const c of data.consignments) {
      const from = byName[c.from]
      const toPt = c.type === 'EXTERNAL' ? ho : (byName[c.to]?.lat != null ? [byName[c.to].lat, byName[c.to].lng] : null)
      if (!from || from.lat == null || !toPt) continue
      if (region && from.region !== region && !(c.type === 'INTERNAL' && byName[c.to]?.region === region)) continue
      const a = [from.lat, from.lng]
      const received = c.status === 'received'
      const isSel = selected?.type === 'cons' && selected.id === c.id
      L.polyline([a, toPt], {
        color: c.type === 'EXTERNAL' ? colors.gold : colors.purple,
        weight: isSel ? 4 : received ? 2 : 3,
        opacity: received ? 0.45 : 0.9,
        dashArray: received ? null : '8 8',
        className: received ? '' : 'sim-route-flow',
      }).on('click', () => onSelect({ type: 'cons', id: c.id })).addTo(layer)
      if (!received) {
        const p = transitProgress(c)
        const pos = [a[0] + (toPt[0] - a[0]) * p, a[1] + (toPt[1] - a[1]) * p]
        L.marker(pos, {
          icon: L.divIcon({
            className: '',
            html: `<div class="sim-truck${isSel ? ' sel' : ''}"><span>🚚</span><b>${c.bills}</b></div>`,
            iconSize: [46, 24], iconAnchor: [23, 12],
          }),
          zIndexOffset: 1000,
        }).bindTooltip(`${esc(c.no)} · ${esc(c.from)} → ${c.type === 'EXTERNAL' ? 'HO' : esc(c.to)}<br>${c.bills} bills · ${fmtG(c.net)}`, { direction: 'top', offset: [0, -10] })
          .on('click', () => onSelect({ type: 'cons', id: c.id })).addTo(layer)
      }
    }

    // Branch markers.
    for (const b of visible) {
      const bills = b.stock.bills
      const color = movingToday.has(b.name) ? colors.gold : bills > 0 ? colors.blue : colors.muted
      const isSel = selected?.type === 'branch' && selected.name === b.name
      L.circleMarker([b.lat, b.lng], {
        radius: Math.min(18, 5 + Math.sqrt(bills) * 2.2) + (isSel ? 3 : 0),
        color: isSel ? colors.text : b.is_hub ? colors.text : color,
        weight: isSel ? 3 : b.is_hub ? 2.5 : 1.5,
        fillColor: color,
        fillOpacity: bills > 0 || movingToday.has(b.name) ? 0.8 : 0.35,
      })
        .bindTooltip(`<b>${esc(b.name)}</b>${b.is_hub ? ' · hub' : ''}<br>${fmtN(bills)} bills · ${fmtG(b.stock.net)}${b.stock.booked_bills ? `<br>${b.stock.booked_bills} booked` : ''}`, { direction: 'top', offset: [0, -6] })
        .on('click', () => onSelect({ type: 'branch', name: b.name }))
        .addTo(layer)
    }

    // Head Office.
    if (ho) {
      L.marker(ho, {
        icon: L.divIcon({ className: '', html: '<div class="sim-ho-pin">HO</div>', iconSize: [40, 40], iconAnchor: [20, 20] }),
        zIndexOffset: 2000,
      }).bindTooltip('Head Office — click for the HO yard', { direction: 'top', offset: [0, -16] })
        .on('click', () => onOpenHO()).addTo(layer)
    }

    // Fit to the region once per region change (not on every refresh).
    const fitKey = region || 'ALL'
    if (fittedRef.current !== fitKey && visible.length) {
      const pts = visible.map(b => [b.lat, b.lng])
      if (!region && ho) pts.push(ho)
      map.fitBounds(L.latLngBounds(pts).pad(region ? 0.15 : 0.08), { maxZoom: region === 'Bangalore' ? 12 : 9 })
      fittedRef.current = fitKey
    }
  }, [ready, data, region, selected, colors, onSelect, onOpenHO, tick])

  // Pan to a branch picked from a list.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || selected?.type !== 'branch' || !data) return
    const b = data.branches.find(x => x.name === selected.name)
    if (b?.lat != null && !map.getBounds().contains([b.lat, b.lng])) map.panTo([b.lat, b.lng])
  }, [ready, selected, data])

  return <div ref={elRef} className={dark ? 'sim-map-dark' : undefined} style={{ position: 'absolute', inset: 0, background: dark ? '#0d1219' : '#e9eef4' }} />
}
