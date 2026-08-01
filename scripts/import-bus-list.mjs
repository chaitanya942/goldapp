// scripts/import-bus-list.mjs
// Import the master list of ad-wrapped buses into bus_audit_buses.
//
//   node scripts/import-bus-list.mjs "C:\path\to\bus-list.xlsx"
//   node scripts/import-bus-list.mjs "C:\path\to\bus-list.csv" --sheet "Sheet1"
//
// Reads .xlsx or .csv, auto-detects the registration column (and optional
// region/depot/route), normalizes each plate, dedupes, and UPSERTs on reg_norm
// so re-running is idempotent. Prints what it detected before writing.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { normalizePlate, looksLikePlate } from '../lib/busPlate.js'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const file = process.argv[2]
const dryRun = process.argv.includes('--dry')
if (!file) { console.error('Usage: node scripts/import-bus-list.mjs <file.xlsx|csv> [--dry]'); process.exit(1) }

const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
const sheetArg = process.argv.includes('--sheet') ? process.argv[process.argv.indexOf('--sheet') + 1] : null
const sheetName = sheetArg || wb.SheetNames[0]
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
if (!rows.length) { console.error('No rows found in sheet', sheetName); process.exit(1) }

const headers = Object.keys(rows[0])
console.log(`Sheet "${sheetName}" — ${rows.length} rows, columns: ${headers.join(' | ')}`)

// ── Detect columns ──────────────────────────────────────────────────────────
const find = (...pats) => headers.find(h => pats.some(p => h.toLowerCase().includes(p)))
let regCol = find('registration', 'reg no', 'reg.', 'vehicle no', 'vehicle number', 'bus no', 'bus number', 'number plate', 'plate')
// If nothing obvious, pick the column whose values most look like plates.
if (!regCol) {
  let best = null, bestScore = -1
  for (const h of headers) {
    const score = rows.slice(0, 50).filter(r => looksLikePlate(normalizePlate(String(r[h])))).length
    if (score > bestScore) { bestScore = score; best = h }
  }
  regCol = best
}
const regionCol = find('region', 'zone')
const depotCol  = find('depot', 'division')
const routeCol  = find('route')

console.log(`Detected → registration: "${regCol}"  region: "${regionCol || '-'}"  depot: "${depotCol || '-'}"  route: "${routeCol || '-'}"`)

// ── Build rows ──────────────────────────────────────────────────────────────
const seen = new Set()
const out = []
let blank = 0, dupe = 0, odd = 0
for (const r of rows) {
  const raw = String(r[regCol] ?? '').trim()
  if (!raw) { blank++; continue }
  const norm = normalizePlate(raw)
  if (!norm) { blank++; continue }
  if (seen.has(norm)) { dupe++; continue }
  seen.add(norm)
  if (!looksLikePlate(norm)) odd++
  out.push({
    reg_number: raw,
    reg_norm: norm,
    region: regionCol ? String(r[regionCol] ?? '').trim() || null : null,
    depot:  depotCol  ? String(r[depotCol]  ?? '').trim() || null : null,
    route:  routeCol  ? String(r[routeCol]  ?? '').trim() || null : null,
  })
}

console.log(`\nPrepared ${out.length} unique buses  (blank: ${blank}, duplicates: ${dupe}, odd-shaped: ${odd})`)
console.log('Sample:', out.slice(0, 5).map(o => `${o.reg_number} → ${o.reg_norm}${o.region ? ` [${o.region}]` : ''}`).join('\n        '))

if (dryRun) { console.log('\n--dry: nothing written.'); process.exit(0) }

// ── Upsert in chunks ────────────────────────────────────────────────────────
let done = 0
for (let i = 0; i < out.length; i += 500) {
  const chunk = out.slice(i, i + 500)
  const { error } = await sb.from('bus_audit_buses').upsert(chunk, { onConflict: 'reg_norm', ignoreDuplicates: true })
  if (error) { console.error('Upsert failed at', i, error.message); process.exit(1) }
  done += chunk.length
  process.stdout.write(`\r  imported ${done}/${out.length}`)
}
console.log(`\n✅ Done — ${out.length} buses in master list.`)
