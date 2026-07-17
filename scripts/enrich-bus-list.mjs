// scripts/enrich-bus-list.mjs
// Enrich the already-imported buses with City→region, Depot→depot, Bus Type→
// bus type. Matches existing rows on the normalized bus number and UPDATEs only
// region/depot/route — never touches status/photo_count/audit fields, so it's
// safe to run after audits have begun.
//
//   node scripts/enrich-bus-list.mjs "C:\path\to\bus-list-with-depots.xlsx"
//   node scripts/enrich-bus-list.mjs "C:\path\to\file.csv" --dry

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { normalizePlate } from '../lib/busPlate.js'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const file = process.argv[2]
const dry = process.argv.includes('--dry')
if (!file) { console.error('Usage: node scripts/enrich-bus-list.mjs <file.xlsx|csv> [--dry]'); process.exit(1) }

const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true })
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
const headers = Object.keys(rows[0] || {})
console.log(`${rows.length} rows, columns: ${headers.join(' | ')}`)

const find = (...pats) => headers.find(h => pats.some(p => h.toLowerCase().includes(p)))
const regCol    = find('bus number', 'bus no', 'registration', 'reg no', 'number plate', 'vehicle')
const regionCol = find('city', 'region', 'zone', 'division')
const depotCol  = find('depot')
const typeCol   = find('bus type') || headers.find(h => h.toLowerCase() === 'type')
const adCol     = find('ad type', 'creative', 'campaign')
const mountCol  = find('mounting', 'mount date', 'mounted')
console.log(`Detected → number: "${regCol}"  region(City): "${regionCol}"  depot: "${depotCol}"  type: "${typeCol || '-'}"  ad: "${adCol || '-'}"  mounted: "${mountCol || '-'}"`)
if (!regCol || !regionCol) { console.error('Could not find the bus-number and/or City column.'); process.exit(1) }

// Excel date cell (Date via cellDates) or string → 'YYYY-MM-DD' | null
const toDate = (v) => {
  if (!v) return null
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v).trim(); if (!s) return null
  const d = new Date(s); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Build reg_norm → {region, depot, route, ad_type, mounting_date}
const byNorm = new Map()
for (const r of rows) {
  const norm = normalizePlate(String(r[regCol] ?? ''))
  if (!norm) continue
  byNorm.set(norm, {
    region: String(r[regionCol] ?? '').trim() || null,
    depot:  depotCol ? String(r[depotCol] ?? '').trim() || null : null,
    route:  typeCol  ? String(r[typeCol]  ?? '').trim() || null : null,   // "City"/"Rural"
    ad_type: adCol   ? String(r[adCol]    ?? '').trim() || null : null,
    mounting_date: mountCol ? toDate(r[mountCol]) : null,
  })
}
console.log(`Unique buses to enrich: ${byNorm.size}`)

// region tally so we can eyeball the grouping before writing
const tally = {}
for (const v of byNorm.values()) tally[v.region] = (tally[v.region] || 0) + 1
console.log('Regions:', Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(', '))

if (dry) { console.log('\n--dry: nothing written.'); process.exit(0) }

const entries = [...byNorm.entries()]
let done = 0, missing = 0
const CONC = 40
for (let i = 0; i < entries.length; i += CONC) {
  const batch = entries.slice(i, i + CONC)
  const res = await Promise.all(batch.map(([norm, v]) =>
    sb.from('bus_audit_buses').update({ region: v.region, depot: v.depot, route: v.route, ad_type: v.ad_type, mounting_date: v.mounting_date }).eq('reg_norm', norm).select('id')
  ))
  res.forEach(r => { if (!r.data || !r.data.length) missing++; else done += r.data.length })
  process.stdout.write(`\r  enriched ${done}/${entries.length}`)
}
console.log(`\n✅ Enriched ${done} buses.${missing ? `  ⚠ ${missing} numbers in the file weren't found in the master list.` : ''}`)
